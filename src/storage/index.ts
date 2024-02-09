import Log4js from 'log4js'
// const fs = require('fs')
// const path = require('path')
import Logger, { logFlags } from '../logger'
import * as Snapshot from '../snapshot'
import StateManager from '../state-manager'
import Profiler from '../utils/profiler'
import * as ShardusTypes from './../shardus/shardus-types'
import models from './models'
// const utils = require('../utils')
import Sqlite3Storage from './sqlite3storage'
// const BetterSqlite3Storage = require('./betterSqlite3storage')

import P2PApoptosis = require('../p2p/Apoptosis')

import { config } from '../p2p/Context'
import { ColumnDescription } from './utils/schemaDefintions'
import { Op } from './utils/sqlOpertors'

/** A type alias to avoid both `any` and having to spell this type out any time
 * we want to use it. */
export type GenericObject = { [key: symbol]: unknown }

export type ModelAttributes = { [column: string]: ColumnDescription }

export interface ModelData {
  tableName: string
  columns: string[]
  columnsString: string
  substitutionString: string
  isColumnJSON: { [key: string]: boolean }
  JSONkeys: string[]

  insertOrReplaceString?: string
  insertString?: string
  selectString?: string
  updateString?: string
  deleteString?: string
}

export type OperationOptions = {
  createOrReplace?: boolean
  raw?: boolean
  order?: { length: number }
  limit?: number
}

export interface ParamEntry {
  name: string
  type?: string
  v1?: string
  v2?: string
  sql?: string
  vals?: string[]
}

interface Storage {
  serverConfig: ShardusTypes.StrictServerConfiguration
  profiler: Profiler
  mainLogger: Log4js.Logger
  fatalLogger: Log4js.Logger
  storage: Sqlite3Storage
  stateManager: StateManager
  storageModels: any
  initialized: boolean
  _create: any
  _read: any
  _readOld: any
  _update: any
  _delete: any
  _query: any
  _queryOld: any
}

class Storage {
  constructor(
    baseDir: string,
    config: ShardusTypes.StrictStorageConfiguration,
    serverConfig: ShardusTypes.StrictServerConfiguration,
    logger: Logger,
    profiler: Profiler
  ) {
    this.profiler = profiler

    this.mainLogger = logger.getLogger('main')
    this.fatalLogger = logger.getLogger('fatal')
    // this.storage = new SequelizeStorage(models, config, logger, baseDir, this.profiler)

    // this.storage = new BetterSqlite3Storage(models, config, logger, baseDir, this.profiler)
    this.storage = new Sqlite3Storage(
      models as [string, ModelAttributes][],
      config,
      logger,
      baseDir,
      this.profiler
    )
    this.serverConfig = serverConfig
    this.stateManager = null
  }

  async init() {
    /* prettier-ignore */ if (logFlags.important_as_fatal) console.log('shardus storage init:')
    await this.storage.init()
    /* prettier-ignore */ if (logFlags.important_as_fatal) console.log('shardus storage init complete')

    await this.storage.runCreate(
      'CREATE TABLE if not exists `acceptedTxs` (`txId` VARCHAR(255) NOT NULL PRIMARY KEY, `timestamp` BIGINT NOT NULL, `data` JSON NOT NULL, `keys` JSON NOT NULL)'
    )
    await this.storage.runCreate(
      'CREATE TABLE if not exists `accountStates` ( `accountId` VARCHAR(255) NOT NULL, `txId` VARCHAR(255) NOT NULL, `txTimestamp` BIGINT NOT NULL, `stateBefore` VARCHAR(255) NOT NULL, `stateAfter` VARCHAR(255) NOT NULL,  PRIMARY KEY (`accountId`, `txTimestamp`))'
    )
    await this.storage.runCreate(
      'CREATE TABLE if not exists `cycles` (' +
        [
          '`networkId` TEXT NOT NULL',
          '`counter` BIGINT NOT NULL UNIQUE PRIMARY KEY',
          '`target` BIGINT',
          '`mode` TEXT',
          '`safetyMode` BOOLEAN',
          '`safetyNum` BIGINT',
          '`maxSyncTime` BIGINT',
          '`networkStateHash` BIGINT',
          '`networkDataHash` JSON',
          '`networkConfigHash` TEXT NOT NULL',
          '`networkReceiptHash` JSON',
          '`networkSummaryHash` JSON',
          '`certificate` JSON NOT NULL',
          '`previous` TEXT NOT NULL',
          '`marker` TEXT NOT NULL',
          '`start` BIGINT NOT NULL',
          '`duration` BIGINT NOT NULL',
          '`active` BIGINT NOT NULL',
          '`syncing` BIGINT NOT NULL',
          '`desired` BIGINT NOT NULL',
          '`expired` BIGINT NOT NULL',
          '`joined` JSON NOT NULL',
          '`joinedArchivers` JSON NOT NULL',
          '`leavingArchivers` JSON NOT NULL',
          '`joinedConsensors` JSON NOT NULL',
          '`refreshedArchivers` JSON NOT NULL',
          '`refreshedConsensors` JSON NOT NULL',
          '`activated` JSON NOT NULL',
          '`activatedPublicKeys` JSON NOT NULL',
          '`removed` JSON NOT NULL',
          '`appRemoved` JSON NOT NULL',
          '`returned` JSON NOT NULL',
          '`lost` JSON NOT NULL',
          '`lostSyncing` JSON NOT NULL',
          '`refuted` JSON NOT NULL',
          '`nodeListHash` TEXT NOT NULL',
          '`archiverListHash` TEXT NOT NULL',
          '`standbyAdd` JSON NOT NULL',
          '`standbyNodeListHash` TEXT NOT NULL',
          '`standbyRemove` JSON NOT NULL',
          '`lostArchivers` TEXT NOT NULL',
          '`refutedArchivers` TEXT NOT NULL',
          '`removedArchivers` TEXT NOT NULL',
          '`startedSyncing` TEXT NOT NULL',
          '`lostAfterSelection` TEXT NOT NULL',
        ].join(', ') +
        ')'
    )
    await this.storage.runCreate(
      'CREATE TABLE if not exists `nodes` (`id` TEXT NOT NULL PRIMARY KEY, `publicKey` TEXT NOT NULL, `curvePublicKey` TEXT NOT NULL, `cycleJoined` TEXT NOT NULL, `internalIp` VARCHAR(255) NOT NULL, `externalIp` VARCHAR(255) NOT NULL, `internalPort` SMALLINT NOT NULL, `externalPort` SMALLINT NOT NULL, `joinRequestTimestamp` BIGINT NOT NULL, `activeTimestamp` BIGINT NOT NULL, `address` VARCHAR(255) NOT NULL, `status` VARCHAR(255) NOT NULL)'
    )
    await this.storage.runCreate(
      'CREATE TABLE if not exists `properties` (`key` VARCHAR(255) NOT NULL PRIMARY KEY, `value` JSON)'
    )
    await this.storage.runCreate(
      'CREATE TABLE if not exists `accountsCopy` (`accountId` VARCHAR(255) NOT NULL, `cycleNumber` BIGINT NOT NULL, `data` JSON NOT NULL, `timestamp` BIGINT NOT NULL, `hash` VARCHAR(255) NOT NULL, `isGlobal` BOOLEAN NOT NULL, PRIMARY KEY (`accountId`, `cycleNumber`))'
    )
    await this.storage.runCreate(
      'CREATE TABLE if not exists `globalAccounts` (`accountId` VARCHAR(255) NOT NULL, `cycleNumber` BIGINT NOT NULL, `data` JSON NOT NULL, `timestamp` BIGINT NOT NULL, `hash` VARCHAR(255) NOT NULL, PRIMARY KEY (`accountId`, `cycleNumber`))'
    )
    await this.storage.runCreate(
      'CREATE TABLE if not exists `partitions` (`partitionId` VARCHAR(255) NOT NULL, `cycleNumber` BIGINT NOT NULL, `hash` VARCHAR(255) NOT NULL, PRIMARY KEY (`partitionId`, `cycleNumber`))'
    )
    await this.storage.runCreate(
      'CREATE TABLE if not exists `receipt` (`partitionId` VARCHAR(255) NOT NULL, `cycleNumber` BIGINT NOT NULL, `hash` VARCHAR(255) NOT NULL, PRIMARY KEY (`partitionId`, `cycleNumber`))'
    )
    await this.storage.runCreate(
      'CREATE TABLE if not exists `summary` (`partitionId` VARCHAR(255) NOT NULL, `cycleNumber` BIGINT NOT NULL, `hash` VARCHAR(255) NOT NULL, PRIMARY KEY (`partitionId`, `cycleNumber`))'
    )
    await this.storage.runCreate(
      'CREATE TABLE if not exists `network` (`cycleNumber` BIGINT NOT NULL, `hash` VARCHAR(255) NOT NULL, PRIMARY KEY (`cycleNumber`))'
    )
    await this.storage.runCreate(
      'CREATE TABLE if not exists `networkReceipt` (`cycleNumber` BIGINT NOT NULL, `hash` VARCHAR(255) NOT NULL, PRIMARY KEY (`cycleNumber`))'
    )
    await this.storage.runCreate(
      'CREATE TABLE if not exists `networkSummary` (`cycleNumber` BIGINT NOT NULL, `hash` VARCHAR(255) NOT NULL, PRIMARY KEY (`cycleNumber`))'
    )

    await this.storage.run(P2PApoptosis.addCycleFieldQuery)

    // get models and helper methods from the storage class we just initializaed.
    this.storageModels = this.storage.storageModels

    this._create = async (table, values, opts) => this.storage._create(table, values, opts)
    this._read = async (table, where, opts) => this.storage._read(table, where, opts)
    this._readOld = async (table, where, opts) => this.storage._readOld(table, where, opts)
    this._update = async (table, values, where, opts) => this.storage._update(table, values, where, opts)
    this._delete = async (table, where, opts) => this.storage._delete(table, where, opts)
    this._query = async (query, tableModel) => this.storage._rawQuery(query, tableModel) // or queryString, valueArray for non-sequelize
    this._queryOld = async (query, tableModel) => this.storage._rawQueryOld(query, tableModel) // or queryString, valueArray for non-sequelize

    this.initialized = true
    if (Snapshot.oldDataPath) {
      //temporarily disable safety mode, it seems to break rotation
      //await Snapshot.initSafetyModeVals()
    }
  }
  async close() {
    await this.storage.close()
  }

  async deleteOldDBPath() {
    await this.storage.deleteOldDBPath()
  }

  _checkInit() {
    if (!this.initialized) throw new Error('Storage not initialized.')
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
  //   // this.db.run('CREATE TABLE if not exists `nodes` (`id` TEXT NOT NULL PRIMARY KEY, `publicKey` TEXT NOT NULL, `cycleJoined` TEXT NOT NULL, `internalIp` VARCHAR(255) NOT NULL, `externalIp` VARCHAR(255) NOT NULL, `internalPort` SMALLINT NOT NULL, `externalPort` SMALLINT NOT NULL, `joinRequestTimestamp` BIGINT NOT NULL, `activeTimestamp` BIGINT NOT NULL, `address` VARCHAR(255) NOT NULL, `status` VARCHAR(255) NOT NULL)')
  //   // this.db.run('CREATE TABLE if not exists `properties` (`key` VARCHAR(255) NOT NULL PRIMARY KEY, `value` JSON)')
  // }
  // async close () {
  //   this.mainLogger.info('Closing Database connections.')
  //   await this.sequelize.close()
  // }

  // async dropAndCreateModel (model) {
  //   await model.sync({ force: true })
  // }

  async addCycles(cycles) {
    /* prettier-ignore */ if (logFlags.p2pNonFatal && logFlags.console) console.log('adding cycles', cycles)
    this._checkInit()
    try {
      await this._create(this.storageModels.cycles, cycles)
    } catch (e) {
      throw new Error(e)
    }
  }

  async updateCycle(record, newRecord) {
    this._checkInit()
    try {
      await this._update(this.storageModels.cycles, newRecord, record)
    } catch (e) {
      throw new Error(e)
    }
  }

  async getCycleByCounter(counter) {
    this._checkInit()
    let cycle
    try {
      ;[cycle] = await this._read(
        this.storageModels.cycles,
        { counter },
        { attributes: { exclude: ['createdAt', 'updatedAt'] } }
      )
    } catch (e) {
      throw new Error(e)
    }
    if (cycle && cycle.dataValues) {
      return cycle.dataValues
    }
    return null
  }
  async getCycleByMarker(marker) {
    this._checkInit()
    let cycle
    try {
      ;[cycle] = await this._read(
        this.storageModels.cycles,
        { marker },
        { attributes: { exclude: ['createdAt', 'updatedAt'] } }
      )
    } catch (e) {
      throw new Error(e)
    }
    if (cycle && cycle.dataValues) {
      return cycle.dataValues
    }
    return null
  }
  async deleteCycleByCounter(counter) {
    this._checkInit()
    try {
      await this._delete(this.storageModels.cycles, { counter })
    } catch (e) {
      throw new Error(e)
    }
  }
  async deleteCycleByMarker(marker) {
    this._checkInit()
    try {
      await this._delete(this.storageModels.cycles, { marker })
    } catch (e) {
      throw new Error(e)
    }
  }
  async listCycles() {
    this._checkInit()
    let cycles
    try {
      cycles = await this._read(this.storageModels.cycles, null, {
        attributes: { exclude: ['createdAt', 'updatedAt'] },
      })
    } catch (e) {
      throw new Error(e)
    }
    return cycles.map((c) => c.dataValues)
  }

  async listOldCycles() {
    this._checkInit()
    let cycles
    try {
      cycles = await this._readOld(this.storageModels.cycles, null, {
        attributes: { exclude: ['createdAt', 'updatedAt'] },
      })
    } catch (e) {
      throw new Error(e)
    }
    return cycles
  }

  async getLastOldNetworkHash() {
    this._checkInit()
    let networkStateHash
    try {
      networkStateHash = await this._readOld(this.storageModels.network, null, {
        limit: 1,
        order: [['cycleNumber', 'DESC']],
        attributes: { exclude: ['createdAt', 'updatedAt', 'id'] },
        raw: true,
      })
    } catch (e) {
      throw new Error(e)
    }
    return networkStateHash
  }

  async getLastOldPartitionHashes() {
    this._checkInit()
    let partitionHashes = []
    try {
      const query =
        'SELECT partitionId, hash FROM partitions WHERE (partitionId,cycleNumber) IN ( SELECT partitionId, MAX(cycleNumber) FROM partitions GROUP BY partitionId)'
      partitionHashes = await this._queryOld(query, [])
    } catch (e) {
      throw new Error(e)
    }
    return partitionHashes
  }

  async addNodes(nodes) {
    this._checkInit()
    try {
      await this._create(this.storageModels.nodes, nodes)
    } catch (e) {
      throw new Error(e)
    }
  }
  async getNodes(node) {
    this._checkInit()
    let nodes
    try {
      nodes = await this._read(this.storageModels.nodes, node, {
        attributes: { exclude: ['createdAt', 'updatedAt'] },
        raw: true,
      })
    } catch (e) {
      throw new Error(e)
    }
    return nodes
  }
  async updateNodes(node, newNode) {
    this._checkInit()
    try {
      await this._update(this.storageModels.nodes, newNode, node)
    } catch (e) {
      throw new Error(e)
    }
  }
  async deleteNodes(nodes) {
    this._checkInit()
    const nodeIds = []
    // Attempt to add node to the nodeIds list
    const addNodeToList = (node) => {
      if (!node.id) {
        if (logFlags.error)
          this.mainLogger.error(`Node attempted to be deleted without ID: ${JSON.stringify(node)}`)
        return
      }
      nodeIds.push(node.id)
    }
    if (nodes.length) {
      for (const node of nodes) {
        addNodeToList(node)
      }
    } else {
      addNodeToList(nodes)
    }
    try {
      await this._delete(this.storageModels.nodes, { id: { [Op.in]: nodeIds } })
    } catch (e) {
      throw new Error(e)
    }
  }
  async listNodes() {
    this._checkInit()
    let nodes
    try {
      nodes = await this._read(this.storageModels.nodes, null, {
        attributes: { exclude: ['createdAt', 'updatedAt'] },
        raw: true,
      })
    } catch (e) {
      throw new Error(e)
    }
    return nodes
  }

  async setProperty(key, value) {
    this._checkInit()
    try {
      const [prop] = await this._read(this.storageModels.properties, { key })
      if (!prop) {
        await this._create(this.storageModels.properties, {
          key,
          value,
        })
      } else {
        await this._update(
          this.storageModels.properties,
          {
            key,
            value,
          },
          { key }
        )
      }
    } catch (e) {
      throw new Error(e)
    }
  }
  async getProperty(key) {
    this._checkInit()
    let prop
    try {
      ;[prop] = await this._read(this.storageModels.properties, { key })
    } catch (e) {
      throw new Error(e)
    }
    if (prop && prop.value) {
      return JSON.parse(prop.value)
    }
    return null
  }
  async deleteProperty(key) {
    this._checkInit()
    try {
      await this._delete(this.storageModels.properties, { key })
    } catch (e) {
      throw new Error(e)
    }
  }
  async listProperties() {
    this._checkInit()
    let keys
    try {
      keys = await this._read(this.storageModels.properties, null, {
        attributes: ['key'],
        raw: true,
      })
    } catch (e) {
      throw new Error(e)
    }
    return keys.map((k) => k.key)
  }

  async clearP2pState() {
    this._checkInit()
    try {
      await this._delete(this.storageModels.cycles, null, { truncate: true })
      await this._delete(this.storageModels.nodes, null, { truncate: true })
    } catch (e) {
      throw new Error(e)
    }
  }
  async clearAppRelatedState() {
    this._checkInit()
    try {
      await this._delete(this.storageModels.accountStates, null, {
        truncate: true,
      })
      await this._delete(this.storageModels.acceptedTxs, null, {
        truncate: true,
      })
      await this._delete(this.storageModels.accountsCopy, null, {
        truncate: true,
      })
    } catch (e) {
      throw new Error(e)
    }
  }

  async addAcceptedTransactions(acceptedTransactions) {
    if (this.serverConfig.debug.recordAcceptedTx != true) return
    this._checkInit()
    try {
      await this._create(this.storageModels.acceptedTxs, acceptedTransactions, {
        createOrReplace: true,
      })
    } catch (e) {
      throw new Error(e)
    }
  }

  async addPartitionHash(partition) {
    this._checkInit()
    try {
      await this._create(this.storageModels.partitions, partition, {
        createOrReplace: true,
      })
    } catch (e) {
      throw new Error(e)
    }
  }

  async addReceiptMapHash(receiptMap) {
    this._checkInit()
    try {
      await this._create(this.storageModels.receipt, receiptMap, {
        createOrReplace: true,
      })
    } catch (e) {
      throw new Error(e)
    }
  }

  async addSummaryHash(summaryHash) {
    this._checkInit()
    try {
      await this._create(this.storageModels.summary, summaryHash, {
        createOrReplace: true,
      })
    } catch (e) {
      throw new Error(e)
    }
  }

  async addNetworkState(networkState) {
    this._checkInit()
    try {
      await this._create(this.storageModels.network, networkState, {
        createOrReplace: true,
      })
    } catch (e) {
      throw new Error(e)
    }
  }

  async addNetworkReceipt(networkReceipt) {
    this._checkInit()
    try {
      await this._create(this.storageModels.networkReceipt, networkReceipt, {
        createOrReplace: true,
      })
    } catch (e) {
      throw new Error(e)
    }
  }

  async addNetworkSummary(networkSummary) {
    this._checkInit()
    try {
      await this._create(this.storageModels.networkSummary, networkSummary, {
        createOrReplace: true,
      })
    } catch (e) {
      throw new Error(e)
    }
  }

  async addAccountStates(accountStates) {
    if (this.serverConfig.debug.recordAccountStates != true) return
    this._checkInit()
    try {
      // Adding { createOrReplace: true }  helps fix some issues we were having, but may make it hard to catch certain types of mistakes. (since it will suppress duped key issue)
      await this._create(this.storageModels.accountStates, accountStates, {
        createOrReplace: true,
      })
    } catch (e) {
      this.fatalLogger.fatal(
        'addAccountStates db failure.  start apoptosis ' +
          JSON.stringify(e.message) +
          ' ' +
          JSON.stringify(accountStates)
      )
      this.stateManager.initApoptosisAndQuitSyncing('addAccountStates')
    }
  }

  // // async function _sleep (ms = 0) {
  // //   return new Promise(resolve => setTimeout(resolve, ms))
  // // }

  // async addAcceptedTransactions2 (acceptedTransactions) {
  //   this._checkInit()
  //   try {
  //     // await this._create(this.storageModels.acceptedTxs, acceptedTransactions) //, shardusGetTime(), shardusGetTime(),
  //     // await new Promise(resolve => this.db.run("INSERT INTO acceptedTxs ('id','timestamp','data','status','receipt','createdAt','updatedAt') VALUES (?, ?2, ?3, ?3, ?4, ?5, ?6, ?7)",
  //     //   [acceptedTransactions.id, acceptedTransactions.timestamp, acceptedTransactions.data, acceptedTransactions.status, acceptedTransactions.receipt, shardusGetTime(), shardusGetTime()],
  //     //   resolve))

  //     // if (logFlags.console) console.log(' data: ' + JSON.stringify(acceptedTransactions.data))
  //     await this.run(`INSERT INTO acceptedTxs (id,timestamp,data,status,receipt,createdAt,updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  //       [acceptedTransactions.id, acceptedTransactions.timestamp, stringify(acceptedTransactions.data), acceptedTransactions.status, stringify(acceptedTransactions.receipt), shardusGetTime(), shardusGetTime()])

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

  async queryAcceptedTransactions(tsStart, tsEnd, limit) {
    this._checkInit()
    try {
      const result = await this._read(
        this.storageModels.acceptedTxs,
        { timestamp: { [Op.between]: [tsStart, tsEnd] } },
        {
          limit: limit,
          order: [['timestamp', 'ASC']],
          attributes: { exclude: ['createdAt', 'updatedAt', 'id'] },
          raw: true,
        }
      )
      return result
    } catch (e) {
      throw new Error(e)
    }
  }

  async queryAcceptedTransactionsByIds(ids) {
    this._checkInit()
    try {
      const result = await this._read(
        this.storageModels.acceptedTxs,
        { id: { [Op.in]: ids } },
        {
          // limit: limit,
          order: [['timestamp', 'ASC']],
          attributes: { exclude: ['createdAt', 'updatedAt', 'id'] },
          raw: true,
        }
      )
      return result
    } catch (e) {
      throw new Error(e)
    }
  }

  async queryAccountStateTable(accountStart, accountEnd, tsStart, tsEnd, limit) {
    this._checkInit()
    try {
      const result = await this._read(
        this.storageModels.accountStates,
        {
          accountId: { [Op.between]: [accountStart, accountEnd] },
          txTimestamp: { [Op.between]: [tsStart, tsEnd] },
        },
        {
          limit: limit,
          order: [
            ['txTimestamp', 'ASC'],
            ['accountId', 'ASC'],
          ],
          attributes: { exclude: ['createdAt', 'updatedAt', 'id'] },
          raw: true,
        }
      )
      return result
    } catch (e) {
      throw new Error(e)
    }
  }

  // todo also sync accepted tx? idk.
  async queryAccountStateTableByList(addressList, tsStart, tsEnd) {
    this._checkInit()
    try {
      const result = await this._read(
        this.storageModels.accountStates,
        {
          txTimestamp: { [Op.between]: [tsStart, tsEnd] },
          accountId: { [Op.in]: addressList },
        },
        {
          order: [['address', 'ASC']],
          attributes: { exclude: ['createdAt', 'updatedAt', 'id'] },
          raw: true,
        }
      )
      return result
    } catch (e) {
      throw new Error(e)
    }
  }

  async queryAccountStateTableByListNewest(accountIDs) {
    this._checkInit()
    try {
      let expandQ = ''
      for (let i = 0; i < accountIDs.length; i++) {
        expandQ += '?'
        if (i < accountIDs.length - 1) {
          expandQ += ', '
        }
      }
      //maxTS?
      const query = `select accountId, txId, max(txTimestamp) txTimestamp, stateBefore, stateAfter from accountStates WHERE accountId IN (${expandQ}) group by accountId `
      const result = await this._query(query, [...accountIDs])
      return result
    } catch (e) {
      throw new Error(e)
    }
  }

  // First pass would be to get timestamp for N accounts
  // Then can batch these into delete statements that will be sure not to delete accounts that are to old.
  //
  async clearAccountStateTableByList(addressList, tsStart, tsEnd) {
    this._checkInit()
    try {
      await this._delete(
        this.storageModels.accountStates,
        {
          txTimestamp: { [Op.between]: [tsStart, tsEnd] },
          accountId: { [Op.in]: addressList },
        },
        {
          attributes: { exclude: ['createdAt', 'updatedAt', 'id'] },
          raw: true,
        }
      )
    } catch (e) {
      throw new Error(e)
    }
  }

  async clearAccountStateTableOlderThan(tsEnd) {
    this._checkInit()
    try {
      await this._query(
        'Delete from accountStates where txTimestamp < ? and txTimestamp not in (SELECT min(txTimestamp)  from accountStates group by accountId)',
        `${tsEnd}`
      )
    } catch (e) {
      throw new Error(e)
    }
  }

  // Select accountId from (SELECT min(txTimestamp), *  from accountStates group by accountId)

  // clear out entries but keep oldest..  should and with a max time option
  // Delete from accountStates where txTimestamp not in (SELECT min(txTimestamp)  from accountStates group by accountId)
  // need raw option.

  // Delete from accountStates where txTimestamp < 1577915740875 and txTimestamp not in (SELECT min(txTimestamp)  from accountStates group by accountId)

  // use this to clear out older accepted TXs
  async clearAcceptedTX(tsStart, tsEnd) {
    this._checkInit()
    try {
      await this._delete(
        this.storageModels.acceptedTxs,
        { timestamp: { [Op.between]: [tsStart, tsEnd] } },
        {
          attributes: { exclude: ['createdAt', 'updatedAt', 'id'] },
          raw: true,
        }
      )
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

  async searchAccountStateTable(accountId, txTimestamp) {
    this._checkInit()
    try {
      const result = await this._read(
        this.storageModels.accountStates,
        { accountId, txTimestamp },
        {
          attributes: { exclude: ['createdAt', 'updatedAt', 'id'] },
          raw: true,
        }
      )
      return result
    } catch (e) {
      throw new Error(e)
    }
  }

  async createAccountCopies(accountCopies) {
    if (config.stateManager.useAccountCopiesTable === false) {
      return
    }

    this._checkInit()
    try {
      // if (logFlags.console) console.log('createAccountCopies write: ' + JSON.stringify(accountCopies))
      await this._create(this.storageModels.accountsCopy, accountCopies)
    } catch (e) {
      throw new Error(e)
    }
  }

  async createOrReplaceAccountCopy(accountCopy) {
    if (config.stateManager.useAccountCopiesTable === false) {
      return
    }

    this._checkInit()
    try {
      // if (logFlags.console) console.log('createOrReplaceAccountCopy write: ' + JSON.stringify(accountCopy))
      await this._create(this.storageModels.accountsCopy, accountCopy, {
        createOrReplace: true,
      })
    } catch (e) {
      throw new Error(e)
    }
  }

  // accountId: { type: Sequelize.STRING, allowNull: false, unique: 'compositeIndex' },
  // cycleNumber: { type: Sequelize.STRING, allowNull: false, unique: 'compositeIndex' },
  // data: { type: Sequelize.STRING, allowNull: false },
  // timestamp: { type: Sequelize.BIGINT, allowNull: false },
  // hash: { type: Sequelize.STRING, allowNull: false }

  async getAccountReplacmentCopies1(accountIDs, cycleNumber) {
    if (config.stateManager.useAccountCopiesTable === false) {
      return []
    }

    this._checkInit()
    try {
      const result = await this._read(
        this.storageModels.accountsCopy,
        {
          cycleNumber: { [Op.lte]: cycleNumber },
          accountId: { [Op.in]: accountIDs },
        },
        {
          // limit: limit,
          // order: [ ['timestamp', 'ASC'] ],
          attributes: { exclude: ['createdAt', 'updatedAt'] },
          raw: true,
        }
      )
      return result
    } catch (e) {
      throw new Error(e)
    }
  }

  async getAccountReplacmentCopies(accountIDs, cycleNumber) {
    if (config.stateManager.useAccountCopiesTable === false) {
      return []
    }

    this._checkInit()
    try {
      let expandQ = ''
      for (let i = 0; i < accountIDs.length; i++) {
        expandQ += '?'
        if (i < accountIDs.length - 1) {
          expandQ += ', '
        }
      }
      // cycleNumber const query = `select accountId, max(cycleNumber), data, timestamp, hash from accountsCopy WHERE cycleNumber <= ? and accountId IN (${expandQ}) group by accountId `
      const query = `select accountId, max(cycleNumber) cycleNumber, data, timestamp, hash from accountsCopy WHERE cycleNumber <= ? and accountId IN (${expandQ}) group by accountId `
      const result = await this._query(query, [cycleNumber, ...accountIDs])
      return result
    } catch (e) {
      throw new Error(e)
    }
  }

  async clearAccountReplacmentCopies(accountIDs, cycleNumber) {
    if (config.stateManager.useAccountCopiesTable === false) {
      return []
    }

    this._checkInit()
    try {
      await this._delete(
        this.storageModels.accountsCopy,
        {
          cycleNumber: { [Op.gte]: cycleNumber },
          accountId: { [Op.in]: accountIDs },
        },
        {
          // limit: limit,
          // order: [ ['timestamp', 'ASC'] ],
          attributes: { exclude: ['createdAt', 'updatedAt'] },
          raw: true,
        }
      )
    } catch (e) {
      throw new Error(e)
    }
  }

  async getAccountCopiesByCycle(cycleNumber) {
    if (config.stateManager.useAccountCopiesTable === false) {
      return []
    }

    this._checkInit()
    try {
      //const query = `select accountId, max(cycleNumber) cycleNumber, data, timestamp, hash from accountsCopy WHERE cycleNumber <= ? group by accountId `
      //same as above minus data
      const query = `SELECT a.accountId,a.data,a.timestamp,a.hash,a.isGlobal FROM accountsCopy a INNER JOIN (SELECT accountId, MAX(cycleNumber) cycleNumber FROM accountsCopy GROUP BY accountId) b ON a.accountId = b.accountId AND a.cycleNumber = b.cycleNumber WHERE a.cycleNumber<=${cycleNumber} and a.isGlobal=false order by a.accountId asc`
      const result = await this._query(query, [cycleNumber])
      return result
    } catch (e) {
      throw new Error(e)
    }
  }

  async getAccountCopiesByCycleAndRange(cycleNumber, lowAddress, highAddress) {
    if (config.stateManager.useAccountCopiesTable === false) {
      return []
    }

    this._checkInit()
    try {
      const query = `SELECT a.accountId,a.data,a.timestamp,a.hash,a.isGlobal FROM accountsCopy a INNER JOIN (SELECT accountId, MAX(cycleNumber) cycleNumber FROM accountsCopy WHERE cycleNumber<=${cycleNumber} GROUP BY accountId) b ON a.accountId = b.accountId AND a.cycleNumber = b.cycleNumber WHERE a.cycleNumber<=${cycleNumber} and a.accountId>="${lowAddress}" and a.accountId<="${highAddress}" and a.isGlobal=false order by a.accountId asc`
      const result = await this._query(query, [])
      return result
    } catch (e) {
      throw new Error(e)
    }
  }

  async getGlobalAccountCopies(cycleNumber) {
    if (config.stateManager.useAccountCopiesTable === false) {
      return []
    }

    this._checkInit()
    try {
      const query = `SELECT a.accountId,a.data,a.timestamp,a.hash,a.isGlobal FROM accountsCopy a INNER JOIN (SELECT accountId, MAX(cycleNumber) cycleNumber FROM accountsCopy WHERE cycleNumber<=${cycleNumber} GROUP BY accountId) b ON a.accountId = b.accountId AND a.cycleNumber = b.cycleNumber WHERE a.cycleNumber<=${cycleNumber} and a.isGlobal=true order by a.accountId asc`
      const result = await this._query(query, [])
      return result
    } catch (e) {
      throw new Error(e)
    }
  }

  async getOldAccountCopiesByCycleAndRange(cycleNumber, lowAddress, highAddress) {
    if (config.stateManager.useAccountCopiesTable === false) {
      return []
    }

    this._checkInit()
    try {
      const query = `SELECT a.* FROM accountsCopy a INNER JOIN (SELECT accountId, MAX(cycleNumber) cycleNumber FROM accountsCopy where cycleNumber<=${cycleNumber} GROUP BY accountId) b ON a.accountId = b.accountId AND a.cycleNumber = b.cycleNumber WHERE a.accountId>="${lowAddress}" and a.accountId<="${highAddress}" and a.isGlobal=false order by a.accountId asc`
      const result = await this._queryOld(query, [])
      return result
    } catch (e) {
      throw new Error(e)
    }
  }

  async getOldGlobalAccountCopies(cycleNumber) {
    if (config.stateManager.useAccountCopiesTable === false) {
      return []
    }

    this._checkInit()
    try {
      const query = `SELECT a.* FROM accountsCopy a INNER JOIN (SELECT accountId, MAX(cycleNumber) cycleNumber FROM accountsCopy where cycleNumber<=${cycleNumber} GROUP BY accountId) b ON a.accountId = b.accountId AND a.cycleNumber = b.cycleNumber WHERE a.isGlobal=true order by a.accountId asc`
      const result = await this._queryOld(query, [])
      return result
    } catch (e) {
      throw new Error(e)
    }
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
  //     if (logFlags.error) this.mainLogger.error(errMsg)
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
export default Storage
