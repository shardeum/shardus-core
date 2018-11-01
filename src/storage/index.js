const fs = require('fs')
const path = require('path')
const Sequelize = require('sequelize')
const models = require('./models')

class Storage {
  constructor (exitHandler, logger, baseDir, config) {
    // Parse config
    config = require(path.join(baseDir, config.confFile))
    // Setup logger
    this.mainLogger = logger.getLogger('main')
    // Create dir if it doesn't exist
    let dbDir = path.parse(config.options.storage).dir
    _ensureExists(dbDir)
    this.mainLogger.info('Created Database directory.')
    // Start Sequelize and load models
    this.sequelize = new Sequelize(...Object.values(config))
    for (let [modelName, modelAttributes] of models) this.sequelize.define(modelName, modelAttributes)
    this.models = this.sequelize.models
    this.initialized = false
  }

  async init () {
    // Create tables for models in DB if they don't exist
    for (let model of Object.values(this.models)) await model.sync({ force: true })
    this.initialized = true
  }

  async addCycles (cycles) {
    this._checkInit()
    await this._create(this.models.cycles, cycles)
  }
  async getCycles (cycle) {
    this._checkInit()
    let cycles = await this._read(this.models.cycles, cycle, { attributes: { exclude: ['createdAt', 'updatedAt'] }, raw: true })
    return cycles
  }
  async deleteCycles (cycle) {
    this._checkInit()
    await this._delete(this.models.cycles, cycle)
  }
  async listCycles () {
    this._checkInit()
    let cycles = await this._read(this.models.cycles, null, { attributes: { exclude: ['createdAt', 'updatedAt'] }, raw: true })
    return cycles
  }

  async addNodes (nodes) {
    this._checkInit()
    await this._create(this.models.nodes, nodes)
  }
  async getNodes (node) {
    this._checkInit()
    let nodes = await this._read(this.models.nodes, node, { attributes: { exclude: ['createdAt', 'updatedAt'] }, raw: true })
    return nodes
  }
  async deleteNodes (node) {
    this._checkInit()
    await this._delete(this.models.nodes, node)
  }
  async listNodes () {
    this._checkInit()
    let nodes = await this._read(this.models.nodes, null, { attributes: { exclude: ['createdAt', 'updatedAt'] }, raw: true })
    return nodes
  }

  async setProperty (key, value) {
    this._checkInit()
    await this._create(this.models.properties, {
      key,
      value: JSON.stringify(value)
    })
  }
  async getProperty (key) {
    this._checkInit()
    let [ prop ] = await this._read(this.models.properties, { key })
    return JSON.parse(prop.value)
  }
  async deleteProperty (key) {
    this._checkInit()
    await this._delete(this.models.properties, { key })
  }
  async listProperties () {
    this._checkInit()
    let keys = await this._read(this.models.properties, null, { attributes: ['key'], raw: true })
    return keys.map(k => k.key)
  }

  _checkInit () {
    if (!this.initialized) throw new Error('Storage not initialized.')
  }
  _create (table, values, opts) {
    if (Array.isArray(values)) {
      return table.bulkCreate(values, opts)
    }
    return table.create(values, opts)
  }
  _read (table, where, opts) {
    return table.findAll({ where, ...opts })
  }
  _update (table, values, where, opts) {
    return table.update(values, { where, ...opts })
  }
  _delete (table, where, opts) {
    return table.destroy({ where, ...opts })
  }
}

// From: https://stackoverflow.com/a/21196961
async function _ensureExists (dir) {
  return new Promise((resolve, reject) => {
    fs.mkdir(dir, null, (err) => {
      if (err) {
        // Ignore err if folder exists
        if (err.code === 'EEXIST') resolve()
        // Something else went wrong
        else reject(err)
      } else {
        // Successfully created folder
        resolve()
      }
    })
  })
}

module.exports = Storage
