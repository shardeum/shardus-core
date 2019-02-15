const EventEmitter = require('events')
const utils = require('../utils')

class Consensus extends EventEmitter {
  constructor (app, config, logger, crypto, p2p, storage, profiler) {
    super()
    this.profiler = profiler
    this.app = app
    this.config = config
    this.logger = logger
    this.mainLogger = this.logger.getLogger('main')
    this.fatalLogger = this.logger.getLogger('fatal')
    this.crypto = crypto
    this.p2p = p2p
    this.storage = storage
    this.app = app

    this.pendingTransactions = {}

    this.mainLogs = false
    if (this.mainLogger && ['TRACE', 'debug'].includes(this.mainLogger.level.levelStr)) {
      this.mainLogs = true
    }

    this.queueAndDelayList = []
    this.queueCounter = 0
    this.queueLocked = false
    this.queueSitTime = 3000 // todo make this a setting. and tie in with the value in datasync
    this.lastServed = 0
  }

  async inject (shardusTransaction) {
    if (this.mainLogs) this.mainLogger.debug(`Start of inject(${shardusTransaction})`)
    let transactionReceipt
    let inTransaction = shardusTransaction.inTransaction
    try {
      // let keysRequest = { type: 'keyFromTransaction', txn: inTransaction }
      // let keysResponse = await this.application.get(keysRequest)
      if (this.mainLogs) this.mainLogger.debug(`Gossiping Validated Transaction ${JSON.stringify(shardusTransaction)}`)
      if (this.mainLogs) this.mainLogger.debug(`Done Gossiping Validated Transaction ${JSON.stringify(shardusTransaction)}`)
      let keysResponse = this.app.getKeyFromTransaction(inTransaction)
      let { sourceKeys, targetKeys } = keysResponse
      let sourceAddress, targetAddress, stateId, targetStateId

      if (Array.isArray(sourceKeys) && sourceKeys.length > 0) {
        sourceAddress = sourceKeys[0]
      }
      if (Array.isArray(targetKeys) && targetKeys.length > 0) {
        targetAddress = targetKeys[0]
      }
      if (this.mainLogs) this.mainLogger.debug(`sourceAddress: ${utils.makeShortHash(sourceAddress)} targetAddress: ${utils.makeShortHash(targetAddress)}`)

      if (sourceAddress) {
        // keysRequest = { type: 'stateID', address: sourceAddress }
        // stateID = await this.application.get(keysRequest)
        stateId = await this.app.getStateId(sourceAddress)
        if (this.mainLogs) this.mainLogger.debug(`StateID: ${stateId} short stateID: ${utils.makeShortHash(stateId)} `)
      }

      if (targetAddress) {
        targetStateId = await this.app.getStateId(targetAddress, false) // we don't require this to exist
      }

      transactionReceipt = this.createReceipt(inTransaction, stateId, targetStateId)
    } catch (ex) {
      this.logger.getLogger('main').error(`Inject: Failed to process Transaction. Exception: ${ex}`)
      this.fatalLogger.fatal('inject: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      throw new Error(ex)
    }

    // if (this.mainLogs) this.mainLogger.debug(`Gossiping Receipt Transaction ${JSON.stringify(transactionReceipt)}`)
    // await this.onReceipt({ shardusTransaction, transactionReceipt })
    // if (this.mainLogs) this.mainLogger.debug(`Done Gossiping Receipt Transaction ${JSON.stringify(transactionReceipt)}`)

    let timestamp = inTransaction.txnTimestamp // todo not great that we are cracking this, should wrap in a helper
    let txStatus = 1 // todo real values for tx status. this is just a stand in
    let txId = transactionReceipt.txHash
    let acceptedTX = { id: txId, timestamp, data: inTransaction, status: txStatus, receipt: transactionReceipt }

    this.emit('accepted', acceptedTX, true)

    if (this.mainLogs) this.mainLogger.debug(`End of inject(${inTransaction})`)

    return transactionReceipt
  }

  createReceipt (tx, state, targetStateId) {
    let receipt = {
      stateId: state,
      targetStateId: targetStateId,
      txHash: this.crypto.hash(tx),
      time: Date.now()
    }
    receipt = this.crypto.sign(receipt) // sign with this node's key
    return receipt
  }
}

module.exports = Consensus
