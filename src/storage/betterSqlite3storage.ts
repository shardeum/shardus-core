const fs = require('fs')
const path = require('path')
const Sequelize = require('sequelize')
const Op = Sequelize.Op
var Sqlite3 = require('better-sqlite3')
const stringify = require('fast-stable-stringify')
const utils = require('../utils')

interface BetterSqlite3Storage {
  baseDir: string
  storageConfig: any
  profiler: any
  mainLogger: any
  initialized: boolean
  storageModels: any
  db: any
}

class BetterSqlite3Storage {
  // note that old storage passed in logger, now we pass in the specific log for it to use.  This works for application use, but may need to rethink if we apply this to shardus core
  constructor (models, storageConfig, logger, baseDir, profiler) {
    this.baseDir = baseDir
    this.storageConfig = storageConfig
    this.storageConfig.options.storage = path.join(this.baseDir, this.storageConfig.options.storage)
    this.profiler = profiler
    // Setup logger
    this.mainLogger = logger.getLogger('main')
    // Start Sequelize and load models
    // this.sequelize = new Sequelize(...Object.values(storageConfig))
    // for (let [modelName, modelAttributes] of models) this.sequelize.define(modelName, modelAttributes)
    // this.models = this.sequelize.models
    this.initialized = false
    this.storageModels = {}
    for (let [modelName, modelAttributes] of models) {
      this.sqlite3Define(modelName, modelAttributes)
    }
  }

  sqlite3Define (modelName, modelAttributes) {
    let tableName = modelName

    let modelData: any = { tableName }
    modelData.columns = []
    modelData.columnsString = ''
    modelData.substitutionString = ''
    modelData.isColumnJSON = {}
    modelData.JSONkeys = []
    for (var key in modelAttributes) {
      if (modelAttributes.hasOwnProperty(key)) {
        modelData.columns.push(key)
        let value = modelAttributes[key]

        let type = value.type
        if (!type) {
          type = value
          // console.log(' TYPE MISSING!!!! ' + key)
        }
        if (type.toString() === Sequelize.JSON.toString()) {
          modelData.isColumnJSON[key] = true
          modelData.JSONkeys.push(key)
          // console.log(`JSON column: ${key}`)
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

    // console.log(`Create model data for table: ${tableName} => ${stringify(modelData)}`)
    // console.log()
    this.storageModels[tableName] = modelData

    // todo base this off of models
  }

  async init () {
    // Create dbDir if it doesn't exist
    let dbDir = path.parse(this.storageConfig.options.storage).dir
    await _ensureExists(dbDir)
    this.mainLogger.info('Created Database directory.')
    if (this.storageConfig.options.memoryFile) {
      this.db = new Sqlite3(':memory:')
    } else {
      this.db = new Sqlite3(this.storageConfig.options.storage)
    }
    // Create tables for models in DB if they don't exist
    // for (let model of Object.values(this.models)) {
    //   await model.sync()
    //   this._rawQuery(model, 'PRAGMA synchronous = OFF')
    //   this._rawQuery(model, 'PRAGMA journal_mode = MEMORY')
    // }
    // await this.run('CREATE TABLE if not exists `acceptedTxs` (`id` VARCHAR(255) NOT NULL PRIMARY KEY, `timestamp` BIGINT NOT NULL, `data` JSON NOT NULL, `status` VARCHAR(255) NOT NULL, `receipt` JSON NOT NULL)')
    // await this.run('CREATE TABLE if not exists `accountStates` ( `accountId` VARCHAR(255) NOT NULL, `txId` VARCHAR(255) NOT NULL, `txTimestamp` BIGINT NOT NULL, `stateBefore` VARCHAR(255) NOT NULL, `stateAfter` VARCHAR(255) NOT NULL,  PRIMARY KEY (`accountId`, `txTimestamp`))')
    // await this.run('CREATE TABLE if not exists `cycles` (`counter` BIGINT NOT NULL UNIQUE PRIMARY KEY, `certificate` JSON NOT NULL, `previous` TEXT NOT NULL, `marker` TEXT NOT NULL, `start` BIGINT NOT NULL, `duration` BIGINT NOT NULL, `active` BIGINT NOT NULL, `desired` BIGINT NOT NULL, `expired` BIGINT NOT NULL, `joined` JSON NOT NULL, `activated` JSON NOT NULL, `removed` JSON NOT NULL, `returned` JSON NOT NULL, `lost` JSON NOT NULL, `refuted` JSON NOT NULL)')
    // await this.run('CREATE TABLE if not exists `nodes` (`id` TEXT NOT NULL PRIMARY KEY, `publicKey` TEXT NOT NULL, `curvePublicKey` TEXT NOT NULL, `cycleJoined` TEXT NOT NULL, `internalIp` VARCHAR(255) NOT NULL, `externalIp` VARCHAR(255) NOT NULL, `internalPort` SMALLINT NOT NULL, `externalPort` SMALLINT NOT NULL, `joinRequestTimestamp` BIGINT NOT NULL, `address` VARCHAR(255) NOT NULL, `status` VARCHAR(255) NOT NULL)')
    // await this.run('CREATE TABLE if not exists `properties` (`key` VARCHAR(255) NOT NULL PRIMARY KEY, `value` JSON)')
    // await this.run('CREATE TABLE if not exists `accountsCopy` (`accountId` VARCHAR(255) NOT NULL, `cycleNumber` BIGINT NOT NULL, `data` JSON NOT NULL, `timestamp` BIGINT NOT NULL, `hash` VARCHAR(255) NOT NULL, PRIMARY KEY (`accountId`, `cycleNumber`))')

    // , `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL
    // `id` INTEGER PRIMARY KEY AUTOINCREMENT,
    // await this.run('CREATE TABLE if not exists `accounts` (`address` VARCHAR(255) NOT NULL PRIMARY KEY, `modified` BIGINT NOT NULL, `sequence` BIGINT NOT NULL, `owners` JSON NOT NULL, `signs` SMALLINT NOT NULL, `balance` DOUBLE PRECISION NOT NULL, `type` VARCHAR(255) NOT NULL, `data` JSON NOT NULL, `hash` VARCHAR(255) NOT NULL, `txs` TEXT NOT NULL, `timestamp` BIGINT NOT NULL)')

    await this.run('PRAGMA synchronous = OFF')
    await this.run('PRAGMA journal_mode = MEMORY')

    this.initialized = true
    this.mainLogger.info('Database initialized.')
  }
  async close () {
    // this.mainLogger.info('Closing Database connections.')
    await this.db.close()
  }
  async runCreate (createStatement) {
    await this.run(createStatement)
  }

  async dropAndCreateModel (model) {
    // await model.sync({ force: true })
  }

  _checkInit () {
    if (!this.initialized) throw new Error('Storage not initialized.')
  }

  _create (table, object, opts) {
    // console.log('_create2: ' + stringify(object))
    if (Array.isArray(object)) {
      // return table.bulkCreate(values, opts)
      // todo transaciton or something else

      for (let subObj of object) {
        // console.log('sub obj: ' + stringify(subObj))
        this._create(table, subObj, opts)
      }
      return
    }
    let queryString = table.insertString
    if (opts && opts.createOrReplace) {
      queryString = table.insertOrReplaceString
    }
    let inputs = []
    // console.log('columns: ' + stringify(table.columns))
    for (let column of table.columns) {
      let value = object[column]

      if (table.isColumnJSON[column]) {
        value = stringify(value)
      }
      // console.log(`column: ${column}  ${value}`)
      inputs.push(value)
    }
    queryString += this.options2string(opts)

    // console.log(queryString + '  VALUES: ' + stringify(inputs))
    return this.run(queryString, inputs)
  }

  async _read (table, params, opts) {
    // return table.findAll({ where, ...opts })
    let queryString = table.selectString

    // let valueArray = []

    let paramsArray = this.params2Array(params, table)

    let { whereString, whereValueArray } = this.paramsToWhereStringAndValues(paramsArray)

    let valueArray = whereValueArray
    queryString += whereString
    queryString += this.options2string(opts)

    // console.log(queryString + '  VALUES: ' + stringify(valueArray))

    let results = await this.all(queryString, valueArray)
    // optionally parse results!
    if (!opts || !opts.raw) {
      if (table.JSONkeys.length > 0) {
        // for (let i = 0; i < results.length; i++) {
        //   let result = results[i]
        //   console.log('todo parse this??? ' + result)
        // }
      }
    }
    return results
  }

  _update (table, values, where, opts) {
    // return table.update(values, { where, ...opts })
    let queryString = table.updateString

    let valueParams = this.params2Array(values, table)
    let { resultString, valueArray } = this.paramsToAssignmentStringAndValues(valueParams)

    queryString += resultString

    let whereParams = this.params2Array(where, table)
    let { whereString, whereValueArray } = this.paramsToWhereStringAndValues(whereParams)
    queryString += whereString

    valueArray = valueArray.concat(whereValueArray)

    queryString += this.options2string(opts)

    // console.log(queryString + '  VALUES: ' + stringify(valueArray))
    return this.run(queryString, valueArray)
  }
  _delete (table, where, opts) {
    // if (!where) {
    //   return table.destroy({ ...opts })
    // }
    // return table.destroy({ where, ...opts })

    let queryString = table.deleteString

    let whereParams = this.params2Array(where, table)
    let { whereString, whereValueArray } = this.paramsToWhereStringAndValues(whereParams)
    let valueArray = whereValueArray
    queryString += whereString
    queryString += this.options2string(opts)

    // console.log(queryString + '  VALUES: ' + stringify(valueArray))
    return this.run(queryString, valueArray)
  }

  _rawQuery (queryString, valueArray) {
    // return this.sequelize.query(query, { model: table })

    return this.all(queryString, valueArray)
  }

  params2Array (paramsObj, table) {
    if (paramsObj == null) {
      return []
    }
    let paramsArray = []
    for (var key in paramsObj) {
      if (paramsObj.hasOwnProperty(key)) {
        let paramEntry: any = { name: key }

        let value = paramsObj[key]
        if (utils.isObject(value)) {
          // WHERE column_name BETWEEN value1 AND value2;
          if (value[Op.between]) {
            let between = value[Op.between]
            paramEntry.type = 'BETWEEN'
            paramEntry.v1 = between[0]
            paramEntry.v2 = between[1]
            paramEntry.sql = `${paramEntry.name} ${paramEntry.type} ? AND ? `
            paramEntry.vals = [paramEntry.v1, paramEntry.v2]
          }
          // WHERE column_name IN (value1, value2, ...)
          if (value[Op.in]) {
            let inValues = value[Op.in]
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
            let rightHandValue = value[Op.lte]
            paramEntry.type = 'LTE'
            paramEntry.v1 = rightHandValue
            // paramEntry.v2 = between[1]
            paramEntry.sql = `${paramEntry.name} <= ?`
            paramEntry.vals = [paramEntry.v1]
          }
          if (value[Op.gte]) {
            let rightHandValue = value[Op.gte]
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

  paramsToWhereStringAndValues (paramsArray) {
    let whereValueArray = []
    let whereString = ''
    for (let i = 0; i < paramsArray.length; i++) {
      if (i === 0) {
        whereString += ' WHERE '
      }
      let paramEntry = paramsArray[i]
      whereString += '(' + paramEntry.sql + ')'
      if (i < paramsArray.length - 1) {
        whereString += ' AND '
      }
      whereValueArray = whereValueArray.concat(paramEntry.vals)
    }
    return { whereString, whereValueArray }
  }

  paramsToAssignmentStringAndValues (paramsArray) {
    let valueArray = []
    let resultString = ''
    for (let i = 0; i < paramsArray.length; i++) {
      let paramEntry = paramsArray[i]
      resultString += paramEntry.sql
      if (i < paramsArray.length - 1) {
        resultString += ' , '
      }
      valueArray = valueArray.concat(paramEntry.vals)
    }
    return { resultString, valueArray }
  }

  options2string (optionsObj) {
    if (optionsObj == null) {
      return ''
    }
    let optionsString = ''
    if (optionsObj.order) {
      optionsString += ' ORDER BY '
      for (let i = 0; i < optionsObj.order.length; i++) {
        let orderEntry = optionsObj.order[i]
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
  run (sql, params = []) {
    return new Promise((resolve, reject) => {
      try {
        const { lastInsertRowid } = this.db.prepare(sql).run(params)
        resolve({ id: lastInsertRowid })
      } catch (err) {
        console.log('Error running sql ' + sql)
        console.log(err)
        reject(err)
      }
    })
  }
  get (sql, params = []) {
    return new Promise((resolve, reject) => {
      try {
        const result = this.db.prepare(sql).get(params)
        resolve(result)
      } catch (err) {
        console.log('Error running sql: ' + sql)
        console.log(err)
        reject(err)
      }
    })
  }

  all (sql, params = []) {
    return new Promise((resolve, reject) => {
      try {
        const rows = this.db.prepare(sql).all(params)
        resolve(rows)
      } catch (err) {
        console.log('Error running sql: ' + sql)
        console.log(err)
        reject(err)
      }
    })
  }
}

// From: https://stackoverflow.com/a/21196961
async function _ensureExists (dir) {
  return new Promise((resolve, reject) => {
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

export default BetterSqlite3Storage
