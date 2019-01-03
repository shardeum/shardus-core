
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
    // Register Gossip Handlers with P2P
    this.p2p.registerGossipHandler('receipt', async (data) => {
      if (await this.onReceipt(data)) {
        this.p2p.sendGossip('receipt', data, this.p2p.state.getAllNodes(this.p2p.id))
      }
    })

    this.p2p.registerGossipHandler('transaction', async (data) => {
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
      let sourceAddress, targetAddress, stateId

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
      transactionReceipt = this.createReciept(inTransaction, stateId)
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

  createReciept (tx, state) {
    let receipt = {
      stateId: state,
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
    try {
      if (typeof transaction !== 'object') {
        return false
      }
      // TODO! validate that reciept is sign by a valid node in the network
      if (this.crypto.verify(receipt, receipt.sign.owner) === false) {
        return false
      }

      // ToDo: Revisit this check
      // check that the tx hash matches the receipt
      // let txhash = this.crypto.hash(transaction)
      // if (txhash !== receipt.txHash) {
      //   return false
      // }

      this.accountUtility.acceptTransaction(transaction, receipt)
      // TODO: Make this more robust, actually make sure the application has applied tx
      this.reporter.incrementTxApplied()
    } catch (ex) {
      this.fatalLogger.fatal(`Failed to process receipt. Exception: ${ex}`)
    }
    this.mainLogger.debug(`End of onReceipt`)
    return true
  }
}

module.exports = Consensus
