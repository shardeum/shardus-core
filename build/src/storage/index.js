"use strict";
// const fs = require('fs')
// const path = require('path')
const Sequelize = require('sequelize');
const Op = Sequelize.Op;
const models = require('./models');
// const stringify = require('fast-stable-stringify')
// const utils = require('../utils')
// const SequelizeStorage = require('./sequelizeStorage')
const Sqlite3Storage = require('./sqlite3storage');
// const BetterSqlite3Storage = require('./betterSqlite3storage')
class Storage {
    constructor(baseDir, config, logger, profiler) {
        this.profiler = profiler;
        this.mainLogger = logger.getLogger('main');
        // this.storage = new SequelizeStorage(models, config, logger, baseDir, this.profiler)
        // this.storage = new BetterSqlite3Storage(models, config, logger, baseDir, this.profiler)
        this.storage = new Sqlite3Storage(models, config, logger, baseDir, this.profiler);
        this.stateManager = null;
    }
    async init() {
        await this.storage.init();
        await this.storage.runCreate('CREATE TABLE if not exists `acceptedTxs` (`id` VARCHAR(255) NOT NULL PRIMARY KEY, `timestamp` BIGINT NOT NULL, `data` JSON NOT NULL, `status` VARCHAR(255) NOT NULL, `receipt` JSON NOT NULL)');
        await this.storage.runCreate('CREATE TABLE if not exists `accountStates` ( `accountId` VARCHAR(255) NOT NULL, `txId` VARCHAR(255) NOT NULL, `txTimestamp` BIGINT NOT NULL, `stateBefore` VARCHAR(255) NOT NULL, `stateAfter` VARCHAR(255) NOT NULL,  PRIMARY KEY (`accountId`, `txTimestamp`))');
        await this.storage.runCreate('CREATE TABLE if not exists `cycles` (`counter` BIGINT NOT NULL UNIQUE PRIMARY KEY, `certificate` JSON NOT NULL, `previous` TEXT NOT NULL, `marker` TEXT NOT NULL, `start` BIGINT NOT NULL, `duration` BIGINT NOT NULL, `active` BIGINT NOT NULL, `desired` BIGINT NOT NULL, `expired` BIGINT NOT NULL, `joined` JSON NOT NULL, `joinedArchivers` JSON NOT NULL, `joinedConsensors` JSON NOT NULL, `activated` JSON NOT NULL, `activatedPublicKeys` JSON NOT NULL, `removed` JSON NOT NULL, `returned` JSON NOT NULL, `lost` JSON NOT NULL, `refuted` JSON NOT NULL, `apoptosized` JSON NOT NULL)');
        await this.storage.runCreate('CREATE TABLE if not exists `nodes` (`id` TEXT NOT NULL PRIMARY KEY, `publicKey` TEXT NOT NULL, `curvePublicKey` TEXT NOT NULL, `cycleJoined` TEXT NOT NULL, `internalIp` VARCHAR(255) NOT NULL, `externalIp` VARCHAR(255) NOT NULL, `internalPort` SMALLINT NOT NULL, `externalPort` SMALLINT NOT NULL, `joinRequestTimestamp` BIGINT NOT NULL, `activeTimestamp` BIGINT NOT NULL, `address` VARCHAR(255) NOT NULL, `status` VARCHAR(255) NOT NULL)');
        await this.storage.runCreate('CREATE TABLE if not exists `properties` (`key` VARCHAR(255) NOT NULL PRIMARY KEY, `value` JSON)');
        await this.storage.runCreate('CREATE TABLE if not exists `accountsCopy` (`accountId` VARCHAR(255) NOT NULL, `cycleNumber` BIGINT NOT NULL, `data` JSON NOT NULL, `timestamp` BIGINT NOT NULL, `hash` VARCHAR(255) NOT NULL, PRIMARY KEY (`accountId`, `cycleNumber`))');
        // get models and helper methods from the storage class we just initializaed.
        this.storageModels = this.storage.storageModels;
        this._create = async (table, values, opts) => this.storage._create(table, values, opts);
        this._read = async (table, where, opts) => this.storage._read(table, where, opts);
        this._update = async (table, values, where, opts) => this.storage._update(table, values, where, opts);
        this._delete = async (table, where, opts) => this.storage._delete(table, where, opts);
        this._query = async (query, tableModel) => this.storage._rawQuery(query, tableModel); // or queryString, valueArray for non-sequelize
        this.initialized = true;
    }
    async close() {
        await this.storage.close();
    }
    _checkInit() {
        if (!this.initialized)
            throw new Error('Storage not initialized.');
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
        this._checkInit();
        try {
            await this._create(this.storageModels.cycles, cycles);
        }
        catch (e) {
            throw new Error(e);
        }
    }
    async getCycleByCounter(counter) {
        this._checkInit();
        try {
            var [cycle] = await this._read(this.storageModels.cycles, { counter }, { attributes: { exclude: ['createdAt', 'updatedAt'] } });
        }
        catch (e) {
            throw new Error(e);
        }
        if (cycle && cycle.dataValues) {
            return cycle.dataValues;
        }
        return null;
    }
    async getCycleByMarker(marker) {
        this._checkInit();
        try {
            var [cycle] = await this._read(this.storageModels.cycles, { marker }, { attributes: { exclude: ['createdAt', 'updatedAt'] } });
        }
        catch (e) {
            throw new Error(e);
        }
        if (cycle && cycle.dataValues) {
            return cycle.dataValues;
        }
        return null;
    }
    async deleteCycleByCounter(counter) {
        this._checkInit();
        try {
            await this._delete(this.storageModels.cycles, { counter });
        }
        catch (e) {
            throw new Error(e);
        }
    }
    async deleteCycleByMarker(marker) {
        this._checkInit();
        try {
            await this._delete(this.storageModels.cycles, { marker });
        }
        catch (e) {
            throw new Error(e);
        }
    }
    async listCycles() {
        this._checkInit();
        try {
            var cycles = await this._read(this.storageModels.cycles, null, { attributes: { exclude: ['createdAt', 'updatedAt'] } });
        }
        catch (e) {
            throw new Error(e);
        }
        return cycles.map(c => c.dataValues);
    }
    async addNodes(nodes) {
        this._checkInit();
        try {
            await this._create(this.storageModels.nodes, nodes);
        }
        catch (e) {
            throw new Error(e);
        }
    }
    async getNodes(node) {
        this._checkInit();
        try {
            var nodes = await this._read(this.storageModels.nodes, node, { attributes: { exclude: ['createdAt', 'updatedAt'] }, raw: true });
        }
        catch (e) {
            throw new Error(e);
        }
        return nodes;
    }
    async updateNodes(node, newNode) {
        this._checkInit();
        try {
            await this._update(this.storageModels.nodes, newNode, node);
        }
        catch (e) {
            throw new Error(e);
        }
    }
    async deleteNodes(nodes) {
        this._checkInit();
        const nodeIds = [];
        // Attempt to add node to the nodeIds list
        const addNodeToList = (node) => {
            if (!node.id) {
                this.mainLogger.error(`Node attempted to be deleted without ID: ${JSON.stringify(node)}`);
                return;
            }
            nodeIds.push(node.id);
        };
        if (nodes.length) {
            for (const node of nodes) {
                addNodeToList(node);
            }
        }
        else {
            addNodeToList(nodes);
        }
        try {
            await this._delete(this.storageModels.nodes, { id: { [Op.in]: nodeIds } });
        }
        catch (e) {
            throw new Error(e);
        }
    }
    async listNodes() {
        this._checkInit();
        try {
            var nodes = await this._read(this.storageModels.nodes, null, { attributes: { exclude: ['createdAt', 'updatedAt'] }, raw: true });
        }
        catch (e) {
            throw new Error(e);
        }
        return nodes;
    }
    async setProperty(key, value) {
        this._checkInit();
        try {
            let [prop] = await this._read(this.storageModels.properties, { key });
            if (!prop) {
                await this._create(this.storageModels.properties, {
                    key,
                    value
                });
            }
            else {
                await this._update(this.storageModels.properties, {
                    key,
                    value
                }, { key });
            }
        }
        catch (e) {
            throw new Error(e);
        }
    }
    async getProperty(key) {
        this._checkInit();
        try {
            var [prop] = await this._read(this.storageModels.properties, { key });
        }
        catch (e) {
            throw new Error(e);
        }
        if (prop && prop.value) {
            return JSON.parse(prop.value);
        }
        return null;
    }
    async deleteProperty(key) {
        this._checkInit();
        try {
            await this._delete(this.storageModels.properties, { key });
        }
        catch (e) {
            throw new Error(e);
        }
    }
    async listProperties() {
        this._checkInit();
        try {
            var keys = await this._read(this.storageModels.properties, null, { attributes: ['key'], raw: true });
        }
        catch (e) {
            throw new Error(e);
        }
        return keys.map(k => k.key);
    }
    async clearP2pState() {
        this._checkInit();
        try {
            await this._delete(this.storageModels.cycles, null, { truncate: true });
            await this._delete(this.storageModels.nodes, null, { truncate: true });
        }
        catch (e) {
            throw new Error(e);
        }
    }
    async clearAppRelatedState() {
        this._checkInit();
        try {
            await this._delete(this.storageModels.accountStates, null, { truncate: true });
            await this._delete(this.storageModels.acceptedTxs, null, { truncate: true });
            await this._delete(this.storageModels.accountsCopy, null, { truncate: true });
        }
        catch (e) {
            throw new Error(e);
        }
    }
    async addAcceptedTransactions(acceptedTransactions) {
        this._checkInit();
        try {
            await this._create(this.storageModels.acceptedTxs, acceptedTransactions, { createOrReplace: true });
        }
        catch (e) {
            throw new Error(e);
        }
    }
    async addAccountStates(accountStates) {
        this._checkInit();
        try {
            // Adding { createOrReplace: true }  helps fix some issues we were having, but may make it hard to catch certain types of mistakes. (since it will suppress duped key issue)
            await this._create(this.storageModels.accountStates, accountStates, { createOrReplace: true });
            // throw new Error('test failue. fake')
        }
        catch (e) {
            // this.mainLogger.fatal('addAccountStates error ' + JSON.stringify(e))
            // throw new Error(e)
            this.mainLogger.fatal('addAccountStates db failure.  start apoptosis ' + JSON.stringify(e));
            // stop state manager from syncing?
            this.stateManager.initApoptosisAndQuitSyncing();
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
    async queryAcceptedTransactions(tsStart, tsEnd, limit) {
        this._checkInit();
        try {
            let result = await this._read(this.storageModels.acceptedTxs, { timestamp: { [Op.between]: [tsStart, tsEnd] } }, {
                limit: limit,
                order: [['timestamp', 'ASC']],
                attributes: { exclude: ['createdAt', 'updatedAt', 'id'] },
                raw: true
            });
            return result;
        }
        catch (e) {
            throw new Error(e);
        }
    }
    async queryAcceptedTransactionsByIds(ids) {
        this._checkInit();
        try {
            let result = await this._read(this.storageModels.acceptedTxs, { id: { [Op.in]: ids } }, {
                // limit: limit,
                order: [['timestamp', 'ASC']],
                attributes: { exclude: ['createdAt', 'updatedAt', 'id'] },
                raw: true
            });
            return result;
        }
        catch (e) {
            throw new Error(e);
        }
    }
    async queryAccountStateTable(accountStart, accountEnd, tsStart, tsEnd, limit) {
        this._checkInit();
        try {
            let result = await this._read(this.storageModels.accountStates, { accountId: { [Op.between]: [accountStart, accountEnd] }, txTimestamp: { [Op.between]: [tsStart, tsEnd] } }, {
                limit: limit,
                order: [['txTimestamp', 'ASC'], ['accountId', 'ASC']],
                attributes: { exclude: ['createdAt', 'updatedAt', 'id'] },
                raw: true
            });
            return result;
        }
        catch (e) {
            throw new Error(e);
        }
    }
    // todo also sync accepted tx? idk.
    async queryAccountStateTableByList(addressList, tsStart, tsEnd) {
        this._checkInit();
        try {
            let result = await this._read(this.storageModels.accountStates, { txTimestamp: { [Op.between]: [tsStart, tsEnd] }, accountId: { [Op.in]: addressList } }, {
                order: [['address', 'ASC']],
                attributes: { exclude: ['createdAt', 'updatedAt', 'id'] },
                raw: true
            });
            return result;
        }
        catch (e) {
            throw new Error(e);
        }
    }
    // First pass would be to get timestamp for N accounts
    // Then can batch these into delete statements that will be sure not to delete accounts that are to old.
    //
    async clearAccountStateTableByList(addressList, tsStart, tsEnd) {
        this._checkInit();
        try {
            await this._delete(this.storageModels.accountStates, { txTimestamp: { [Op.between]: [tsStart, tsEnd] }, accountId: { [Op.in]: addressList } }, {
                attributes: { exclude: ['createdAt', 'updatedAt', 'id'] },
                raw: true
            });
        }
        catch (e) {
            throw new Error(e);
        }
    }
    async clearAccountStateTableOlderThan(tsEnd) {
        this._checkInit();
        try {
            await this._query('Delete from accountStates where txTimestamp < ? and txTimestamp not in (SELECT min(txTimestamp)  from accountStates group by accountId)', `${tsEnd}`);
        }
        catch (e) {
            throw new Error(e);
        }
    }
    // Select accountId from (SELECT min(txTimestamp), *  from accountStates group by accountId)
    // clear out entries but keep oldest..  should and with a max time option
    // Delete from accountStates where txTimestamp not in (SELECT min(txTimestamp)  from accountStates group by accountId)
    // need raw option.
    // Delete from accountStates where txTimestamp < 1577915740875 and txTimestamp not in (SELECT min(txTimestamp)  from accountStates group by accountId)
    // use this to clear out older accepted TXs
    async clearAcceptedTX(tsStart, tsEnd) {
        this._checkInit();
        try {
            await this._delete(this.storageModels.acceptedTxs, { timestamp: { [Op.between]: [tsStart, tsEnd] } }, {
                attributes: { exclude: ['createdAt', 'updatedAt', 'id'] },
                raw: true
            });
        }
        catch (e) {
            throw new Error(e);
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
        this._checkInit();
        try {
            let result = await this._read(this.storageModels.accountStates, { accountId, txTimestamp }, {
                attributes: { exclude: ['createdAt', 'updatedAt', 'id'] },
                raw: true
            });
            return result;
        }
        catch (e) {
            throw new Error(e);
        }
    }
    async createAccountCopies(accountCopies) {
        this._checkInit();
        try {
            // console.log('createAccountCopies write: ' + JSON.stringify(accountCopies))
            await this._create(this.storageModels.accountsCopy, accountCopies);
        }
        catch (e) {
            throw new Error(e);
        }
    }
    async createOrReplaceAccountCopy(accountCopy) {
        this._checkInit();
        try {
            // console.log('createOrReplaceAccountCopy write: ' + JSON.stringify(accountCopy))
            await this._create(this.storageModels.accountsCopy, accountCopy, { createOrReplace: true });
        }
        catch (e) {
            throw new Error(e);
        }
    }
    // accountId: { type: Sequelize.STRING, allowNull: false, unique: 'compositeIndex' },
    // cycleNumber: { type: Sequelize.STRING, allowNull: false, unique: 'compositeIndex' },
    // data: { type: Sequelize.STRING, allowNull: false },
    // timestamp: { type: Sequelize.BIGINT, allowNull: false },
    // hash: { type: Sequelize.STRING, allowNull: false }
    async getAccountReplacmentCopies1(accountIDs, cycleNumber) {
        this._checkInit();
        try {
            let result = await this._read(this.storageModels.accountsCopy, { cycleNumber: { [Op.lte]: cycleNumber }, accountId: { [Op.in]: accountIDs } }, {
                // limit: limit,
                // order: [ ['timestamp', 'ASC'] ],
                attributes: { exclude: ['createdAt', 'updatedAt'] },
                raw: true
            });
            return result;
        }
        catch (e) {
            throw new Error(e);
        }
    }
    async getAccountReplacmentCopies(accountIDs, cycleNumber) {
        this._checkInit();
        try {
            let expandQ = '';
            for (let i = 0; i < accountIDs.length; i++) {
                expandQ += '?';
                if (i < accountIDs.length - 1) {
                    expandQ += ', ';
                }
            }
            // cycleNumber const query = `select accountId, max(cycleNumber), data, timestamp, hash from accountsCopy WHERE cycleNumber <= ? and accountId IN (${expandQ}) group by accountId `
            const query = `select accountId, max(cycleNumber) cycleNumber, data, timestamp, hash from accountsCopy WHERE cycleNumber <= ? and accountId IN (${expandQ}) group by accountId `;
            let result = await this._query(query, [cycleNumber, ...accountIDs]);
            return result;
        }
        catch (e) {
            throw new Error(e);
        }
    }
    async clearAccountReplacmentCopies(accountIDs, cycleNumber) {
        this._checkInit();
        try {
            await this._delete(this.storageModels.accountsCopy, { cycleNumber: { [Op.gte]: cycleNumber }, accountId: { [Op.in]: accountIDs } }, {
                // limit: limit,
                // order: [ ['timestamp', 'ASC'] ],
                attributes: { exclude: ['createdAt', 'updatedAt'] },
                raw: true
            });
        }
        catch (e) {
            throw new Error(e);
        }
    }
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
module.exports = Storage;
//# sourceMappingURL=index.js.map