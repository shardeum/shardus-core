const utils = require('../utils')

class Consensus {
  constructor (app, shardus, config, logger, crypto, p2p, storage, reporter, profiler) {
    this.profiler = profiler
    this.app = app
    this.shardus = shardus
    this.config = config
    this.logger = logger
    this.mainLogger = this.logger.getLogger('main')
    this.fatalLogger = this.logger.getLogger('fatal')
    this.crypto = crypto
    this.p2p = p2p
    this.storage = storage
    this.app = app
    this.reporter = reporter

    this.pendingTransactions = {}

    this.mainLogs = false
    if (this.mainLogger && ['TRACE', 'debug'].includes(this.mainLogger.level.levelStr)) {
      this.mainLogs = true
    }

    this.consensusActive = false
    this.p2p.on('active', () => { this.consensusActive = true })

    this.queueAndDelayList = []
    this.queueCounter = 0
    this.queueLocked = false
    this.queueSitTime = 3000 // todo make this a setting. and tie in with the value in datasync
    this.lastServed = 0

    // Register Gossip Handlers with P2P
    this.p2p.registerGossipHandler('receipt', async (data, sender, tracker) => {
      this.p2p.sendGossipIn('receipt', data, tracker)

      if (!this.consensusActive) {
        return
      }

      if (this.config.debug && this.config.debug.loseReceiptChance) {
        if (Math.random() < this.config.debug.loseReceiptChance) {
          this.logger.playbackLogNote('FakeLoseReceipt', '', data)
          return
        }
      }

      if (await this.onReceipt(data)) {
        console.log('onReceipt: ' + data.shardusTransaction.inTransaction.txnTimestamp) // todo remove
      } else {
        // something failed and that is causing us to not gossip the receipt
        this.playbackLogNote('receiptFailure', tracker, data)
      }
    })

    this.p2p.registerGossipHandler('transaction', async (data, sender, tracker) => {
      if (!this.consensusActive) {
        return
      }
      await this.onTransaction(data)
      this.p2p.sendGossipIn('transaction', data, tracker)
    })
  }

  /**
   * Register GossipHandlers with P2P class
   */
  async onTransaction (shardusTransaction) {
    if (this.mainLogs) this.mainLogger.debug(`Start of onTransaction(${shardusTransaction})`)
    const transHash = this.crypto.hash(shardusTransaction.inTransaction)
    this.pendingTransactions[transHash] = shardusTransaction
    if (this.mainLogs) this.mainLogger.debug(`End of onTransaction(${shardusTransaction})`)
  }

  async inject (shardusTransaction) {
    if (this.mainLogs) this.mainLogger.debug(`Start of inject(${shardusTransaction})`)
    let transactionReceipt
    let inTransaction = shardusTransaction.inTransaction
    try {
      // let keysRequest = { type: 'keyFromTransaction', txn: inTransaction }
      // let keysResponse = await this.application.get(keysRequest)
      if (this.mainLogs) this.mainLogger.debug(`Gossiping Validated Transaction ${JSON.stringify(shardusTransaction)}`)
      // TODO: Change this to use just the nodes in the conesensus group
      // await this.p2p.sendGossip('transaction', shardusTransaction, this.p2p.state.getAllNodes(this.p2p.id))
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

      transactionReceipt = this.createReciept(inTransaction, stateId, targetStateId)
    } catch (ex) {
      this.logger.getLogger('main').error(`Inject: Failed to process Transaction. Exception: ${ex}`)
      this.fatalLogger.fatal('inject: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      throw new Error(ex)
    }

    if (this.mainLogs) this.mainLogger.debug(`Gossiping Receipt Transaction ${JSON.stringify(transactionReceipt)}`)
    // USING GOSSIP IN NOW
    // await this.p2p.sendGossip('receipt', { shardusTransaction, transactionReceipt }, this.p2p.state.getAllNodes(this.p2p.id))
    await this.p2p.sendGossipIn('receipt', { shardusTransaction, transactionReceipt })
    if (this.mainLogs) this.mainLogger.debug(`Done Gossiping Receipt Transaction ${JSON.stringify(transactionReceipt)}`)
    if (this.mainLogs) this.mainLogger.debug(`End of inject(${inTransaction})`)

    return transactionReceipt
  }

  createReciept (tx, state, targetStateId) {
    let receipt = {
      stateId: state,
      targetStateId: targetStateId,
      txHash: this.crypto.hash(tx),
      time: Date.now()
    }
    receipt = this.crypto.sign(receipt) // sign with this node's key
    return receipt
  }

  // changed to {shardusTransaction, transactionReceipt} to fix out of order messaging.  real consensus will need to have a queue to apply changes
  async onReceipt (data) {
    this.profiler.profileSectionStart('onReceipt')

    // const shardusTransaction = this.pendingTransactions[receipt.txHash]
    const shardusTransaction = data.shardusTransaction
    let receipt = data.transactionReceipt
    if (shardusTransaction == null) {
      if (this.mainLogs) console.log(`onReceipt failed. No transaction found for: ${receipt.txHash}`)
      if (this.mainLogs) this.mainLogger.debug(`onReceipt failed. No transaction found for: ${receipt.txHash}`)
      return false
    }
    let transaction = shardusTransaction.inTransaction
    if (typeof transaction !== 'object') {
      if (this.mainLogs) console.log(`onReceipt failed. transaction is not an object: ${receipt.txHash}`)
      return false
    }

    let timestamp = transaction.txnTimestamp
    if (this.mainLogs) this.mainLogger.debug(`Queue onReceipt ${timestamp}`)

    // retrieve incoming transaction from HTTP request
    let ourLock = -1
    try {
      // TODO! validate that reciept is sign by a valid node in the network
      if (this.crypto.verify(receipt, receipt.sign.owner) === false) {
        if (this.mainLogs) console.log(`onReceipt failed. transaction has invalid signing: ${receipt.txHash}`)
        return false
      }

      // QUEUE delay system...
      ourLock = await this.queueAndDelay(transaction, receipt.txHash)
      if (this.mainLogs) this.mainLogger.debug(`Start of onReceipt ${timestamp}`)

      // ToDo: Revisit this check
      // check that the tx hash matches the receipt
      // let txhash = this.crypto.hash(transaction)
      // if (txhash !== receipt.txHash) {
      //   return false
      // }

      // Validate any target or source hashes if they are available
      // todo perf: we could pass the expected state values into the app and ask the app to bail/error if they dont match. this puts more burden on the app dev though

      let keysResponse = this.app.getKeyFromTransaction(transaction)
      let { sourceKeys, targetKeys } = keysResponse
      let sourceAddress, targetAddress, stateId, targetStateId

      if (Array.isArray(sourceKeys) && sourceKeys.length > 0) {
        sourceAddress = sourceKeys[0]
      }
      if (Array.isArray(targetKeys) && targetKeys.length > 0) {
        targetAddress = targetKeys[0]
      }
      if (receipt.stateId) {
        stateId = await this.app.getStateId(sourceAddress)
        if (stateId !== receipt.stateId) {
          throw new Error('onReceipt source stateid does not match reciept. ts:' + timestamp + ' stateId: ' + stateId + ' reciept: ' + receipt.stateId + ' account: ' + utils.makeShortHash(sourceAddress))
        }
      }
      if (receipt.targetStateId) {
        targetStateId = await this.app.getStateId(targetAddress, false)
        if (targetStateId !== receipt.targetStateId) {
          throw new Error('onReceipt target stateid does not match reciept. ts:' + timestamp + ' stateId: ' + targetStateId + ' reciept: ' + receipt.targetStateId + ' account: ' + utils.makeShortHash(targetAddress))
        }
      }

      await this.shardus.acceptTransaction(transaction, receipt, false, true)
      // TODO: Make this more robust, actually make sure the application has applied tx
      // if (this.reporter) this.reporter.incrementTxApplied()
    } catch (ex) {
      this.fatalLogger.fatal('Failed to process receipt: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
    } finally {
      this.profiler.profileSectionEnd('onReceipt')
      this.unlockQueue(ourLock)
    }
    if (this.mainLogs) this.mainLogger.debug(`End of onReceipt ${timestamp}`)
    return true
  }

  // special delay that cuases the calling function to wait.
  // many funcitions at a time can be stuck on this call.  This code will cause the calling functions to
  // exectue in timestamp order and one at a time.
  async queueAndDelay (timestamp, tieBreaker) {
    // return -1
    this.queueCounter++
    let currentTime = Date.now()
    let delta = currentTime - timestamp
    let soonestExecute = this.queueSitTime - delta
    if (soonestExecute < 0) {
      soonestExecute = 0
    }

    let ourID = this.queueCounter
    let entry = { id: ourID, timestamp, tieBreaker }

    // sorted insert into queue
    if (this.queueAndDelayList.length === 0) {
      this.queueAndDelayList.push(entry)
    } else {
      let index = this.queueAndDelayList.length - 1
      let lastTx = this.queueAndDelayList[index]
      while (index >= 0 && (timestamp < lastTx.timestamp || (timestamp === lastTx.timestamp && tieBreaker < lastTx.tieBreaker))) {
        index--
        lastTx = this.queueAndDelayList[index]
      }
      this.queueAndDelayList.splice(index + 1, 0, entry)
    }

    // utils.insertSorted(this.queueAndDelayList, entry, (a, b) => (a.timestamp > b.timestamp || (a.timestamp === b.timestamp && a.tieBreaker > b.tieBreaker)) ? 1 : -1)

    // this.mainLogger.debug(`list results: start`)
    // for (let i = 0; i < this.queueAndDelayList.length; i++) {
    //   this.mainLogger.debug(`list results: ${JSON.stringify(this.queueAndDelayList[i])}`)
    // }

    // Sleep until it is a valid time for us to do work
    await utils.sleep(soonestExecute)

    // wait till we are at the front of the queue, and the queue is not locked
    while (this.queueAndDelayList[0].id !== ourID || this.queueLocked) {
      // perf optimization to reduce the amount of times we have to sleep (attempt to come out of sleep at close to the right time)
      let sleepEstimate = ourID - this.lastServed
      if (sleepEstimate < 1) {
        sleepEstimate = 1
      }
      await utils.sleep(2 * sleepEstimate)
      // await utils.sleep(2)
    }

    // remove our entry from the array
    this.queueAndDelayList.shift()

    // this.mainLogger.debug(`queueAndDelay next TS ${timestamp}`)
    // lock things so that only our calling function can do work
    this.queueLocked = true
    this.lockOwner = ourID
    this.lastServed = ourID
    return ourID
  }

  unlockQueue (id) {
    if (this.lockOwner === id) {
      this.queueLocked = false
    } else if (id !== -1) {
      // this should never happen as long as we are careful to use try/finally blocks
      this.fatalLogger.fatal(`Failed to unlock the queue: ${id}`)
    }
  }
}

module.exports = Consensus
