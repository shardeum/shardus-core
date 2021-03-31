import Log4js from 'log4js'
import Shardus from '../shardus/shardus-types'
import fs from 'fs'
import path from 'path'
import { Sequelize } from 'sequelize'
import Profiler from '../utils/profiler'
import Logger, {logFlags} from '../logger'

interface SequelizeStorage {
  baseDir: string
  models: any
  storageConfig: Shardus.StorageConfiguration
  profiler: Profiler
  mainLogger: Log4js.Logger
  sequelize: Sequelize
  storageModels: any
  initialized: boolean
}

class SequelizeStorage {
  // note that old storage passed in logger, now we pass in the specific log for it to use.  This works for application use, but may need to rethink if we apply this to shardus core
  constructor(
    models: any,
    storageConfig: Shardus.StorageConfiguration,
    logger: Logger,
    baseDir: string,
    profiler: Profiler
  ) {
    this.baseDir = baseDir
    this.models = models
    this.storageConfig = storageConfig
    this.storageConfig.options.storage = path.join(
      this.baseDir,
      this.storageConfig.options.storage
    )
    this.profiler = profiler
    // Setup logger
    this.mainLogger = logger.getLogger('default')
  }

  async init() {
    // Create dbDir if it doesn't exist
    let dbDir = path.parse(this.storageConfig.options.storage).dir
    await _ensureExists(dbDir)
    this.mainLogger.info('Created Database directory.')
    // Start Sequelize and load models
    //@ts-ignore
    this.sequelize = new Sequelize(...Object.values(this.storageConfig))
    for (let [modelName, modelAttributes] of this.models)
      this.sequelize.define(modelName, modelAttributes)
    this.storageModels = this.sequelize.models
    this.initialized = false
    // Create tables for models in DB if they don't exist
    for (let model of Object.values(this.storageModels) as any) {
      await model.sync()
      this._rawQuery(model, 'PRAGMA synchronous = OFF')
      this._rawQuery(model, 'PRAGMA journal_mode = MEMORY')
    }
    this.initialized = true
    this.mainLogger.info('Database initialized.')
  }
  async close() {
    // this.mainLogger.info('Closing Database connections.')
    await this.sequelize.close()
  }

  async dropAndCreateModel(model) {
    await model.sync({ force: true })
  }

  _checkInit() {
    if (!this.initialized) throw new Error('Storage not initialized.')
  }
  _create(table, values, opts) {
    if (Array.isArray(values)) {
      return table.bulkCreate(values, opts)
    }
    return table.create(values, opts)
  }
  _read(table, where, opts) {
    return table.findAll({ where, ...opts })
  }
  _update(table, values, where, opts) {
    return table.update(values, { where, ...opts })
  }
  _delete(table, where, opts) {
    if (!where) {
      return table.destroy({ ...opts })
    }
    return table.destroy({ where, ...opts })
  }
  _rawQuery(table, query) {
    return this.sequelize.query(query, { model: table })
  }
}

// From: https://stackoverflow.com/a/21196961
async function _ensureExists(dir) {
  return new Promise((resolve, reject) => {
    fs.mkdir(dir, { recursive: true }, err => {
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

export default SequelizeStorage
