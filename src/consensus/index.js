
const cryptoRaw = require('shardus-crypto-utils')
cryptoRaw('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')
class Consensus {
  constructor (config, logger, crypto, network, storage, nodeList, applicationInterfaceImpl) {
    this.config = config
    this.logger = logger
    this.mainLogger = this.logger.getLogger('main')
    this.crypto = crypto
    this.network = network
    this.storage = storage
    this.nodeList = nodeList
    this.applicationInterfaceImpl = applicationInterfaceImpl
  }

  async inject (shardusTransaction) {
    this.mainLogger.debug(`Start of inject(${shardusTransaction})`)
    let transactionReceipt
    let inTransaction = shardusTransaction.inTransaction
    try {
      // let keysRequest = { type: 'keyFromTransaction', txn: inTransaction }
      // let keysResponse = await this.application.get(keysRequest)
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
      transactionReceipt = this.createReciept(inTransaction, null, stateId)
    } catch (ex) {
      this.logger.getLogger('main').error(`Failed to process Transaction. Exception: ${ex}`)
      throw new Error(ex)
    }
    this.mainLogger.debug(`End of inject(${inTransaction})`)
    return transactionReceipt
  }

  createReciept (tx, validator, state) {
    let reciept = {
      stateId: state,
      txHash: cryptoRaw.hashObj(tx),
      time: Date.now()
    }
    this.crypto.sign(reciept) // sign with this node's key
    // cryptoRaw.signObj(reciept, validator.secretKey, validator.publicKey)
    return reciept
  }
}

module.exports = Consensus
