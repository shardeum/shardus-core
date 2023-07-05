import Log4js from 'log4js'
import Sqlite3 from 'better-sqlite3'
import stringify from 'fast-stable-stringify'
import * as Shardus from '../shardus/shardus-types'
import Profiler from '../utils/profiler'
import fs from 'fs'
import path from 'path'
import * as Sequelize from 'sequelize'
import * as utils from '../utils'
import Logger, { logFlags } from '../logger'
import { GenericObject, ModelAttributes, ModelData, OperationOptions, ParamEntry } from '.'
import { Database } from 'better-sqlite3';
import { ColumnDescription } from 'sequelize'

const Op = Sequelize.Op

interface BetterSqlite3Storage {
  baseDir: string
  storageConfig: Shardus.StrictStorageConfiguration
  profiler: Profiler
  mainLogger: Log4js.Logger
  initialized: boolean
  storageModels: { [tableName: string]: ModelData }
  db: Database
}

class BetterSqlite3Storage {
  // note that old storage passed in logger, now we pass in the specific log for it to use.  This works for application use, but may need to rethink if we apply this to shardus core
  constructor(
    models: [string, ModelAttributes][],
    storageConfig: Shardus.StrictStorageConfiguration,
    logger: Logger,
    baseDir: string,
    profiler: Profiler
  ) {
    this.baseDir = baseDir
    this.storageConfig = storageConfig
    this.storageConfig.options.storage = path.join(this.baseDir, this.storageConfig.options.storage)
    this.profiler = profiler

    // Setup logger
    this.mainLogger = logger.getLogger('main')

    // Start sqlite and load models
    this.initialized = false
    this.storageModels = {}
    for (const [modelName, modelAttributes] of models) {
      this.sqlite3Define(modelName, modelAttributes)
    }
  }

  sqlite3Define(modelName: string, modelAttributes: ModelAttributes): void {
    const tableName = modelName

    const modelData: ModelData = {
        tableName,
        columns: [],
        columnsString: '',
        substitutionString: '',
        isColumnJSON: {},
        JSONkeys: []
    }
    for (const key in modelAttributes) {
      if (Object.prototype.hasOwnProperty.call(modelAttributes, key)) {
        modelData.columns.push(key)
        // eslint-disable-next-line security/detect-object-injection
        const value = modelAttributes[key]

        let type: string | ColumnDescription  = value.type
        if (!type) {
          type = value
        }
        if (type.toString() === Sequelize.JSON.toString()) {
          // eslint-disable-next-line security/detect-object-injection
          modelData.isColumnJSON[key] = true
          modelData.JSONkeys.push(key)
        } else {
          // eslint-disable-next-line security/detect-object-injection
          modelData.isColumnJSON[key] = false
        }
      }
    }
    for (let i = 0; i < modelData.columns.length; i++) {
      // eslint-disable-next-line security/detect-object-injection
      const key = modelData.columns[i]
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

    // eslint-disable-next-line security/detect-object-injection
    this.storageModels[tableName] = modelData

    // todo base this off of models
  }

  async init(): Promise<void> {
    // Create dbDir if it doesn't exist
    const dbDir = path.parse(this.storageConfig.options.storage).dir
    await _ensureExists(dbDir)
    this.mainLogger.info('Created Database directory.')
    if (this.storageConfig.options.memoryFile) {
      this.db = new Sqlite3(':memory:')
    } else {
      this.db = new Sqlite3(this.storageConfig.options.storage)
    }

    await this.run('PRAGMA synchronous = OFF')
    await this.run('PRAGMA journal_mode = MEMORY')

    this.initialized = true
    this.mainLogger.info('Database initialized.')
  }
  async close(): Promise<void> {
    this.db.close()
  }
  async runCreate(createStatement: string): Promise<void> {
    await this.run(createStatement)
  }

  _checkInit(): void {
    if (!this.initialized) throw new Error('Storage not initialized.')
  }

  _create(table: ModelData, object: GenericObject, opts: OperationOptions): Promise<unknown> {
    if (Array.isArray(object)) {
      // TODO transaciton or something else

      for (const subObj of object) {
        this._create(table, subObj, opts)
      }
      return
    }
    let queryString = table.insertString
    if (opts && opts.createOrReplace) {
      queryString = table.insertOrReplaceString
    }
    const inputs = []
    for (const column of table.columns) {
      // eslint-disable-next-line security/detect-object-injection
      let value = object[column]

      // eslint-disable-next-line security/detect-object-injection
      if (table.isColumnJSON[column]) {
        value = stringify(value)
      }
      inputs.push(value)
    }
    queryString += this.options2string(opts)

    return this.run(queryString, inputs)
  }

  async _read<T>(table: ModelData, params: GenericObject, opts: OperationOptions): Promise<T[]> {
    let queryString = table.selectString

    const paramsArray = this.params2Array(params, table)

    const { whereString, whereValueArray } = this.paramsToWhereStringAndValues(paramsArray)

    const valueArray = whereValueArray
    queryString += whereString
    queryString += this.options2string(opts)

    return await this.all<T>(queryString, valueArray)
  }

  _update(table: ModelData, values: GenericObject, where: GenericObject, opts: OperationOptions): Promise<unknown> {
    let queryString = table.updateString

    const valueParams = this.params2Array(values, table)
    const { resultString, valueArray } = this.paramsToAssignmentStringAndValues(valueParams)

    queryString += resultString

    const whereParams = this.params2Array(where, table)
    const { whereString, whereValueArray } = this.paramsToWhereStringAndValues(whereParams)
    queryString += whereString

    const newValueArray = valueArray.concat(whereValueArray)

    queryString += this.options2string(opts)

    return this.run(queryString, newValueArray)
  }
  _delete(table: ModelData, where: GenericObject, opts: OperationOptions): Promise<unknown> {
    let queryString = table.deleteString

    const whereParams = this.params2Array(where, table)
    const { whereString, whereValueArray } = this.paramsToWhereStringAndValues(whereParams)
    const valueArray = whereValueArray
    queryString += whereString
    queryString += this.options2string(opts)

    return this.run(queryString, valueArray)
  }

  _rawQuery<T>(queryString: string, valueArray: unknown[]): Promise<T[]> {
    return this.all(queryString, valueArray)
  }

  params2Array(paramsObj: GenericObject, table: ModelData): ParamEntry[] {
    if (paramsObj == null) {
      return []
    }
    const paramsArray = []
    for (const key in paramsObj) {
      if (Object.prototype.hasOwnProperty.call(paramsObj, key)) {
        const paramEntry: ParamEntry = { name: key }

        // eslint-disable-next-line security/detect-object-injection
        const value = paramsObj[key]
        if (utils.isObject(value)) {
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

  paramsToWhereStringAndValues(paramsArray: ParamEntry[]): { whereString: string; whereValueArray: unknown[] } {
    let whereValueArray = []
    let whereString = ''
    for (let i = 0; i < paramsArray.length; i++) {
      if (i === 0) {
        whereString += ' WHERE '
      }
      // eslint-disable-next-line security/detect-object-injection
      const paramEntry = paramsArray[i]
      whereString += '(' + paramEntry.sql + ')'
      if (i < paramsArray.length - 1) {
        whereString += ' AND '
      }
      whereValueArray = whereValueArray.concat(paramEntry.vals)
    }
    return { whereString, whereValueArray }
  }

  paramsToAssignmentStringAndValues(paramsArray: ParamEntry[]): { resultString: string; valueArray: unknown[] } {
    let valueArray = []
    let resultString = ''
    for (let i = 0; i < paramsArray.length; i++) {
      // eslint-disable-next-line security/detect-object-injection
      const paramEntry = paramsArray[i]
      resultString += paramEntry.sql
      if (i < paramsArray.length - 1) {
        resultString += ' , '
      }
      valueArray = valueArray.concat(paramEntry.vals)
    }
    return { resultString, valueArray }
  }

  options2string(optionsObj: OperationOptions): string {
    if (optionsObj == null) {
      return ''
    }
    let optionsString = ''
    if (optionsObj.order) {
      optionsString += ' ORDER BY '
      for (let i = 0; i < optionsObj.order.length; i++) {
        // eslint-disable-next-line security/detect-object-injection
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
  run(sql: string, params = []): Promise<{ id: number | bigint }> {
    return new Promise((resolve, reject) => {
      try {
        const { lastInsertRowid } = this.db.prepare(sql).run(params)
        resolve({ id: lastInsertRowid })
      } catch (err) {
        if (logFlags.console) console.log('Error running sql ' + sql)
        if (logFlags.console) console.log(err)
        reject(err)
      }
    })
  }
  get<T>(sql: string, params = []): Promise<T> {
    return new Promise((resolve, reject) => {
      try {
        const result = this.db.prepare(sql).get(params)
        resolve(result)
      } catch (err) {
        if (logFlags.console) console.log('Error running sql: ' + sql)
        if (logFlags.console) console.log(err)
        reject(err)
      }
    })
  }

  all<T>(sql: string, params = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      try {
        const rows = this.db.prepare(sql).all(params)
        resolve(rows)
      } catch (err) {
        if (logFlags.console) console.log('Error running sql: ' + sql)
        if (logFlags.console) console.log(err)
        reject(err)
      }
    })
  }
}

// From: https://stackoverflow.com/a/21196961
async function _ensureExists(dir: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // only creates an empty directory and does nothing if it already exists
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

export default BetterSqlite3Storage
