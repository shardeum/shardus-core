import Log4js from 'log4js'
import * as Shardus from '../shardus/shardus-types'
import fs from 'fs'
import path from 'path'
import { Model, ModelCtor, Sequelize } from 'sequelize'
import Profiler from '../utils/profiler'
import Logger from '../logger'
import { ModelAttributes } from '.'
import { Where } from 'sequelize/types/utils'

interface SequelizeStorage {
  baseDir: string
  models: [string, ModelAttributes][]
  storageConfig: Shardus.StrictStorageConfiguration
  profiler: Profiler
  mainLogger: Log4js.Logger
  sequelize: Sequelize
  storageModels: { [key: string]: ModelCtor<Model<unknown, unknown>> }
  initialized: boolean
}

class SequelizeStorage {
  // note that old storage passed in logger, now we pass in the specific log for it to use.  This works for application use, but may need to rethink if we apply this to shardus core
  constructor(
    models: [string, ModelAttributes][],
    storageConfig: Shardus.StrictStorageConfiguration,
    logger: Logger,
    baseDir: string,
    profiler: Profiler
  ) {
    this.baseDir = baseDir
    this.models = models
    this.storageConfig = storageConfig
    this.storageConfig.options.storage = path.join(this.baseDir, this.storageConfig.options.storage)
    this.profiler = profiler
    // Setup logger
    this.mainLogger = logger.getLogger('default')
  }

  async init(): Promise<void> {
    // Create dbDir if it doesn't exist
    const dbDir = path.parse(this.storageConfig.options.storage).dir
    await _ensureExists(dbDir)
    this.mainLogger.info('Created Database directory.')
    // Start Sequelize and load models
    this.sequelize = new Sequelize(...(Object.values(this.storageConfig) as unknown[]))
    for (const [modelName, modelAttributes] of this.models) this.sequelize.define(modelName, modelAttributes)
    this.storageModels = this.sequelize.models
    this.initialized = false
    // Create tables for models in DB if they don't exist
    for (const model of Object.values(this.storageModels)) {
      await model.sync()
      this._rawQuery(model, 'PRAGMA synchronous = OFF')
      this._rawQuery(model, 'PRAGMA journal_mode = MEMORY')
    }
    this.initialized = true
    this.mainLogger.info('Database initialized.')
  }
  async close(): Promise<void> {
    // this.mainLogger.info('Closing Database connections.')
    await this.sequelize.close()
  }

  async dropAndCreateModel(model: ModelCtor<Model<unknown, unknown>>): Promise<void> {
    await model.sync({ force: true })
  }

  _checkInit(): void {
    if (!this.initialized) throw new Error('Storage not initialized.')
  }
  _create(
    table: ModelCtor<Model<unknown, unknown>>,
    values: unknown[],
    opts: { [key: string]: unknown }
  ): Promise<Model<unknown, unknown>[]> | Promise<Model<unknown, unknown>> {
    if (Array.isArray(values)) {
      return table.bulkCreate(values, opts)
    }
    return table.create(values, opts)
  }
  _read(
    table: ModelCtor<Model<unknown, unknown>>,
    where: Where,
    opts: { [key: string]: unknown }
  ): Promise<Model<unknown, unknown>[]> {
    return table.findAll({ where, ...opts })
  }
  _update(
    table: ModelCtor<Model<unknown, unknown>>,
    values: unknown,
    where: Where,
    opts: { [key: string]: unknown }
  ): Promise<[affectedCount: number]> {
    return table.update(values, { where, ...opts })
  }
  _delete(
    table: ModelCtor<Model<unknown, unknown>>,
    where: Where,
    opts: { [key: string]: unknown }
  ): Promise<number> {
    if (!where) {
      return table.destroy({ ...opts })
    }
    return table.destroy({ where, ...opts })
  }
  _rawQuery(
    table: ModelCtor<Model<unknown, unknown>>,
    query: string | { query: string; values: unknown[] }
  ): Promise<Model<unknown, unknown>[]> {
    return this.sequelize.query(query, { model: table })
  }
}

// From: https://stackoverflow.com/a/21196961
async function _ensureExists(dir: fs.PathLike): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // probably safe; creates an empty folder
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.mkdir(dir, { recursive: true }, (err) => {
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
