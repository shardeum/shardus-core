// const fs = require('fs')
// const path = require('path')
const Sequelize = require('sequelize')
const Op = Sequelize.Op
const models = require('./models')
const stringify = require('fast-stable-stringify')
// const utils = require('../utils')

// const SequelizeStorage = require('./sequelizeStorage')
// const Sqlite3Storage = require('./sqlite3storage')
const BetterSqlite3Storage = require('./betterSqlite3storage')

class Storage {
  constructor (baseDir, config, logger, profiler) {
    this.profiler = profiler

    this.mainLogger = logger.getLogger('main')
    // this.storage = new SequelizeStorage(models, config, logger, baseDir, this.profiler)

    this.storage = new BetterSqlite3Storage(models, config, logger, baseDir, this.profiler)
  }

  async init () {
    await this.storage.init()

    // get models and helper methods from the storage class we just initializaed.
    this.storageModels = this.storage.storageModels

    this._create = async (table, values, opts) => this.storage._create(table, values, opts)
    this._read = async (table, where, opts) => this.storage._read(table, where, opts)
    this._update = async (table, values, where, opts) => this.storage._update(table, values, where, opts)
    this._delete = async (table, where, opts) => this.storage._delete(table, where, opts)
    this._query = async (query, tableModel) => this.storage._rawQuery(query, tableModel)

    this.initialized = true
  }
  async close () {
    this.mainLogger.info('Closing Database connections.')
    await this.storage.close()
  }

  _checkInit () {
    if (!this.initialized) throw new Error('Storage not initialized.')
  }

  async deleteAndRecreateAccountData () {
    await this.storage.dropAndCreateModel(this.storageModels.accounts)
  }

  // constructor (baseDir, config, logger, profiler) {
  //   this.profiler = profiler
  //   // Setup logger
  //   this.mainLogger = logger.getLogger('main')
  //   // Create dbDir if it doesn't exist
  //   config.options.storage = path.join(baseDir, config.options.storage)
  //   let dbDir = path.parse(config.options.storage).dir
  //   _ensureExists(dbDir)
  //   this.mainLogger.info('Created Database directory.')

  //   // Start Sequelize and load models
  //   // this.sequelize = new Sequelize(...Object.values(config))
  //   // for (let [modelName, modelAttributes] of models) {
  //   //   this.sequelize.define(modelName, modelAttributes)
  //   // }
  //   this.storageModels = this.sequelize.models
  //   this.initialized = false

  //   // this.db = new sqlite3.Database(path.join(dbDir, 'db2.sqlite')) // ':memory:'
  //   // this.db = new sqlite3.Database(':memory:')

  //   // sqlite3_exec(db, "PRAGMA synchronous = OFF", NULL, NULL, &sErrMsg);
  //   // sqlite3_exec(db, "PRAGMA journal_mode = MEMORY", NULL, NULL, &sErrMsg);
  //   // this.run('PRAGMA synchronous = OFF')
  //   // this.run('PRAGMA journal_mode = MEMORY')

  //   // this.run('PRAGMA synchronous = OFF')
  //   // this.run('PRAGMA journal_mode = MEMORY')

  //   // this._rawQuery(this.storageModels.acceptedTxs, 'PRAGMA synchronous = OFF')
  //   // this._rawQuery(this.storageModels.acceptedTxs, 'PRAGMA journal_mode = MEMORY')
  // }

  // async init () {
  //   // Create tables for models in DB if they don't exist
  //   for (let model of Object.values(this.storageModels)) {
  //     await model.sync()
  //     this._rawQuery(model, 'PRAGMA synchronous = OFF')
  //     this._rawQuery(model, 'PRAGMA journal_mode = MEMORY')
  //   }

  //   this.initialized = true
  //   this.mainLogger.info('Database initialized.')

  //   // , `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL
  //   // `id` TEXT NOT NULL PRIMARY KEY,
  //   // `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  //   // this.db.run('CREATE TABLE if not exists `acceptedTxs` (`id` VARCHAR(255) NOT NULL PRIMARY KEY, `timestamp` BIGINT NOT NULL, `data` JSON NOT NULL, `status` VARCHAR(255) NOT NULL, `receipt` JSON NOT NULL)')
  //   // this.db.run('CREATE TABLE if not exists `accountStates` ( `accountId` VARCHAR(255) NOT NULL, `txId` VARCHAR(255) NOT NULL, `txTimestamp` BIGINT NOT NULL, `stateBefore` VARCHAR(255) NOT NULL, `stateAfter` VARCHAR(255) NOT NULL)')
  //   // this.db.run('CREATE TABLE if not exists `cycles` (`counter` BIGINT NOT NULL UNIQUE PRIMARY KEY, `certificate` JSON NOT NULL, `previous` TEXT NOT NULL, `marker` TEXT NOT NULL, `start` BIGINT NOT NULL, `duration` BIGINT NOT NULL, `active` BIGINT NOT NULL, `desired` BIGINT NOT NULL, `joined` JSON NOT NULL, `activated` JSON NOT NULL, `removed` JSON NOT NULL, `returned` JSON NOT NULL, `lost` JSON NOT NULL)')
  //   // this.db.run('CREATE TABLE if not exists `nodes` (`id` TEXT NOT NULL PRIMARY KEY, `publicKey` TEXT NOT NULL, `cycleJoined` TEXT NOT NULL, `internalIp` VARCHAR(255) NOT NULL, `externalIp` VARCHAR(255) NOT NULL, `internalPort` SMALLINT NOT NULL, `externalPort` SMALLINT NOT NULL, `joinRequestTimestamp` BIGINT NOT NULL, `address` VARCHAR(255) NOT NULL, `status` VARCHAR(255) NOT NULL)')
  //   // this.db.run('CREATE TABLE if not exists `properties` (`key` VARCHAR(255) NOT NULL PRIMARY KEY, `value` JSON)')
  // }
  // async close () {
  //   this.mainLogger.info('Closing Database connections.')
  //   await this.sequelize.close()
  // }

  // async dropAndCreateModel (model) {
  //   await model.sync({ force: true })
  // }

  async addCycles (cycles) {
    this._checkInit()
    try {
      await this._create(this.storageModels.cycles, cycles)
    } catch (e) {
      throw new Error(e)
    }
  }
  async getCycleByCounter (counter) {
    this._checkInit()
    try {
      var [ cycle ] = await this._read(this.storageModels.cycles, { counter }, { attributes: { exclude: ['createdAt', 'updatedAt'] } })
    } catch (e) {
      throw new Error(e)
    }
    if (cycle && cycle.dataValues) {
      return cycle.dataValues
    }
    return null
  }
  async getCycleByMarker (marker) {
    this._checkInit()
    try {
      var [ cycle ] = await this._read(this.storageModels.cycles, { marker }, { attributes: { exclude: ['createdAt', 'updatedAt'] } })
    } catch (e) {
      throw new Error(e)
    }
    if (cycle && cycle.dataValues) {
      return cycle.dataValues
    }
    return null
  }
  async deleteCycleByCounter (counter) {
    this._checkInit()
    try {
      await this._delete(this.storageModels.cycles, { counter })
    } catch (e) {
      throw new Error(e)
    }
  }
  async deleteCycleByMarker (marker) {
    this._checkInit()
    try {
      await this._delete(this.storageModels.cycles, { marker })
    } catch (e) {
      throw new Error(e)
    }
  }
  async listCycles () {
    this._checkInit()
    try {
      var cycles = await this._read(this.storageModels.cycles, null, { attributes: { exclude: ['createdAt', 'updatedAt'] } })
    } catch (e) {
      throw new Error(e)
    }
    return cycles.map(c => c.dataValues)
  }

  async addNodes (nodes) {
    this._checkInit()
    try {
      await this._create(this.storageModels.nodes, nodes)
    } catch (e) {
      throw new Error(e)
    }
  }
  async getNodes (node) {
    this._checkInit()
    try {
      var nodes = await this._read(this.storageModels.nodes, node, { attributes: { exclude: ['createdAt', 'updatedAt'] }, raw: true })
    } catch (e) {
      throw new Error(e)
    }
    return nodes
  }
  async updateNodes (node, newNode) {
    this._checkInit()
    try {
      await this._update(this.storageModels.nodes, newNode, node)
    } catch (e) {
      throw new Error(e)
    }
  }
  async deleteNodes (node) {
    this._checkInit()
    try {
      await this._delete(this.storageModels.nodes, node)
    } catch (e) {
      throw new Error(e)
    }
  }
  async listNodes () {
    this._checkInit()
    try {
      var nodes = await this._read(this.storageModels.nodes, null, { attributes: { exclude: ['createdAt', 'updatedAt'] }, raw: true })
    } catch (e) {
      throw new Error(e)
    }
    return nodes
  }

  async setProperty (key, value) {
    this._checkInit()
    try {
      let [ prop ] = await this._read(this.storageModels.properties, { key })
      if (!prop) {
        await this._create(this.storageModels.properties, {
          key,
          value: JSON.stringify(value)
        })
      } else {
        await this._update(this.storageModels.properties, {
          key,
          value: JSON.stringify(value)
        }, { key })
      }
    } catch (e) {
      throw new Error(e)
    }
  }
  async getProperty (key) {
    this._checkInit()
    try {
      var [ prop ] = await this._read(this.storageModels.properties, { key })
    } catch (e) {
      throw new Error(e)
    }
    if (prop && prop.value) {
      return JSON.parse(prop.value)
    }
    return null
  }
  async deleteProperty (key) {
    this._checkInit()
    try {
      await this._delete(this.storageModels.properties, { key })
    } catch (e) {
      throw new Error(e)
    }
  }
  async listProperties () {
    this._checkInit()
    try {
      var keys = await this._read(this.storageModels.properties, null, { attributes: ['key'], raw: true })
    } catch (e) {
      throw new Error(e)
    }
    return keys.map(k => k.key)
  }

  async clearP2pState () {
    this._checkInit()
    try {
      await this._delete(this.storageModels.cycles, null, { truncate: true })
      await this._delete(this.storageModels.nodes, null, { truncate: true })
    } catch (e) {
      throw new Error(e)
    }
  }
  async clearAppRelatedState () {
    this._checkInit()
    try {
      await this._delete(this.storageModels.accountStates, null, { truncate: true })
      await this._delete(this.storageModels.acceptedTxs, null, { truncate: true })
    } catch (e) {
      throw new Error(e)
    }
  }

  async addAcceptedTransactions (acceptedTransactions) {
    this._checkInit()
    try {
      await this._create(this.storageModels.acceptedTxs, acceptedTransactions)
    } catch (e) {
      throw new Error(e)
    }
  }

  async addAcceptedTransactions2 (acceptedTransactions) {
    this._checkInit()
    try {
      // await this._create(this.storageModels.acceptedTxs, acceptedTransactions)
      acceptedTransactions = acceptedTransactions[0] // hack
      if (acceptedTransactions == null) {
        console.log('fail no atx')
        return
      }
      let ts = Date.now()
      let query = `INSERT INTO acceptedTxs (id,timestamp,data,status,receipt,createdAt,updatedAt) VALUES ('${acceptedTransactions.id}', '${acceptedTransactions.timestamp}', '${stringify(acceptedTransactions.data)}', '${acceptedTransactions.status}', '${stringify(acceptedTransactions.receipt)}', '${ts}', '${ts}' )`
      // console.log('find:' + this.sequelize.QueryTypes.INSERT)
      // console.log('b' + this.sequelize.QueryType.INSERT)
      // await this._rawQuery(this.storageModels.acceptedTxs, query)
      // await this.sequelize.query({ query, values: [] }, { model: this.storageModels.acceptedTxs, type: this.sequelize.QueryType.INSERT })
      await this.sequelize.query(query, { model: this.storageModels.acceptedTxs, type: this.sequelize.QueryTypes.INSERT })

      // await this._rawQuery(this.storageModels.acceptedTxs, `INSERT INTO acceptedTxs (id,timestamp,data,status,receipt,createdAt,updatedAt) VALUES ("${acceptedTransactions.id}", "${acceptedTransactions.timestamp}", "${stringify(acceptedTransactions.data)}", "${acceptedTransactions.status}", "${stringify(acceptedTransactions.receipt)}", "${ts}", "${ts}" )`)
      // await this._rawQuery(this.storageModels.acceptedTxs, `INSERT INTO acceptedTxs (id,timestamp,data,status,receipt) VALUES (${acceptedTransactions.id}, ${acceptedTransactions.timestamp}, ${stringify(acceptedTransactions.data)}, ${acceptedTransactions.status}, ${stringify(acceptedTransactions.receipt)} )`)
      // await this.sequelize.query(`INSERT INTO acceptedTxs (id,timestamp,data,status,receipt,createdAt,updatedAt) VALUES ('${acceptedTransactions.id}', '${acceptedTransactions.timestamp}', '${stringify(acceptedTransactions.data)}', '${acceptedTransactions.status}', '${stringify(acceptedTransactions.receipt)}', '${ts}', '${ts}')`,
      //   { model: this.storageModels.acceptedTxs, type: this.sequelize.QueryType.INSERT })
    } catch (e) {
      throw new Error(e)
    }
  }

  async addAccountStates (accountStates) {
    this._checkInit()
    try {
      await this._create(this.storageModels.accountStates, accountStates)
    } catch (e) {
      throw new Error(e)
    }
  }

  // // async function _sleep (ms = 0) {
  // //   return new Promise(resolve => setTimeout(resolve, ms))
  // // }

  // async addAcceptedTransactions2 (acceptedTransactions) {
  //   this._checkInit()
  //   try {
  //     // await this._create(this.storageModels.acceptedTxs, acceptedTransactions) //, Date.now(), Date.now(),
  //     // await new Promise(resolve => this.db.run("INSERT INTO acceptedTxs ('id','timestamp','data','status','receipt','createdAt','updatedAt') VALUES (?, ?2, ?3, ?3, ?4, ?5, ?6, ?7)",
  //     //   [acceptedTransactions.id, acceptedTransactions.timestamp, acceptedTransactions.data, acceptedTransactions.status, acceptedTransactions.receipt, Date.now(), Date.now()],
  //     //   resolve))

  //     // console.log(' data: ' + JSON.stringify(acceptedTransactions.data))
  //     await this.run(`INSERT INTO acceptedTxs (id,timestamp,data,status,receipt,createdAt,updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  //       [acceptedTransactions.id, acceptedTransactions.timestamp, stringify(acceptedTransactions.data), acceptedTransactions.status, stringify(acceptedTransactions.receipt), Date.now(), Date.now()])

  //     // INSERT INTO `acceptedTxs`(`id`,`timestamp`,`data`,`status`,`receipt`,`createdAt`,`updatedAt`) VALUES (770270327989,0,'','','','','');
  //   } catch (e) {
  //     throw new Error(e)
  //   }
  // }

  // async addAcceptedTransactions3 (acceptedTransactions) {
  //   this._checkInit()
  //   try {
  //     await this._create2(this.storageModels.acceptedTxs, acceptedTransactions)
  //   } catch (e) {
  //     throw new Error(e)
  //   }
  // }

  // async addAccountStates2 (accountStates) {
  //   this._checkInit()
  //   try {
  //     await this._create2(this.storageModels.accountStates, accountStates)
  //   } catch (e) {
  //     throw new Error(e)
  //   }
  // }

  async queryAcceptedTransactions (tsStart, tsEnd, limit) {
    this._checkInit()
    try {
      let result = await this._read(
        this.storageModels.acceptedTxs,
        { timestamp: { [Op.between]: [tsStart, tsEnd] } },
        {
          limit: limit,
          order: [ ['timestamp', 'ASC'] ],
          attributes: { exclude: ['createdAt', 'updatedAt', 'id'] },
          raw: true
        }
      )
      return result
    } catch (e) {
      throw new Error(e)
    }
  }
  async queryAccountStateTable (accountStart, accountEnd, tsStart, tsEnd, limit) {
    this._checkInit()
    try {
      let result = await this._read(
        this.storageModels.accountStates,
        { accountId: { [Op.between]: [accountStart, accountEnd] }, txTimestamp: { [Op.between]: [tsStart, tsEnd] } },
        {
          limit: limit,
          order: [ ['txTimestamp', 'ASC'], ['accountId', 'ASC'] ],
          attributes: { exclude: ['createdAt', 'updatedAt', 'id'] },
          raw: true
        }
      )
      return result
    } catch (e) {
      throw new Error(e)
    }
  }

  // async queryAccountStateTable2 (accountStart, accountEnd, tsStart, tsEnd, limit) {
  //   this._checkInit()
  //   try {
  //     let result = await this._read2(
  //       this.storageModels_sqlite.accountStates,
  //       { accountId: { [Op.between]: [accountStart, accountEnd] }, txTimestamp: { [Op.between]: [tsStart, tsEnd] } },
  //       {
  //         limit: limit,
  //         order: [ ['txTimestamp', 'ASC'], ['accountId', 'ASC'] ],
  //         attributes: { exclude: ['createdAt', 'updatedAt', 'id'] },
  //         raw: true
  //       }
  //     )
  //     return result
  //   } catch (e) {
  //     throw new Error(e)
  //   }
  // }

  async searchAccountStateTable (accountId, txTimestamp) {
    this._checkInit()
    try {
      let result = await this._read(
        this.storageModels.accountStates,
        { accountId, txTimestamp },
        {
          attributes: { exclude: ['createdAt', 'updatedAt', 'id'] },
          raw: true
        }
      )
      return result
    } catch (e) {
      throw new Error(e)
    }
  }

  async dropAndCreateAcceptedTransactions () {
    await this.storage.dropAndCreateModel(this.storageModels.acceptedTxs)
  }

  async dropAndCreatAccountStateTable () {
    await this.storage.dropAndCreateModel(this.storageModels.accountStates)
  }

  // example of a raw query with some similarities to what we want:

  // async getAllLatestAccounts () {
  //   let accounts
  //   this._checkInit()
  //   try {
  //     // accounts = await this._read(this.storageModels.accounts, null, { attributes: { exclude: ['createdAt', 'updatedAt'] }, raw: true })
  //     const query = `select * from accounts acct1 inner join
  //     (select address, max(timestamp) ts from accounts group by address) acct2
  //     on acct1.address = acct2.address and acct1.timestamp = acct2.ts`
  //     accounts = await this._query(query, this.storageModels.accounts)
  //     this.mainLogger.debug(`Accounts: ${accounts}`)
  //   } catch (e) {
  //     let errMsg = `Failed to retrieve getLatestAllAccounts() ==> Exception: ${e}`
  //     this.mainLogger.error(errMsg)
  //     throw new Error(errMsg)
  //   }
  //   return accounts
  // }

  // _checkInit () {
  //   if (!this.initialized) throw new Error('Storage not initialized.')
  // }

  // _create (table, values, opts) {
  //   if (Array.isArray(values)) {
  //     return table.bulkCreate(values, opts)
  //   }
  //   return table.create(values, opts)
  // }
  // _read (table, where, opts) {
  //   return table.findAll({ where, ...opts })
  // }
  // _update (table, values, where, opts) {
  //   return table.update(values, { where, ...opts })
  // }
  // _delete (table, where, opts) {
  //   if (!where) {
  //     return table.destroy({ ...opts })
  //   }
  //   return table.destroy({ where, ...opts })
  // }
  // _rawQuery (table, query) {
  //   return this.sequelize.query(query, { model: table })
  // }

  // async _create (table, values, opts) {
  //   let res = null
  //   try {
  //     this.profiler.profileSectionStart('db')
  //     if (Array.isArray(values)) {
  //       res = await table.bulkCreate(values, opts)
  //     }
  //     res = await table.create(values, opts)
  //   } finally {
  //     this.profiler.profileSectionEnd('db')
  //   }
  //   return res
  // }
  // async _read (table, where, opts) {
  //   let res = null
  //   try {
  //     this.profiler.profileSectionStart('db')
  //     res = await table.findAll({ where, ...opts })
  //   } finally {
  //     this.profiler.profileSectionEnd('db')
  //   }
  //   return res
  // }
  // async _update (table, values, where, opts) {
  //   let res = null
  //   try {
  //     this.profiler.profileSectionStart('db')
  //     res = await table.update(values, { where, ...opts })
  //   } finally {
  //     this.profiler.profileSectionEnd('db')
  //   }
  //   return res
  // }
  // async _delete (table, where, opts) {
  //   let res = null
  //   try {
  //     this.profiler.profileSectionStart('db')
  //     if (!where) {
  //       res = await table.destroy({ ...opts })
  //     }
  //     res = await table.destroy({ where, ...opts })
  //   } finally {
  //     this.profiler.profileSectionEnd('db')
  //   }
  //   return res
  // }
  // async _rawQuery (table, query) {
  //   let res = null
  //   try {
  //     this.profiler.profileSectionStart('db')
  //     res = await this.sequelize.query(query, { model: table })
  //   } finally {
  //     this.profiler.profileSectionEnd('db')
  //   }
  //   return res
  // }

  // from : https://stackabuse.com/a-sqlite-tutorial-with-node-js/

  // { accountId: { [Op.between]: [accountStart, accountEnd] }, txTimestamp: { [Op.between]: [tsStart, tsEnd] } },
  // {
  //   limit: limit,
  //   order: [ ['txTimestamp', 'ASC'], ['accountId', 'ASC'] ],
  //   attributes: { exclude: ['createdAt', 'updatedAt', 'id'] },
  //   raw: true
  // }
  // var [ cycle ] = await this._read(this.storageModels.cycles, { marker }, { attributes: { exclude: ['createdAt', 'updatedAt'] } })
}

// From: https://stackoverflow.com/a/21196961
// async function _ensureExists (dir) {
//   return new Promise((resolve, reject) => {
//     fs.mkdir(dir, { recursive: true }, (err) => {
//       if (err) {
//         // Ignore err if folder exists
//         if (err.code === 'EEXIST') resolve()
//         // Something else went wrong
//         else reject(err)
//       } else {
//         // Successfully created folder
//         resolve()
//       }
//     })
//   })
// }
module.exports = Storage
