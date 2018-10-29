const fs = require('fs')
const path = require('path')
const Sequelize = require('sequelize')
const models = require('./models')

class Storage {
  constructor (config) {
    // Create dir if it doesn't exist
    let dbDir = path.parse(config[3].storage).dir
    _ensureExists(dbDir)
    // Start Sequelize and load models
    this.sequelize = new Sequelize(...config)
    this.models = {}
    for (let [modelName, attributes] of models) {
      this.models[modelName] = this.sequelize.define(modelName, attributes)
    }
    this.initialized = false
  }

  async init () {
    // Create tables for models in DB if they don't exist
    for (let model of Object.values(this.models)) await model.sync()
    this.initialized = true
  }

  async setProperty (key, value) {
    if (!this.initialized) throw new Error('Storage not initialized.')
    await this.models.properties.create({
      key,
      value: JSON.stringify(value)
    })
  }

  async getProperty (key) {
    if (!this.initialized) throw new Error('Storage not initialized.')
    let prop = await this.models.properties.findByPk(key)
    return JSON.parse(prop.value)
  }

  async listProperties () {
    if (!this.initialized) throw new Error('Storage not initialized.')
    let keys = this.models.properties.findAll({ attributes: ['key'], raw: true })
    return keys.map(k => k.key)
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
