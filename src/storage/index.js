const fs = require('fs')
const path = require('path')
const Sequelize = require('sequelize')
const models = require('./models')

class Storage {
  constructor (config) {
    let dbDir = path.parse(config[3].storage).dir
    _ensureExists(dbDir)
    this.sequelize = new Sequelize(...config)
    this.models = {}
    for (let [modelName, attributes] of models) {
      this.models[modelName] = this.sequelize.define(modelName, attributes)
    }
    this.initialized = false
  }

  async init () {
    for (let model of Object.values(this.models)) await model.sync()
    this.initialized = true
  }

  async addKeypair ({ publicKey, secretKey }) {
    if (!this.initialized) throw new Error('Storage not initialized.')
    await this.models.keypairs.create({
      publicKey,
      secretKey
    })
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
