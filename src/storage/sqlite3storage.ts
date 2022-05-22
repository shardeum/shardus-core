/* eslint-disable no-empty */
import stringify from 'fast-stable-stringify'
import fs from 'fs'
import Log4js from 'log4js'
import path from 'path'
import * as Sequelize from 'sequelize'
import * as Shardus from '../shardus/shardus-types'
import * as Snapshot from '../snapshot'
import * as utils from '../utils'
import Profiler from '../utils/profiler'
import { config, crypto, logger } from '../p2p/Context'
import {logFlags} from '../logger'

const Op = Sequelize.Op
const sqlite3 = require('sqlite3').verbose()

interface Sqlite3Storage {
  baseDir: string
  storageConfig: Shardus.StorageConfiguration
  profiler: Profiler
  mainLogger: Log4js.Logger
  initialized: boolean
  storageModels: any
  db: any
  oldDb: any
}

class Sqlite3Storage {
  // note that old storage passed in logger, now we pass in the specific log for it to use.  This works for application use, but may need to rethink if we apply this to shardus core
  constructor(models, storageConfig, logger, baseDir, profiler) {
    this.baseDir = baseDir
    this.storageConfig = storageConfig
    this.storageConfig.options.storage = path.join(
      this.baseDir,
      this.storageConfig.options.storage
    )
    this.profiler = profiler
    // Setup logger
    this.mainLogger = logger.getLogger('default')
    // Start Sequelize and load models
    // this.sequelize = new Sequelize(...Object.values(storageConfig))
    // for (let [modelName, modelAttributes] of models) this.sequelize.define(modelName, modelAttributes)
    // this.models = this.sequelize.models
    this.initialized = false
    this.storageModels = {}
    for (const [modelName, modelAttributes] of models) {
      this.sqlite3Define(modelName, modelAttributes)
    }
  }

  sqlite3Define(modelName, modelAttributes) {
    const tableName = modelName

    const modelData: any = { tableName }
    modelData.columns = []
    modelData.columnsString = ''
    modelData.substitutionString = ''
    modelData.isColumnJSON = {}
    modelData.JSONkeys = []
    let key
    for (const attr in modelAttributes) {
      key = attr
      // eslint-disable-next-line no-prototype-builtins
      if (modelAttributes.hasOwnProperty(key)) {
        modelData.columns.push(key)
        const value = modelAttributes[key]

        let type = value.type
        if (!type) {
          type = value
          // if (logFlags.console) console.log(' TYPE MISSING!!!! ' + key)
        }
        if (type.toString() === Sequelize.JSON.toString()) {
          modelData.isColumnJSON[key] = true
          modelData.JSONkeys.push(key)
          // if (logFlags.console) console.log(`JSON column: ${key}`)
        } else {
          modelData.isColumnJSON[key] = false
        }
      }
    }
    for (let i = 0; i < modelData.columns.length; i++) {
      key = modelData.columns[i]
      modelData.columnsString += key
      modelData.substitutionString += '?'
      if (i < modelData.columns.length - 1) {
        modelData.columnsString += ', '
        modelData.substitutionString += ', '
      }
    }
    modelData.insertOrReplaceString = `INSERT OR REPLACE INTO ${modelData.tableName} (${modelData.columnsString} ) VALUES (${modelData.substitutionString})`
    modelData.insertString = `INSERT INTO ${modelData.tableName} (${modelData.columnsString} ) VALUES (${modelData.substitutionString})`
    modelData.selectString = `SELECT * FROM ${modelData.tableName} `
    modelData.updateString = `UPDATE ${modelData.tableName} SET `
    modelData.deleteString = `DELETE FROM ${modelData.tableName} `

    // if (logFlags.console) console.log(`Create model data for table: ${tableName} => ${stringify(modelData)}`)
    // if (logFlags.console) console.log()
    this.storageModels[tableName] = modelData

    // todo base this off of models
  }

  async init() {
    const dbDir = path.parse(this.storageConfig.options.storage).dir

    // Rename dbDir if it exists
    let oldDirPath
    try {
      oldDirPath = dbDir + '-old-' + Date.now()

      if(this.storageConfig.options.saveOldDBFiles){
        fs.renameSync(dbDir, oldDirPath)
        if (oldDirPath) {
          this.mainLogger.info('Setting old data path. this will cause safety mode?' + oldDirPath)
          Snapshot.setOldDataPath(oldDirPath)
          this.oldDb = new sqlite3.Database(`${oldDirPath}/db.sqlite`)
        }        
      } else {
        //recursive delete of db folder
        try{
          fs.rmdirSync(dbDir, { recursive: true })
        } catch (e) {
          //wait 5 seconds and try one more time
          await utils.sleep(5000)
          fs.rmdirSync(dbDir, { recursive: true })
        }
      }
    } catch (e) {
      if (config.p2p.startInWitnessMode) {
        throw new Error('Unable to start in witness mode: no old data')
      }
    }

    // Create dbDir if it doesn't exist
    await _ensureExists(dbDir)
    this.mainLogger.info('Created Database directory.')

    if (this.storageConfig.options.memoryFile) {
      this.db = new sqlite3.Database(':memory:')
    } else {
      this.db = new sqlite3.Database(this.storageConfig.options.storage)
    }

    // Create tables for models in DB if they don't exist
    // for (let model of Object.values(this.models)) {
    //   await model.sync()
    //   this._rawQuery(model, 'PRAGMA synchronous = OFF')
    //   this._rawQuery(model, 'PRAGMA journal_mode = MEMORY')
    // }

    // await this.run('CREATE TABLE if not exists `acceptedTxs` (`id` VARCHAR(255) NOT NULL PRIMARY KEY, `timestamp` BIGINT NOT NULL, `data` JSON NOT NULL, `status` VARCHAR(255) NOT NULL, `receipt` JSON NOT NULL)')
    // await this.run('CREATE TABLE if not exists `accountStates` ( `accountId` VARCHAR(255) NOT NULL, `txId` VARCHAR(255) NOT NULL, `txTimestamp` BIGINT NOT NULL, `stateBefore` VARCHAR(255) NOT NULL, `stateAfter` VARCHAR(255) NOT NULL,  PRIMARY KEY (`accountId`, `txTimestamp`))')
    // await this.run('CREATE TABLE if not exists `cycles` (`counter` BIGINT NOT NULL UNIQUE PRIMARY KEY, `certificate` JSON NOT NULL, `previous` TEXT NOT NULL, `marker` TEXT NOT NULL, `start` BIGINT NOT NULL, `duration` BIGINT NOT NULL, `active` BIGINT NOT NULL, `desired` BIGINT NOT NULL, `expired` BIGINT NOT NULL, `joined` JSON NOT NULL, `activated` JSON NOT NULL, `removed` JSON NOT NULL, `returned` JSON NOT NULL, `lost` JSON NOT NULL, `apoptosized` JSON NOT NULL)')
    // await this.run('CREATE TABLE if not exists `nodes` (`id` TEXT NOT NULL PRIMARY KEY, `publicKey` TEXT NOT NULL, `curvePublicKey` TEXT NOT NULL, `cycleJoined` TEXT NOT NULL, `internalIp` VARCHAR(255) NOT NULL, `externalIp` VARCHAR(255) NOT NULL, `internalPort` SMALLINT NOT NULL, `externalPort` SMALLINT NOT NULL, `joinRequestTimestamp` BIGINT NOT NULL, `address` VARCHAR(255) NOT NULL, `status` VARCHAR(255) NOT NULL)')
    // await this.run('CREATE TABLE if not exists `properties` (`key` VARCHAR(255) NOT NULL PRIMARY KEY, `value` JSON)')
    // await this.run('CREATE TABLE if not exists `accountsCopy` (`accountId` VARCHAR(255) NOT NULL, `cycleNumber` BIGINT NOT NULL, `data` JSON NOT NULL, `timestamp` BIGINT NOT NULL, `hash` VARCHAR(255) NOT NULL, PRIMARY KEY (`accountId`, `cycleNumber`))')

    // , `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL
    // `id` INTEGER PRIMARY KEY AUTOINCREMENT,
    // await this.run('CREATE TABLE if not exists `accounts` (`address` VARCHAR(255) NOT NULL PRIMARY KEY, `modified` BIGINT NOT NULL, `sequence` BIGINT NOT NULL, `owners` JSON NOT NULL, `signs` SMALLINT NOT NULL, `balance` DOUBLE PRECISION NOT NULL, `type` VARCHAR(255) NOT NULL, `data` JSON NOT NULL, `hash` VARCHAR(255) NOT NULL, `txs` TEXT NOT NULL, `timestamp` BIGINT NOT NULL)')

    await this.run('PRAGMA synchronous = OFF')

    if(this.storageConfig.options.walMode === true){
      await this.run('PRAGMA journal_mode = WAL')
    } else {
      await this.run('PRAGMA journal_mode = MEMORY')
    }
    if(this.storageConfig.options.exclusiveLockMode === true){
      await this.run('PRAGMA locking_mode = EXCLUSIVE')
    }

    this.initialized = true
    this.mainLogger.info('Database initialized.')
  }
  async close() {
    // this.mainLogger.info('Closing Database connections.')
    await this.db.close()
    if (this.oldDb) await this.oldDb.close()
  }

  async runCreate(createStatement) {
    await this.run(createStatement)
  }

  async dropAndCreateModel(model) {
    // await model.sync({ force: true })
  }

  _checkInit() {
    if (!this.initialized) throw new Error('Storage not initialized.')
  }

  _create(table, object, opts) {
    try{
    this.profiler.profileSectionStart('db')
    // if (logFlags.console) console.log('_create2: ' + stringify(object))
    if (Array.isArray(object)) {
      // return table.bulkCreate(values, opts)
      // todo transaciton or something else

      for (const subObj of object) {
        // if (logFlags.console) console.log('sub obj: ' + stringify(subObj))
        this._create(table, subObj, opts)
      }
      return
    }
    let queryString = table.insertString
    if (opts && opts.createOrReplace) {
      queryString = table.insertOrReplaceString
    }
    const inputs = []
    // if (logFlags.console) console.log('columns: ' + stringify(table.columns))
    for (const column of table.columns) {
      let value = object[column]

      if (table.isColumnJSON[column]) {
        value = stringify(value)
      }
      // if (logFlags.console) console.log(`column: ${column}  ${value}`)
      inputs.push(value)
    }
    queryString += this.options2string(opts)

    // if (logFlags.console) console.log(queryString + '  VALUES: ' + stringify(inputs))
    return this.run(queryString, inputs)
    
    } finally {
      this.profiler.profileSectionEnd('db')
    }
  }

  async _read(table, params, opts) {
    try{
      this.profiler.profileSectionStart('db')
    // return table.findAll({ where, ...opts })
    let queryString = table.selectString

    // let valueArray = []

    const paramsArray = this.params2Array(params, table)

    const { whereString, whereValueArray } = this.paramsToWhereStringAndValues(
      paramsArray
    )

    const valueArray = whereValueArray
    queryString += whereString
    queryString += this.options2string(opts)

    // if (logFlags.console) console.log(queryString + '  VALUES: ' + stringify(valueArray))

    const results = await this.all(queryString, valueArray)
    // optionally parse results!
    if (!opts || !opts.raw) {
      if (table.JSONkeys.length > 0) {
        // for (let i = 0; i < results.length; i++) {
        //   let result = results[i]
        //   if (logFlags.console) console.log('todo parse this??? ' + result)
        // }
      }
    }
    return results
    } finally {
      this.profiler.profileSectionEnd('db')
    }
  }
  async _readOld(table, params, opts) {
    try{
      this.profiler.profileSectionStart('db')
    // return table.findAll({ where, ...opts })
    let queryString = table.selectString

    // let valueArray = []

    const paramsArray = this.params2Array(params, table)

    const { whereString, whereValueArray } = this.paramsToWhereStringAndValues(
      paramsArray
    )

    const valueArray = whereValueArray
    queryString += whereString
    queryString += this.options2string(opts)

    // if (logFlags.console) console.log(queryString + '  VALUES: ' + stringify(valueArray))

    const results = await this.allOld(queryString, valueArray)
    // optionally parse results!
    if (!opts || !opts.raw) {
      if (table.JSONkeys.length > 0) {
        // for (let i = 0; i < results.length; i++) {
        //   let result = results[i]
        //   if (logFlags.console) console.log('todo parse this??? ' + result)
        // }
      }
    }
    return results
    } finally {
      this.profiler.profileSectionEnd('db')
    }
  }

  _update(table, values, where, opts) {
    try{
      this.profiler.profileSectionStart('db')
    // return table.update(values, { where, ...opts })
    let queryString = table.updateString

    const valueParams = this.params2Array(values, table)
    // eslint-disable-next-line prefer-const
    let { resultString, valueArray } = this.paramsToAssignmentStringAndValues(
      valueParams
    )

    queryString += resultString

    const whereParams = this.params2Array(where, table)
    const { whereString, whereValueArray } = this.paramsToWhereStringAndValues(
      whereParams
    )
    queryString += whereString

    valueArray = valueArray.concat(whereValueArray)

    queryString += this.options2string(opts)

    // if (logFlags.console) console.log(queryString + '  VALUES: ' + stringify(valueArray))
    return this.run(queryString, valueArray)
    } finally {
      this.profiler.profileSectionEnd('db')
    }
  }
  _delete(table, where, opts) {
    try{
      this.profiler.profileSectionStart('db')
    // if (!where) {
    //   return table.destroy({ ...opts })
    // }
    // return table.destroy({ where, ...opts })

    let queryString = table.deleteString

    const whereParams = this.params2Array(where, table)
    const { whereString, whereValueArray } = this.paramsToWhereStringAndValues(
      whereParams
    )
    const valueArray = whereValueArray
    queryString += whereString
    queryString += this.options2string(opts)

    // if (logFlags.console) console.log(queryString + '  VALUES: ' + stringify(valueArray))
    return this.run(queryString, valueArray)
    } finally {
      this.profiler.profileSectionEnd('db')
    }
  }

  _rawQuery(queryString, valueArray) {
    // return this.sequelize.query(query, { model: table })
    try{
      this.profiler.profileSectionStart('db')
    return this.all(queryString, valueArray)
    } finally {
      this.profiler.profileSectionEnd('db')
    }
  }

  _rawQueryOld(queryString, valueArray) {
    // return this.sequelize.query(query, { model: table })
    try{
      this.profiler.profileSectionStart('db')
    return this.allOld(queryString, valueArray)
    } finally {
      this.profiler.profileSectionEnd('db')
    }
  }

  params2Array(paramsObj, table) {
    if (paramsObj === null || paramsObj === undefined) {
      return []
    }
    const paramsArray = []
    for (const key in paramsObj) {
      // eslint-disable-next-line no-prototype-builtins
      if (paramsObj.hasOwnProperty(key)) {
        const paramEntry: any = { name: key }

        const value = paramsObj[key]
        if (
          utils.isObject(value) &&
          table.isColumnJSON[paramEntry.name] === false
        ) {
          // WHERE column_name BETWEEN value1 AND value2;
          if (value[Op.between]) {
            const between = value[Op.between]
            paramEntry.type = 'BETWEEN'
            paramEntry.v1 = between[0]
            paramEntry.v2 = between[1]
            paramEntry.sql = `${paramEntry.name} ${paramEntry.type} ? AND ? `
            paramEntry.vals = [paramEntry.v1, paramEntry.v2]
          }
          // WHERE column_name IN (value1, value2, ...)
          if (value[Op.in]) {
            const inValues = value[Op.in]
            paramEntry.type = 'IN'
            // paramEntry.v1 = between[0]
            // paramEntry.v2 = between[1]
            let questionMarks = ''
            for (let i = 0; i < inValues.length; i++) {
              questionMarks += '?'
              if (i < inValues.length - 1) {
                questionMarks += ' , '
              }
            }
            paramEntry.sql = `${paramEntry.name} ${paramEntry.type} (${questionMarks})`
            paramEntry.vals = []
            paramEntry.vals = paramEntry.vals.concat(inValues)
          }
          if (value[Op.lte]) {
            const rightHandValue = value[Op.lte]
            paramEntry.type = 'LTE'
            paramEntry.v1 = rightHandValue
            // paramEntry.v2 = between[1]
            paramEntry.sql = `${paramEntry.name} <= ?`
            paramEntry.vals = [paramEntry.v1]
          }
          if (value[Op.gte]) {
            const rightHandValue = value[Op.gte]
            paramEntry.type = 'GTE'
            paramEntry.v1 = rightHandValue
            // paramEntry.v2 = between[1]
            paramEntry.sql = `${paramEntry.name} >= ?`
            paramEntry.vals = [paramEntry.v1]
          }
        } else {
          paramEntry.type = '='
          paramEntry.v1 = value
          paramEntry.sql = `${paramEntry.name} ${paramEntry.type} ?`

          if (table.isColumnJSON[paramEntry.name]) {
            paramEntry.v1 = stringify(paramEntry.v1)
          }
          paramEntry.vals = [paramEntry.v1]
        }

        paramsArray.push(paramEntry)
      }
    }
    return paramsArray
  }

  paramsToWhereStringAndValues(paramsArray) {
    let whereValueArray = []
    let whereString = ''
    for (let i = 0; i < paramsArray.length; i++) {
      if (i === 0) {
        whereString += ' WHERE '
      }
      const paramEntry = paramsArray[i]
      whereString += '(' + paramEntry.sql + ')'
      if (i < paramsArray.length - 1) {
        whereString += ' AND '
      }
      whereValueArray = whereValueArray.concat(paramEntry.vals)
    }
    return { whereString, whereValueArray }
  }

  paramsToAssignmentStringAndValues(paramsArray) {
    let valueArray = []
    let resultString = ''
    for (let i = 0; i < paramsArray.length; i++) {
      const paramEntry = paramsArray[i]
      resultString += paramEntry.sql
      if (i < paramsArray.length - 1) {
        resultString += ' , '
      }
      valueArray = valueArray.concat(paramEntry.vals)
    }
    return { resultString, valueArray }
  }

  options2string(optionsObj) {
    if (optionsObj === null || optionsObj === undefined) {
      return ''
    }
    let optionsString = ''
    if (optionsObj.order) {
      optionsString += ' ORDER BY '
      for (let i = 0; i < optionsObj.order.length; i++) {
        const orderEntry = optionsObj.order[i]
        optionsString += ` ${orderEntry[0]} ${orderEntry[1]} `
        if (i < optionsObj.order.length - 1) {
          optionsString += ','
        }
      }
    }
    if (optionsObj.limit) {
      optionsString += ` LIMIT ${optionsObj.limit}`
    }

    return optionsString
  }

  // run/get/all promise wraps from this tutorial: https://stackabuse.com/a-sqlite-tutorial-with-node-js/
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) {
          if (logFlags.console) console.log('Error running sql ' + sql)
          if (logFlags.console) console.log(err)
          reject(err)
        } else {
          resolve({ id: this.lastID })
        }
      })
    })
  }
  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, result) => {
        if (err) {
          if (logFlags.console) console.log('Error running sql: ' + sql)
          if (logFlags.console) console.log(err)
          reject(err)
        } else {
          resolve(result)
        }
      })
    })
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          if (logFlags.console) console.log('Error running sql: ' + sql)
          if (logFlags.console) console.log(err)
          reject(err)
        } else {
          resolve(rows)
        }
      })
    })
  }
  allOld(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.oldDb.all(sql, params, (err, rows) => {
        if (err) {
          if (logFlags.console) console.log('Error running sql: ' + sql)
          if (logFlags.console) console.log(err)
          reject(err)
        } else {
          resolve(rows)
        }
      })
    })
  }
}

// From: https://stackoverflow.com/a/21196961
async function _ensureExists(dir) {
  return new Promise<void>((resolve, reject) => {
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

export default Sqlite3Storage
