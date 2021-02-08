import { ShardusConfiguration } from '../shardus/shardus-types'
import Shardus = require('../shardus/shardus-types')
import { ShardGlobals, ShardInfo, StoredPartition, NodeShardData, AddressRange, HomeNodeSummary, ParititionShardDataMap, NodeShardDataMap, MergeResults, BasicAddressRange } from './shardFunctionTypes'
import * as utils from '../utils'
const stringify = require('fast-stable-stringify')

import Profiler from '../utils/profiler'
import { P2PModuleContext as P2P } from '../p2p/Context'
import Storage from '../storage'
import Crypto from '../crypto'
import Logger from '../logger'
import ShardFunctions from './shardFunctions2.js'
import { time } from 'console'
import StateManager from '.'

import ShardFunctions2 from './shardFunctions2.js' // oof, need to refactor this!


class TransactionRepair {
  app: Shardus.App
  crypto: Crypto
  config: Shardus.ShardusConfiguration
  profiler: Profiler
  verboseLogs: boolean
  logger: Logger
  p2p: P2P
  storage: Storage
  stateManager: StateManager

  mainLogger: any
  fatalLogger: any
  shardLogger: any
  statsLogger: any
  statemanager_fatal: (key: string, log: string) => void

  constructor(stateManager: StateManager, verboseLogs: boolean, profiler: Profiler, app: Shardus.App, logger: Logger,storage: Storage, p2p: P2P, crypto: Crypto, config: Shardus.ShardusConfiguration) {
    this.verboseLogs = verboseLogs
    this.crypto = crypto
    this.app = app
    this.logger = logger
    this.config = config
    this.profiler = profiler
    this.p2p = p2p
    this.storage = storage
    this.stateManager = stateManager
    

    this.mainLogger = logger.getLogger('main')
    this.fatalLogger = logger.getLogger('fatal')
    this.shardLogger = logger.getLogger('shardDump')
    this.statsLogger = logger.getLogger('statsDump')
    this.statemanager_fatal = stateManager.statemanager_fatal


  }

  async repairToMatchReceipt(queueEntry: QueueEntry) {
    if (this.stateManager.currentCycleShardData == null) {
      return
    }
    // if (!queueEntry.requests) {
    //   queueEntry.requests = {}
    // }
    if (queueEntry.uniqueKeys == null) {
      throw new Error('repairToMatchReceipt queueEntry.uniqueKeys == null')
    }

    try {
      this.profiler.profileSectionStart('repair')

      let shortHash = utils.makeShortHash(queueEntry.acceptedTx.id)
      // Need to build a list of what accounts we need, what state they should be in and who to get them from
      let requestObjects: { [id: string]: { appliedVote: AppliedVote; voteIndex: number; accountHash: string; accountId: string; nodeShardInfo: NodeShardData; alternates: string[] } } = {}
      let appliedVotes = queueEntry.appliedReceiptForRepair.appliedVotes

      //shuffle the array
      utils.shuffleArray(appliedVotes)

      let allKeys = []

      if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `appliedVotes ${utils.stringifyReduce(appliedVotes)}  `)
      if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `queueEntry.uniqueKeys ${utils.stringifyReduce(queueEntry.uniqueKeys)}`)

      this.mainLogger.debug(`repairToMatchReceipt: ${shortHash} queueEntry.uniqueKeys ${utils.stringifyReduce(queueEntry.uniqueKeys)}`)

      for (let key of queueEntry.uniqueKeys) {
        let coveredKey = false
        for (let i = 0; i < appliedVotes.length; i++) {
          let appliedVote = appliedVotes[i]
          for (let j = 0; j < appliedVote.account_id.length; j++) {
            let id = appliedVote.account_id[j]
            let hash = appliedVote.account_state_hash_after[j]
            if (id === key && hash != null) {
              if (requestObjects[key] != null) {
                //todo perf delay these checks for jit.
                if (appliedVote.node_id !== this.stateManager.currentCycleShardData.ourNode.id) {
                  if (this.stateManager.currentCycleShardData.nodeShardDataMap.has(appliedVote.node_id) === true) {
                    //build a list of alternates
                    requestObjects[key].alternates.push(appliedVote.node_id)
                  }
                }
                continue //we already have this request ready to go
              }

              coveredKey = true
              if (appliedVote.node_id === this.stateManager.currentCycleShardData.ourNode.id) {
                //dont reference our own node, should not happen anyway
                if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `appliedVote.node_id != this.stateManager.currentCycleShardData.ourNode.id ${utils.stringifyReduce(appliedVote.node_id)} our: ${utils.stringifyReduce(this.stateManager.currentCycleShardData.ourNode.id)} `)
                continue
              }
              if (this.stateManager.currentCycleShardData.nodeShardDataMap.has(appliedVote.node_id) === false) {
                if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `this.stateManager.currentCycleShardData.nodeShardDataMap.has(appliedVote.node_id) === false ${utils.stringifyReduce(appliedVote.node_id)} `)
                continue
              }
              let nodeShardInfo: NodeShardData = this.stateManager.currentCycleShardData.nodeShardDataMap.get(appliedVote.node_id)

              if (nodeShardInfo == null) {
                this.mainLogger.error(`shrd_repairToMatchReceipt nodeShardInfo == null ${utils.stringifyReduce(appliedVote.node_id)}`)
                continue
              }
              if (ShardFunctions2.testAddressInRange(id, nodeShardInfo.storedPartitions) == false) {
                if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `address not in range ${utils.stringifyReduce(nodeShardInfo.storedPartitions)}`)
                continue
              }
              let objectToSet = { appliedVote, voteIndex: j, accountHash: hash, accountId: id, nodeShardInfo, alternates: [] }
              if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `setting key ${utils.stringifyReduce(key)} ${utils.stringifyReduce(objectToSet)} `)
              requestObjects[key] = objectToSet
              allKeys.push(key)
            } else {
            }
          }
        }

        if (coveredKey === false) {
          if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `coveredKey === false`)
          //todo log error on us not finding this key
        }
      }

      //let receipt = queueEntry.appliedReceiptForRepair

      if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_repairToMatchReceipt_start', `${shortHash}`, `qId: ${queueEntry.entryID} AccountsMissing:${utils.stringifyReduce(allKeys)}  requestObject:${utils.stringifyReduce(requestObjects)}`)

      for (let key of queueEntry.uniqueKeys) {
        if (requestObjects[key] != null) {
          let requestObject = requestObjects[key]

          if (requestObject == null) {
            if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `requestObject == null`)
            continue
          }

          let node = requestObject.nodeShardInfo.node
          if (node == null) {
            this.mainLogger.error(`shrd_repairToMatchReceipt node == null ${utils.stringifyReduce(requestObject.accountId)}`)
            if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `node == null`)
            continue
          }

          let alternateIndex = 0
          let attemptsRemaining = true
          while (attemptsRemaining === true) {
            //go down alternates list as needed.
            while (node == null) {
              //possibly make this not at an error once verified
              this.mainLogger.error(`shrd_repairToMatchReceipt while(node == null) look for other node txId. idx:${alternateIndex} txid: ${utils.stringifyReduce(requestObject.appliedVote.txid)} alts: ${utils.stringifyReduce(requestObject.alternates)}`)
              //find alternate
              if (alternateIndex >= requestObject.alternates.length) {
                this.statemanager_fatal(`repairToMatchReceipt_1`, `ASK FAIL repairToMatchReceipt failed to find alternate node to ask for receipt. txId. ${utils.stringifyReduce(requestObject.appliedVote.txid)} alts: ${utils.stringifyReduce(requestObject.alternates)}`)
                attemptsRemaining = false
                return
              }
              let altId = requestObject.alternates[alternateIndex]
              let nodeShardInfo: NodeShardData = this.stateManager.currentCycleShardData.nodeShardDataMap.get(altId)
              if (nodeShardInfo != null) {
                node = nodeShardInfo.node
                this.mainLogger.error(`shrd_repairToMatchReceipt got alt source node: idx:${alternateIndex} txid: ${utils.stringifyReduce(requestObject.appliedVote.txid)} alts: ${utils.stringifyReduce(node.id)}`)
              } else {
                this.mainLogger.error(`shrd_repairToMatchReceipt nodeShardInfo == null for ${utils.stringifyReduce(altId)}`)
              }
              alternateIndex++
            }

            let relationString = '' //ShardFunctions.getNodeRelation(homeNodeShardData, this.stateManager.currentCycleShardData.ourNode.id)
            if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_repairToMatchReceipt_ask', `${shortHash}`, `r:${relationString}   asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} AccountsMissing:${utils.stringifyReduce(allKeys)}`)

            // Node Precheck!
            if (this.stateManager.isNodeValidForInternalMessage(node.id, 'repairToMatchReceipt', true, true) === false) {
              // if(this.tryNextDataSourceNode('repairToMatchReceipt') == false){
              //   break
              // }
              node = null
              continue
            }

            let message = { key: requestObject.accountId, hash: requestObject.accountHash, txid: queueEntry.acceptedTx.id, timestamp: queueEntry.acceptedTx.timestamp }
            let result: RequestStateForTxResp = await this.p2p.ask(node, 'request_state_for_tx_post', message) // not sure if we should await this.

            if (result == null) {
              if (this.verboseLogs) {
                this.mainLogger.error('ASK FAIL repairToMatchReceipt request_state_for_tx_post result == null')
              }
              // We shuffle the array of votes each time so hopefully will ask another node next time
              // TODO more robust limits to this process, maybe a delay?
              this.mainLogger.error(`ASK FAIL repairToMatchReceipt request_state_for_tx_post no reponse from ${utils.stringifyReduce(node.id)}`)
              //this.fatalLogger.fatal(`ASK FAIL repairToMatchReceipt missing logic to ask a new node! 1 ${utils.stringifyReduce(node.id)}`)
              node = null
              continue
            }

            if (result.success !== true) {
              this.mainLogger.error('ASK FAIL repairToMatchReceipt result.success === false')
              //this.fatalLogger.fatal(`ASK FAIL repairToMatchReceipt missing logic to ask a new node! 2 ${utils.stringifyReduce(node.id)}`)
              node = null
              continue
            }

            let dataCountReturned = 0
            let accountIdsReturned = []
            for (let data of result.stateList) {
              if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `write data: ${utils.stringifyReduce(data)}`)
              //Commit the data
              let dataToSet = [data]
              let failedHashes = await this.stateManager.checkAndSetAccountData(dataToSet, 'repairToMatchReceipt', false)
              await this.stateManager.writeCombinedAccountDataToBackups(dataToSet, failedHashes)
              attemptsRemaining = false
              //update global cache?  that will be obsolete soona anyhow!
              //need to loop and call update
              let beforeData = data.prevDataCopy

              if (beforeData == null) {
                //prevDataCopy
                let wrappedAccountDataBefore = queueEntry.collectedData[data.accountId]
                if (wrappedAccountDataBefore != null) {
                  beforeData = wrappedAccountDataBefore.data
                }
              }
              if (beforeData == null) {
                let results = await this.app.getAccountDataByList([data.accountId])
                beforeData = results[0]
                this.mainLogger.error(`repairToMatchReceipt: statsDataSummaryUpdate2 beforeData: had to query for data 1 ${utils.stringifyReduce(data.accountId)} `)
                if (beforeData == null) {
                  this.mainLogger.error(`repairToMatchReceipt: statsDataSummaryUpdate2 beforeData: had to query for data 1 not found ${utils.stringifyReduce(data.accountId)} `)
                }
              }
              if (beforeData == null) {
                this.mainLogger.error(`repairToMatchReceipt: statsDataSummaryUpdate2 beforeData data is null ${utils.stringifyReduce(data.accountId)} WILL CAUSE DATA OOS`)
              } else {
                if (this.stateManager.partitionStats.hasAccountBeenSeenByStats(data.accountId) === false) {
                  // Init stats because we have not seen this account yet.
                  this.stateManager.partitionStats.statsDataSummaryInitRaw(queueEntry.cycleToRecordOn, data.accountId, beforeData)
                }

                // important to update the timestamp.  There are various reasons it could be incorrectly set to 0
                let { timestamp: updatedTimestamp, hash: updatedHash } = this.app.getTimestampAndHashFromAccount(data.data)
                if (data.timestamp != updatedTimestamp) {
                  this.mainLogger.error(`repairToMatchReceipt: statsDataSummaryUpdate2 timstamp had to be corrected from ${data.timestamp} to ${updatedTimestamp} `)
                }
                data.timestamp = updatedTimestamp

                // update stats
                this.stateManager.partitionStats.statsDataSummaryUpdate2(queueEntry.cycleToRecordOn, beforeData, data)

                // record state table data
                let { timestamp: oldtimestamp, hash: oldhash } = this.app.getTimestampAndHashFromAccount(beforeData)

                let hashNeededUpdate = oldhash !== result.beforeHashes[data.accountId]
                oldhash = result.beforeHashes[data.accountId]

                let stateTableResults: Shardus.StateTableObject = {
                  accountId: data.accountId,
                  txId: queueEntry.acceptedTx.id,
                  stateBefore: oldhash,
                  stateAfter: updatedHash,
                  txTimestamp: `${updatedTimestamp}`,
                }

                let updateStateTable = true
                let timeStampMatches = updatedTimestamp === queueEntry.acceptedTx.timestamp
                let test2 = false
                if (timeStampMatches === false) {
                  if (this.stateManager.accountGlobals.isGlobalAccount(data.accountId)) {
                    updateStateTable = false
                    test2 = true
                  }
                }
                let test3 = false
                if (this.stateManager.accountGlobals.isGlobalAccount(data.accountId)) {
                  if (oldhash === updatedHash) {
                    updateStateTable = false
                    test3 = true
                  }
                }
                if (updateStateTable === true) {
                  await this.storage.addAccountStates(stateTableResults)
                }
                this.mainLogger.debug(`repairToMatchReceipt: addAccountStates neededUpdate:${hashNeededUpdate} updateStateTable:${updateStateTable} timeStampMatches:${timeStampMatches} test2:${test2} test3:${test3} ${utils.stringifyReduce(stateTableResults)} `)
              }
            }

            // if (queueEntry.hasAll === true) {
            //   queueEntry.logstate = 'got all missing data'
            // } else {
            //   queueEntry.logstate = 'failed to get data:' + queueEntry.hasAll
            //   // queueEntry.state = 'failed to get data'
            // }

            if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_repairToMatchReceipt_result', `${shortHash}`, `r:${relationString}   result:${queueEntry.logstate} dataCount:${dataCountReturned} asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID}  AccountsMissing:${utils.stringifyReduce(allKeys)} AccountsReturned:${utils.stringifyReduce(accountIdsReturned)}`)

            // // queueEntry.homeNodes[key] = null
            // for (let key2 of allKeys) {
            //   //consider deleteing these instead?
            //   //TSConversion changed to a delete opertaion should double check this
            //   //queueEntry.requests[key2] = null
            //   delete queueEntry.requests[key2]
            // }

            // if (queueEntry.hasAll === true) {
            //   break
            // }
          }
        }
      }

      // Set this when data has been repaired.
      queueEntry.repairFinished = true
    } finally {
      this.profiler.profileSectionEnd('repair')
    }
  }



}

export default TransactionRepair
