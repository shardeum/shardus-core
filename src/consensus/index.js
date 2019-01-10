const utils = require('../utils')

class Consensus {
  constructor (accountUtility, config, logger, crypto, p2p, storage, nodeList, applicationInterfaceImpl, reporter) {
    this.accountUtility = accountUtility
    this.config = config
    this.logger = logger
    this.mainLogger = this.logger.getLogger('main')
    this.fatalLogger = this.logger.getLogger('fatal')
    this.crypto = crypto
    // this.network = network
    this.p2p = p2p
    this.storage = storage
    this.nodeList = nodeList
    this.applicationInterfaceImpl = applicationInterfaceImpl
    this.reporter = reporter

    this.pendingTransactions = {}

    this.consensusActive = false
    this.queueAndDelayList = []
    this.queueCounter = 0
    this.queueLocked = false
    this.queueSitTime = 3000 // todo make this a setting. and tie in with the value in datasync
    // Register Gossip Handlers with P2P
    this.p2p.registerGossipHandler('receipt', async (data) => {
      if (!this.consensusActive) {
        return
      }
      if (await this.onReceipt(data)) {
        console.log('onReceipt: ' + data.shardusTransaction.inTransaction.txnTimestmp) // todo remove
        this.p2p.sendGossip('receipt', data, this.p2p.state.getAllNodes(this.p2p.id))
      }
    })

    this.p2p.registerGossipHandler('transaction', async (data) => {
      if (!this.consensusActive) {
        return
      }
      await this.onTransaction(data)
      this.p2p.sendGossip('transaction', data, this.p2p.state.getAllNodes(this.p2p.id))
    })
  }

  /**
   * Register GossipHandlers with P2P class
   */
  async onTransaction (shardusTransaction) {
    this.mainLogger.debug(`Start of onTransaction(${shardusTransaction})`)
    const transHash = this.crypto.hash(shardusTransaction.inTransaction)
    this.pendingTransactions[transHash] = shardusTransaction
    this.mainLogger.debug(`End of onTransaction(${shardusTransaction})`)
  }

  async inject (shardusTransaction) {
    // TODO: Make this report more robust, actually make sure that we are getting all injected txs from app
    this.reporter.incrementTxInjected()
    this.mainLogger.debug(`Start of inject(${shardusTransaction})`)
    let transactionReceipt
    let inTransaction = shardusTransaction.inTransaction
    try {
      // let keysRequest = { type: 'keyFromTransaction', txn: inTransaction }
      // let keysResponse = await this.application.get(keysRequest)
      this.mainLogger.debug(`Gossiping Validated Transaction ${JSON.stringify(shardusTransaction)}`)
      // TODO: Change this to use just the nodes in the conesensus group
      // await this.p2p.sendGossip('transaction', shardusTransaction, this.p2p.state.getAllNodes(this.p2p.id))
      this.mainLogger.debug(`Done Gossiping Validated Transaction ${JSON.stringify(shardusTransaction)}`)
      let keysResponse = this.applicationInterfaceImpl.getKeyFromTransaction(inTransaction)
      let { sourceKeys, targetKeys } = keysResponse
      let sourceAddress, targetAddress, stateId, targetStateId

      if (Array.isArray(sourceKeys) && sourceKeys.length > 0) {
        sourceAddress = sourceKeys[0]
      }
      if (Array.isArray(targetKeys) && targetKeys.length > 0) {
        targetAddress = targetKeys[0]
      }
      this.mainLogger.debug(`sourceAddress: ${JSON.stringify(sourceAddress)} targetAddress: ${JSON.stringify(targetAddress)}`)

      if (sourceAddress) {
        // keysRequest = { type: 'stateID', address: sourceAddress }
        // stateID = await this.application.get(keysRequest)
        stateId = await this.applicationInterfaceImpl.getStateId(sourceAddress)
        this.mainLogger.debug(`StateID: ${stateId}`)
      }

      if (targetAddress) {
        targetStateId = await this.applicationInterfaceImpl.getStateId(targetAddress, false) // we don't require this to exist
      }

      transactionReceipt = this.createReciept(inTransaction, stateId, targetStateId)
    } catch (ex) {
      this.logger.getLogger('main').error(`Failed to process Transaction. Exception: ${ex}`)
      throw new Error(ex)
    }

    this.mainLogger.debug(`Gossiping Receipt Transaction ${JSON.stringify(transactionReceipt)}`)
    await this.p2p.sendGossip('receipt', { shardusTransaction, transactionReceipt }, this.p2p.state.getAllNodes(this.p2p.id))
    this.mainLogger.debug(`Done Gossiping Receipt Transaction ${JSON.stringify(transactionReceipt)}`)
    this.mainLogger.debug(`End of inject(${inTransaction})`)

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
    this.mainLogger.debug(`Start of onReciept`)
    // const shardusTransaction = this.pendingTransactions[receipt.txHash]
    const shardusTransaction = data.shardusTransaction
    let receipt = data.transactionReceipt
    if (shardusTransaction == null) {
      console.log(`onReceipt failed. No transaction found for: ${receipt.txHash}`)
      this.mainLogger.debug(`onReceipt failed. No transaction found for: ${receipt.txHash}`)
      return // todo error
    }
    let transaction = shardusTransaction.inTransaction
    // retrieve incoming transaction from HTTP request
    let ourLock = -1
    try {
      if (typeof transaction !== 'object') {
        return false
      }
      // TODO! validate that reciept is sign by a valid node in the network
      if (this.crypto.verify(receipt, receipt.sign.owner) === false) {
        return false
      }

      let timestamp = transaction.txnTimestmp
      // QUEUE delay system...
      ourLock = await this.queueAndDelay(transaction, receipt.txHash)

      // ToDo: Revisit this check
      // check that the tx hash matches the receipt
      // let txhash = this.crypto.hash(transaction)
      // if (txhash !== receipt.txHash) {
      //   return false
      // }

      // Validate any target or source hashes if they are available
      // todo perf: we could pass the expected state values into the app and ask the app to bail/error if they dont match. this puts more burden on the app dev though

      let keysResponse = this.applicationInterfaceImpl.getKeyFromTransaction(transaction)
      let { sourceKeys, targetKeys } = keysResponse
      let sourceAddress, targetAddress, stateId, targetStateId

      if (Array.isArray(sourceKeys) && sourceKeys.length > 0) {
        sourceAddress = sourceKeys[0]
      }
      if (Array.isArray(targetKeys) && targetKeys.length > 0) {
        targetAddress = targetKeys[0]
      }
      if (receipt.stateId) {
        stateId = await this.applicationInterfaceImpl.getStateId(sourceAddress)
        if (stateId !== receipt.stateId) {
          throw new Error('onReceipt source stateid does not match reciept. ts:' + timestamp + ' stateId: ' + stateId + ' reciept: ' + receipt.stateId)
        }
      }
      if (receipt.targetStateId) {
        targetStateId = await this.applicationInterfaceImpl.getStateId(targetAddress, false)
        if (targetStateId !== receipt.targetStateId) {
          throw new Error('onReceipt target stateid does not match reciept. ts:' + timestamp + ' stateId: ' + targetStateId + ' reciept: ' + receipt.targetStateId)
        }
      }

      this.accountUtility.acceptTransaction(transaction, receipt)
      // TODO: Make this more robust, actually make sure the application has applied tx
      this.reporter.incrementTxApplied()
    } catch (ex) {
      this.fatalLogger.fatal(`Failed to process receipt. Exception: ${ex}`)
    } finally {
      this.unlockQueue(ourLock)
    }
    this.mainLogger.debug(`End of onReceipt`)
    return true
  }

  // special delay that cuases the calling function to wait.
  // many funcitions at a time can be stuck on this call.  This code will cause the calling functions to
  // exectue in timestamp order and one at a time.
  async queueAndDelay (timestamp, tieBreaker) {
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

    // Sleep until it is a valid time for us to do work
    await utils.sleep(soonestExecute)

    // wait till we are at the front of the queue, and the queue is not locked
    while (this.queueAndDelayList[0].id !== ourID && this.queueLocked) {
      await utils.sleep(2)
    }
    // lock things so that only our calling function can do work
    this.queueLocked = true
    this.lockOwner = ourID
    return ourID
  }

  unlockQueue (id) {
    if (this.lockOwner === id) {
      this.queueLocked = false
    } else {
      // this should never happen as long as we are careful to use try/finally blocks
      this.fatalLogger.fatal(`Failed to unlock the queue: ${id}`)
    }
  }
}

module.exports = Consensus
