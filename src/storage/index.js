const fs = require('fs')
const path = require('path')
const Sequelize = require('sequelize')
const Op = Sequelize.Op
const models = require('./models')
var sqlite3 = require('sqlite3').verbose()
const stringify = require('fast-stable-stringify')

class Storage {
  constructor (baseDir, config, logger, profiler) {
    this.profiler = profiler
    // Setup logger
    this.mainLogger = logger.getLogger('main')
    // Create dbDir if it doesn't exist
    config.options.storage = path.join(baseDir, config.options.storage)
    let dbDir = path.parse(config.options.storage).dir
    _ensureExists(dbDir)
    this.mainLogger.info('Created Database directory.')
    // Start Sequelize and load models
    this.sequelize = new Sequelize(...Object.values(config))
    for (let [modelName, modelAttributes] of models) this.sequelize.define(modelName, modelAttributes)
    this.models = this.sequelize.models
    this.initialized = false

    this.db = new sqlite3.Database(path.join(dbDir, 'db2.sqlite')) // ':memory:'
    // this.db = new sqlite3.Database(':memory:')

    // sqlite3_exec(db, "PRAGMA synchronous = OFF", NULL, NULL, &sErrMsg);
    // sqlite3_exec(db, "PRAGMA journal_mode = MEMORY", NULL, NULL, &sErrMsg);
    this.run('PRAGMA synchronous = OFF')
    this.run('PRAGMA journal_mode = MEMORY')

    this.run('PRAGMA synchronous = OFF')
    this.run('PRAGMA journal_mode = MEMORY')

    this._rawQuery(this.models.acceptedTxs, 'PRAGMA synchronous = OFF')
    this._rawQuery(this.models.acceptedTxs, 'PRAGMA journal_mode = MEMORY')
  }

  async init () {
    // Create tables for models in DB if they don't exist
    for (let model of Object.values(this.models)) {
      await model.sync()

      this._rawQuery(model, 'PRAGMA synchronous = OFF')
      this._rawQuery(model, 'PRAGMA journal_mode = MEMORY')
    }

    this.initialized = true
    this.mainLogger.info('Database initialized.')

    this.db.run('CREATE TABLE `acceptedTxs` (`id` VARCHAR(255) NOT NULL PRIMARY KEY, `timestamp` BIGINT NOT NULL, `data` JSON NOT NULL, `status` VARCHAR(255) NOT NULL, `receipt` JSON NOT NULL, `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL)')
    this.db.run('CREATE TABLE `accountStates` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `accountId` VARCHAR(255) NOT NULL, `txId` VARCHAR(255) NOT NULL, `txTimestamp` BIGINT NOT NULL, `stateBefore` VARCHAR(255) NOT NULL, `stateAfter` VARCHAR(255) NOT NULL, `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL, UNIQUE (`accountId`, `txTimestamp`))')
    // this.db.close()
  }
  async close () {
    this.mainLogger.info('Closing Database connections.')
    await this.sequelize.close()
  }

  async dropAndCreateModel (model) {
    await model.sync({ force: true })
  }

  async addCycles (cycles) {
    this._checkInit()
    try {
      await this._create(this.models.cycles, cycles)
    } catch (e) {
      throw new Error(e)
    }
  }
  async getCycleByCounter (counter) {
    this._checkInit()
    try {
      var [ cycle ] = await this._read(this.models.cycles, { counter }, { attributes: { exclude: ['createdAt', 'updatedAt'] } })
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
      var [ cycle ] = await this._read(this.models.cycles, { marker }, { attributes: { exclude: ['createdAt', 'updatedAt'] } })
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
      await this._delete(this.models.cycles, { counter })
    } catch (e) {
      throw new Error(e)
    }
  }
  async deleteCycleByMarker (marker) {
    this._checkInit()
    try {
      await this._delete(this.models.cycles, { marker })
    } catch (e) {
      throw new Error(e)
    }
  }
  async listCycles () {
    this._checkInit()
    try {
      var cycles = await this._read(this.models.cycles, null, { attributes: { exclude: ['createdAt', 'updatedAt'] } })
    } catch (e) {
      throw new Error(e)
    }
    return cycles.map(c => c.dataValues)
  }

  async addNodes (nodes) {
    this._checkInit()
    try {
      await this._create(this.models.nodes, nodes)
    } catch (e) {
      throw new Error(e)
    }
  }
  async getNodes (node) {
    this._checkInit()
    try {
      var nodes = await this._read(this.models.nodes, node, { attributes: { exclude: ['createdAt', 'updatedAt'] }, raw: true })
    } catch (e) {
      throw new Error(e)
    }
    return nodes
  }
  async updateNodes (node, newNode) {
    this._checkInit()
    try {
      await this._update(this.models.nodes, newNode, node)
    } catch (e) {
      throw new Error(e)
    }
  }
  async deleteNodes (node) {
    this._checkInit()
    try {
      await this._delete(this.models.nodes, node)
    } catch (e) {
      throw new Error(e)
    }
  }
  async listNodes () {
    this._checkInit()
    try {
      var nodes = await this._read(this.models.nodes, null, { attributes: { exclude: ['createdAt', 'updatedAt'] }, raw: true })
    } catch (e) {
      throw new Error(e)
    }
    return nodes
  }

  async setProperty (key, value) {
    this._checkInit()
    try {
      let [ prop ] = await this._read(this.models.properties, { key })
      if (!prop) {
        await this._create(this.models.properties, {
          key,
          value: JSON.stringify(value)
        })
      } else {
        await this._update(this.models.properties, {
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
      var [ prop ] = await this._read(this.models.properties, { key })
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
      await this._delete(this.models.properties, { key })
    } catch (e) {
      throw new Error(e)
    }
  }
  async listProperties () {
    this._checkInit()
    try {
      var keys = await this._read(this.models.properties, null, { attributes: ['key'], raw: true })
    } catch (e) {
      throw new Error(e)
    }
    return keys.map(k => k.key)
  }

  async clearP2pState () {
    this._checkInit()
    try {
      await this._delete(this.models.cycles, null, { truncate: true })
      await this._delete(this.models.nodes, null, { truncate: true })
    } catch (e) {
      throw new Error(e)
    }
  }

  async addAcceptedTransactions (acceptedTransactions) {
    this._checkInit()
    try {
      // await this._create(this.models.acceptedTxs, acceptedTransactions)
      acceptedTransactions = acceptedTransactions[0] // hack
      if (acceptedTransactions == null) {
        console.log('fail no atx')
        return
      }
      let ts = Date.now()
      let query = `INSERT INTO acceptedTxs (id,timestamp,data,status,receipt,createdAt,updatedAt) VALUES ('${acceptedTransactions.id}', '${acceptedTransactions.timestamp}', '${stringify(acceptedTransactions.data)}', '${acceptedTransactions.status}', '${stringify(acceptedTransactions.receipt)}', '${ts}', '${ts}' )`
      // console.log('find:' + this.sequelize.QueryTypes.INSERT)
      // console.log('b' + this.sequelize.QueryType.INSERT)
      // await this._rawQuery(this.models.acceptedTxs, query)
      // await this.sequelize.query({ query, values: [] }, { model: this.models.acceptedTxs, type: this.sequelize.QueryType.INSERT })
      await this.sequelize.query(query, { model: this.models.acceptedTxs, type: this.sequelize.QueryTypes.INSERT })

      // await this._rawQuery(this.models.acceptedTxs, `INSERT INTO acceptedTxs (id,timestamp,data,status,receipt,createdAt,updatedAt) VALUES ("${acceptedTransactions.id}", "${acceptedTransactions.timestamp}", "${stringify(acceptedTransactions.data)}", "${acceptedTransactions.status}", "${stringify(acceptedTransactions.receipt)}", "${ts}", "${ts}" )`)
      // await this._rawQuery(this.models.acceptedTxs, `INSERT INTO acceptedTxs (id,timestamp,data,status,receipt) VALUES (${acceptedTransactions.id}, ${acceptedTransactions.timestamp}, ${stringify(acceptedTransactions.data)}, ${acceptedTransactions.status}, ${stringify(acceptedTransactions.receipt)} )`)
      // await this.sequelize.query(`INSERT INTO acceptedTxs (id,timestamp,data,status,receipt,createdAt,updatedAt) VALUES ('${acceptedTransactions.id}', '${acceptedTransactions.timestamp}', '${stringify(acceptedTransactions.data)}', '${acceptedTransactions.status}', '${stringify(acceptedTransactions.receipt)}', '${ts}', '${ts}')`,
      //   { model: this.models.acceptedTxs, type: this.sequelize.QueryType.INSERT })
    } catch (e) {
      throw new Error(e)
    }
  }
  async addAccountStates (accountStates) {
    this._checkInit()
    try {
      await this._create(this.models.accountStates, accountStates)
    } catch (e) {
      throw new Error(e)
    }
  }

  // async function _sleep (ms = 0) {
  //   return new Promise(resolve => setTimeout(resolve, ms))
  // }

  run (sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) {
          console.log('Error running sql ' + sql)
          console.log(err)
          reject(err)
        } else {
          resolve({ id: this.lastID })
        }
      })
    })
  }

  async addAcceptedTransactions2 (acceptedTransactions) {
    this._checkInit()
    try {
      // await this._create(this.models.acceptedTxs, acceptedTransactions) //, Date.now(), Date.now(),
      // await new Promise(resolve => this.db.run("INSERT INTO acceptedTxs ('id','timestamp','data','status','receipt','createdAt','updatedAt') VALUES (?, ?2, ?3, ?3, ?4, ?5, ?6, ?7)",
      //   [acceptedTransactions.id, acceptedTransactions.timestamp, acceptedTransactions.data, acceptedTransactions.status, acceptedTransactions.receipt, Date.now(), Date.now()],
      //   resolve))

      // console.log(' data: ' + JSON.stringify(acceptedTransactions.data))
      await this.run(`INSERT INTO acceptedTxs (id,timestamp,data,status,receipt,createdAt,updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [acceptedTransactions.id, acceptedTransactions.timestamp, stringify(acceptedTransactions.data), acceptedTransactions.status, stringify(acceptedTransactions.receipt), Date.now(), Date.now()])

      // INSERT INTO `acceptedTxs`(`id`,`timestamp`,`data`,`status`,`receipt`,`createdAt`,`updatedAt`) VALUES (770270327989,0,'','','','','');
    } catch (e) {
      throw new Error(e)
    }
  }
  async addAccountStates2 (accountStates) {
    this._checkInit()
    try {
      // await this._create(this.models.accountStates, accountStates)

    } catch (e) {
      throw new Error(e)
    }
  }

  async queryAcceptedTransactions (tsStart, tsEnd, limit) {
    this._checkInit()
    try {
      let result = await this._read(
        this.models.acceptedTxs,
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
        this.models.accountStates,
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

  async searchAccountStateTable (accountId, txTimestamp) {
    this._checkInit()
    try {
      let result = await this._read(
        this.models.accountStates,
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
    await this.dropAndCreateModel(this.models.acceptedTxs)
  }

  async dropAndCreatAccountStateTable () {
    await this.dropAndCreateModel(this.models.accountStates)
  }

  // example of a raw query with some similarities to what we want:

  // async getAllLatestAccounts () {
  //   let accounts
  //   this._checkInit()
  //   try {
  //     // accounts = await this._read(this.models.accounts, null, { attributes: { exclude: ['createdAt', 'updatedAt'] }, raw: true })
  //     const query = `select * from accounts acct1 inner join
  //     (select address, max(timestamp) ts from accounts group by address) acct2
  //     on acct1.address = acct2.address and acct1.timestamp = acct2.ts`
  //     accounts = await this._query(query, this.models.accounts)
  //     this.mainLogger.debug(`Accounts: ${accounts}`)
  //   } catch (e) {
  //     let errMsg = `Failed to retrieve getLatestAllAccounts() ==> Exception: ${e}`
  //     this.mainLogger.error(errMsg)
  //     throw new Error(errMsg)
  //   }
  //   return accounts
  // }

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
    if (!where) {
      return table.destroy({ ...opts })
    }
    return table.destroy({ where, ...opts })
  }
  _rawQuery (table, query) {
    return this.sequelize.query(query, { model: table })
  }

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

module.exports = Storage
