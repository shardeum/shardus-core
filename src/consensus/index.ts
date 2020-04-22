import Log4js from 'log4js'
import Profiler from '../utils/profiler'
import Logger from '../logger'
import Shardus from '../shardus/shardus-types'
import Storage from '../storage'
import Crypto from '../crypto'
import * as utils from '../utils'
import { EventEmitter } from 'events'
type P2P = typeof import('../p2p')

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
  mainLogs: boolean
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

    this.mainLogs = false
    if (this.mainLogger && ['TRACE', 'debug'].includes(this.mainLogger.level)) {
      this.mainLogs = true
    }

    this.lastServed = 0
  }

  async inject(shardusTransaction, global) {
    let transactionReceipt
    const inTransaction = shardusTransaction.inTransaction
    let timestamp = 0
    let debugInfo = ''
    try {
      const keysResponse = this.app.getKeyFromTransaction(inTransaction)
      const { sourceKeys, targetKeys } = keysResponse
      timestamp = keysResponse.timestamp
      debugInfo = keysResponse.debugInfo

      if (this.mainLogs) {
        this.mainLogger.debug(
          `Start of inject(globalModification:${global}   ${timestamp}  ${debugInfo}  tx: ${utils.stringifyReduce(
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
      if (this.mainLogs) {
        this.mainLogger.debug(
          `sourceAddress: ${utils.makeShortHash(
            sourceAddress
          )} targetAddress: ${utils.makeShortHash(targetAddress)}`
        )
      }

      if (sourceAddress) {
        if (this.mainLogs) {
          this.mainLogger.debug(`get source state id for ${sourceAddress}`)
        }
        stateId = null // await this.app.getStateId(sourceAddress)
        if (this.mainLogs) {
          this.mainLogger.debug(
            `StateID: ${stateId} short stateID: ${utils.makeShortHash(
              stateId
            )} `
          )
        }
      }

      if (targetAddress) {
        if (this.mainLogs) {
          this.mainLogger.debug(`get target state id for ${targetAddress}`)
        }
        targetStateId = null // await this.app.getStateId(targetAddress, false) // we don't require this to exist
        if (this.mainLogs) {
          this.mainLogger.debug(`targetStateId ${targetStateId}`)
        }
      }

      if (this.mainLogs) {
        this.mainLogger.debug(
          `Creating the receipt for the transaction: StateID: ${stateId} short stateID: ${utils.makeShortHash(
            stateId
          )} `
        )
      }
      transactionReceipt = this.createReceipt(
        inTransaction,
        stateId,
        targetStateId
      )
      if (this.mainLogs) {
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

    const txStatus = 1 // todo real values for tx status. this is just a stand in
    const txId = transactionReceipt.txHash
    const acceptedTX = {
      id: txId,
      timestamp,
      data: inTransaction,
      status: txStatus,
      receipt: transactionReceipt,
    }

    this.emit('accepted', acceptedTX, true, null, global)
    this.logger.playbackLogNote(
      'tx_accepted',
      `TransactionId: ${txId}`,
      `AcceptedTransaction: ${utils.stringifyReduce(acceptedTX)}`
    )

    if (this.mainLogs) {
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
