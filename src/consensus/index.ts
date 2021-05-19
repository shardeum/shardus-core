import Log4js from 'log4js'
import Profiler from '../utils/profiler'
import Logger, {logFlags} from '../logger'
import Shardus from '../shardus/shardus-types'
import Storage from '../storage'
import Crypto from '../crypto'
import * as utils from '../utils'
import { EventEmitter } from 'events'
type P2P = typeof import('../p2p/Wrapper')

interface Consensus {
  profiler: Profiler
  app: Shardus.App
  config: Shardus.ShardusConfiguration
  logger: Logger
  mainLogger: Log4js.Logger
  fatalLogger: Log4js.Logger
  crypto: Crypto
  p2p: P2P
  storage: Storage
  pendingTransactions: any
  lastServed: number
}

class Consensus extends EventEmitter {
  constructor(
    app: Shardus.App,
    config: Shardus.ShardusConfiguration,
    logger: Logger,
    crypto: Crypto,
    storage: Storage,
    profiler: Profiler
  ) {
    super()
    this.profiler = profiler
    this.app = app
    this.config = config
    this.logger = logger
    this.mainLogger = this.logger.getLogger('main')
    this.fatalLogger = this.logger.getLogger('fatal')
    this.crypto = crypto
    this.storage = storage

    this.pendingTransactions = {}

    this.lastServed = 0
  }

  // TODO INJECT: I think we can consider refactoring this code into something else, and eliminate consensus/index.ts
  //              We also need to consider getting rid of some of the duplicate or unsed efforts here
  async inject(shardusTransaction, global, noConsensus) {
    let transactionReceipt
    const inTransaction = shardusTransaction.inTransaction
    let timestamp = 0
    let debugInfo = ''
    try {

      // TODO INJECT: state manager inject will run getKeyFromTransaction it seems we still need this to create the acceptedTX,
      //              but the subsequent validation of source and target address seem out of place
      const keysResponse = this.app.getKeyFromTransaction(inTransaction)
      const { sourceKeys, targetKeys } = keysResponse
      timestamp = keysResponse.timestamp
      debugInfo = keysResponse.debugInfo

      if (logFlags.debug) {
        this.mainLogger.debug(
          `Start of inject(globalModification:${global}  ts: ${timestamp} noConsensus:${noConsensus} dbg: ${debugInfo}  tx: ${utils.stringifyReduce(
            shardusTransaction
          )})`
        )
      }
      let sourceAddress, targetAddress, stateId, targetStateId

      if (Array.isArray(sourceKeys) && sourceKeys.length > 0) {
        sourceAddress = sourceKeys[0]
      }
      if (Array.isArray(targetKeys) && targetKeys.length > 0) {
        targetAddress = targetKeys[0]
      }
      if (logFlags.debug) {
        this.mainLogger.debug(
          `sourceAddress: ${utils.makeShortHash(
            sourceAddress
          )} targetAddress: ${utils.makeShortHash(targetAddress)}`
        )
      }

      // TODO INJECT: seems to just log errors if the address is missing.  I think we do still want some form of these
      // logs to help dapp developers quickly catch the mistakes.   
      if (sourceAddress) {
        if (logFlags.debug) {
          this.mainLogger.debug(`get source state id for ${sourceAddress}`)
        }
        stateId = null // await this.app.getStateId(sourceAddress)
        if (logFlags.debug) {
          this.mainLogger.debug(
            `StateID: ${stateId} short stateID: ${utils.makeShortHash(
              stateId
            )} `
          )
        }
      }

      if (targetAddress) {
        if (logFlags.debug) {
          this.mainLogger.debug(`get target state id for ${targetAddress}`)
        }
        targetStateId = null // await this.app.getStateId(targetAddress, false) // we don't require this to exist
        if (logFlags.debug) {
          this.mainLogger.debug(`targetStateId ${targetStateId}`)
        }
      }

      if(sourceAddress === null && targetAddress === null){
        throw new Error(`app.getKeyFromTransaction did not return any keys for the transaction: ${utils.stringifyReduce(shardusTransaction)}`)
      }

      if (logFlags.debug) {
        this.mainLogger.debug(
          `Creating the receipt for the transaction: StateID: ${stateId} short stateID: ${utils.makeShortHash(
            stateId
          )} `
        )
      }

      // TODO INJECT: this is an old receipt, or a reciept that we got the TX, note that the TX passed in here is also signed, 
      //              at the most seems like we only need to wrap up and sign the TX once
      transactionReceipt = this.createReceipt(
        inTransaction,
        stateId,
        targetStateId
      )
      if (logFlags.debug) {
        this.mainLogger.debug(
          `Done Creating the receipt for the transaction: StateID: ${stateId} short stateID: ${utils.makeShortHash(
            stateId
          )} `
        )
      }
    } catch (ex) {
      this.logger
        .getLogger('main')
        .error(`Inject: Failed to process Transaction. Exception: ${ex}`)
      this.fatalLogger.fatal(
        'inject: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack
      )
      this.logger.playbackLogNote(
        'tx_consensus_rejected',
        `${this.crypto.hash(inTransaction)}`,
        `Transaction: ${utils.stringifyReduce(inTransaction)}`
      )
      throw new Error(ex)
    }

    // TODO INJECT: Creating the accepted TX. I guess we do need this, not sure about he status or the receipt.
    const txStatus = 1 // todo real values for tx status. this is just a stand in
    const txId = transactionReceipt.txHash
    const acceptedTX = {
      id: txId,
      timestamp,
      data: inTransaction,
      status: txStatus,
      receipt: transactionReceipt,
    }

    // TODO INJECT: we do need to keep this. the arguments are important here.
    this.emit('accepted', acceptedTX,/*send gossip*/ true, null, global, noConsensus)
    this.logger.playbackLogNote(
      'tx_accepted',
      `TransactionId: ${txId}`,
      `AcceptedTransaction: ${utils.stringifyReduce(acceptedTX)}`
    )

    if (logFlags.debug) {
      this.mainLogger.debug(
        `End of inject(${timestamp}  debugInfo: ${debugInfo})`
      )
    }

    return transactionReceipt
  }

  createReceipt(tx, state, targetStateId) {
    let receipt = {
      stateId: state,
      targetStateId,
      txHash: this.crypto.hash(tx),
      time: Date.now(),
    }
    receipt = this.crypto.sign(receipt) // sign with this node's key
    return receipt
  }
}

export default Consensus
