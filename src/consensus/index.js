
const cryptoRaw = require('shardus-crypto-utils')
cryptoRaw('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')
class Consensus {
  constructor (config, logger, crypto, p2p, storage, nodeList, applicationInterfaceImpl) {
    this.config = config
    this.logger = logger
    this.mainLogger = this.logger.getLogger('main')
    this.crypto = crypto
    // this.network = network
    this.p2p = p2p
    this.storage = storage
    this.nodeList = nodeList
    this.applicationInterfaceImpl = applicationInterfaceImpl

    this.pendingTransactions = {}
    // Register Gossip Handlers with P2P
    this.p2p.registerGossipHandler('receipt', async (data) => {
      await this.onReceipt(data)
    })

    this.p2p.registerGossipHandler('transaction', async (data) => {
      await this.onTransaction(data)
    })
  }

  /**
   * Register GossipHandlers with P2P class
   */
  async onTransaction (shardusTransaction) {
    this.mainLogger.debug(`Start of onTransaction(${shardusTransaction})`)
    const transHash = cryptoRaw.hashObj(shardusTransaction.inTransaction)
    this.pendingTransactions[transHash] = shardusTransaction
    this.mainLogger.debug(`End of onTransaction(${shardusTransaction})`)
  }

  // ///////////////////////////////////////////////////////////////
  // TODO register an endpoint to recieve a pending transaction via gossip
  // TODO register an endpoint to recieve gossip of reciepts  (calls onReceipt)
  // ///////////////////////////////////////////////////////////////

  async inject (shardusTransaction) {
    this.mainLogger.debug(`Start of inject(${shardusTransaction})`)
    let transactionReceipt
    let inTransaction = shardusTransaction.inTransaction
    try {
      // let keysRequest = { type: 'keyFromTransaction', txn: inTransaction }
      // let keysResponse = await this.application.get(keysRequest)
      this.mainLogger.debug(`Gossiping Validated Transaction ${JSON.stringify(shardusTransaction)}`)
      this.p2p.sendGossip('transaction', shardusTransaction)
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
    this.p2p.sendGossip('receipt', transactionReceipt)
    this.mainLogger.debug(`Done Gossiping Receipt Transaction ${JSON.stringify(transactionReceipt)}`)
    this.mainLogger.debug(`End of inject(${inTransaction})`)

    return transactionReceipt
  }

  createReciept (tx, state) {
    let receipt = {
      stateId: state,
      txHash: cryptoRaw.hashObj(tx),
      time: Date.now()
    }
    receipt = this.crypto.sign(receipt) // sign with this node's key
    // cryptoRaw.signObj(reciept, validator.secretKey, validator.publicKey)
    return receipt
  }

  async onReceipt (receipt) {
    this.mainLogger.debug(`Start of onReciept`)
    const shardusTransaction = this.pendingTransactions[receipt.txHash]
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
      // let txhash = this.crypto.hash(transaction) // todo use this instead: cryptoRaw.hashObj(transaction)
      // if (txhash !== receipt.txHash) {
      //   return false
      // }

      await this.applicationInterfaceImpl.apply(transaction, receipt)
    } catch (ex) {
      this.fatalLogger.fatal(`Failed to process receipt. Exception: ${ex}`)
    }
    this.mainLogger.debug(`End of onReceipt`)
    return true
  }
}

module.exports = Consensus
