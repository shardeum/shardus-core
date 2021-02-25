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
import ShardFunctions from './shardFunctions.js'
import { time } from 'console'
import StateManager from '.'

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

  constructor(stateManager: StateManager, verboseLogs: boolean, profiler: Profiler, app: Shardus.App, logger: Logger, storage: Storage, p2p: P2P, crypto: Crypto, config: Shardus.ShardusConfiguration) {
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
      this.stateManager.dataRepairsStarted++

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

      // Build a request object for each key involved.
      // once we have a valid request object add in alternate nodes we could use as a backup

      let upToDateAccounts: { [id: string]: boolean }  = {}

      for (let key of queueEntry.uniqueKeys) {
        let coveredKey = false

        let isGlobal = this.stateManager.accountGlobals.isGlobalAccount(key)
        let shortKey = utils.stringifyReduce(key)
        //It modifying global.
        for (let i = 0; i < appliedVotes.length; i++) {
          let appliedVote = appliedVotes[i]
          for (let j = 0; j < appliedVote.account_id.length; j++) {
            let id = appliedVote.account_id[j]
            let hash = appliedVote.account_state_hash_after[j]
            if (id === key && hash != null) {

              if(upToDateAccounts[id] === true){
                continue
              }

              let hashObj = this.stateManager.accountCache.getAccountHash(key)
              if(hashObj != null){
                if(hashObj.h === hash){
                  upToDateAccounts[id] = true
                  break
                }
              }    
              
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
                if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `appliedVote.node_id != this.stateManager.currentCycleShardData.ourNode.id ${utils.stringifyReduce(appliedVote.node_id)} our: ${utils.stringifyReduce(this.stateManager.currentCycleShardData.ourNode.id)} acc:${shortKey}`)
                continue
              }
              if (this.stateManager.currentCycleShardData.nodeShardDataMap.has(appliedVote.node_id) === false) {
                if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `this.stateManager.currentCycleShardData.nodeShardDataMap.has(appliedVote.node_id) === false ${utils.stringifyReduce(appliedVote.node_id)}  acc:${shortKey}`)
                continue
              }
              let nodeShardInfo: NodeShardData = this.stateManager.currentCycleShardData.nodeShardDataMap.get(appliedVote.node_id)

              if (nodeShardInfo == null) {
                this.mainLogger.error(`shrd_repairToMatchReceipt nodeShardInfo == null ${utils.stringifyReduce(appliedVote.node_id)} tx:${shortHash} acc:${shortKey}`)
                continue
              }
              // if the account is not global check if it is in range.
              if (isGlobal === false && ShardFunctions.testAddressInRange(id, nodeShardInfo.storedPartitions) == false) {
                if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `address not in range ${utils.stringifyReduce(nodeShardInfo.storedPartitions)}  acc:${shortKey}`)
                continue
              }
              let objectToSet = { appliedVote, voteIndex: j, accountHash: hash, accountId: id, nodeShardInfo, alternates: [] }
              if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `setting key ${utils.stringifyReduce(key)} ${utils.stringifyReduce(objectToSet)}  acc:${shortKey}`)
              requestObjects[key] = objectToSet
              allKeys.push(key)
            } else {
            }
          }
        }

        if (coveredKey === false) {
          if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `coveredKey === false  acc:${shortKey}`)
          //todo log error on us not finding this key
        }
      }

      //let receipt = queueEntry.appliedReceiptForRepair

      if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_repairToMatchReceipt_start', `${shortHash}`, `qId: ${queueEntry.entryID} AccountsMissing:${utils.stringifyReduce(allKeys)}  requestObject:${utils.stringifyReduce(requestObjects)}`)

      for (let key of queueEntry.uniqueKeys) {
        let shortKey = utils.stringifyReduce(key)
        if (requestObjects[key] != null) {
          let requestObject = requestObjects[key]

          if (requestObject == null) {
            if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `requestObject == null  acc:${shortKey}`)
            continue
          }

          let node = requestObject.nodeShardInfo.node
          if (node == null) {
            this.mainLogger.error(`shrd_repairToMatchReceipt node == null ${utils.stringifyReduce(requestObject.accountId)}`)
            if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `node == null  acc:${shortKey}`)
            continue
          }

          let alternateIndex = 0
          let attemptsRemaining = true

          let checkNodeDown = true
          let checkNodeLost = true

          let outerloopCount = 0
          while (outerloopCount <= 2) {
            outerloopCount++
            while (attemptsRemaining === true) {
              //go down alternates list as needed.
              while (node == null) {
                //possibly make this not at an error once verified
                this.mainLogger.error(`shrd_repairToMatchReceipt while(node == null) look for other node txId. idx:${alternateIndex} txid: ${utils.stringifyReduce(requestObject.appliedVote.txid)} alts: ${utils.stringifyReduce(requestObject.alternates)}  acc:${shortKey}`)
                //find alternate
                if (alternateIndex >= requestObject.alternates.length) {
                  this.statemanager_fatal(`repairToMatchReceipt_1`, `ASK FAIL repairToMatchReceipt failed to find alternate node to ask for receipt. txId. ${utils.stringifyReduce(requestObject.appliedVote.txid)} alts: ${utils.stringifyReduce(requestObject.alternates)}  acc:${shortKey}`)
                  attemptsRemaining = false


                  if(outerloopCount <= 2){
                    //retry one more time but with out checking down or lost
                    alternateIndex = 0
                    attemptsRemaining = true
                    checkNodeDown = false
                    checkNodeLost = false      
                    this.statemanager_fatal(`repairToMatchReceipt_2`, `ASK FAIL repairToMatchReceipt making attempt #${outerloopCount + 1}   tx:${shortHash}  acc:${shortKey}`)
                    break              
                  } else {
                    this.mainLogger.error(`repairToMatchReceipt FAILED out of attempts #${outerloopCount + 1} tx:${shortHash}  acc:${shortKey}`)
                    this.statemanager_fatal(`repairToMatchReceipt_3`, `ASK FAIL repairToMatchReceipt FAILED out of attempts   tx:${shortHash}  acc:${shortKey}`)
                    return
                  }
                  
                }
                let altId = requestObject.alternates[alternateIndex]
                let nodeShardInfo: NodeShardData = this.stateManager.currentCycleShardData.nodeShardDataMap.get(altId)
                if (nodeShardInfo != null) {
                  node = nodeShardInfo.node
                  this.mainLogger.error(`shrd_repairToMatchReceipt got alt source node: idx:${alternateIndex} txid: ${utils.stringifyReduce(requestObject.appliedVote.txid)} alts: ${utils.stringifyReduce(node.id)}  acc:${shortKey}`)
                } else {
                  this.mainLogger.error(`shrd_repairToMatchReceipt nodeShardInfo == null for ${utils.stringifyReduce(altId)}  tx:${shortHash}  acc:${shortKey}`)
                }
                alternateIndex++
              }

              if(node == null){
                this.statemanager_fatal(`repairToMatchReceipt_4`, `ASK FAIL repairToMatchReceipt node == null in list. #${outerloopCount + 1}  tx:${shortHash}  acc:${shortKey}`)
                node = null
                break
              }

              let relationString = '' //ShardFunctions.getNodeRelation(homeNodeShardData, this.stateManager.currentCycleShardData.ourNode.id)
              if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_repairToMatchReceipt_ask', `${shortHash}`, `r:${relationString}   asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} AccountsMissing:${utils.stringifyReduce(allKeys)}  acc:${shortKey}`)

              if(outerloopCount < 2){
                // Node Precheck!
                if (this.stateManager.isNodeValidForInternalMessage(node.id, 'repairToMatchReceipt', checkNodeDown, checkNodeLost) === false) {
                  // if(this.tryNextDataSourceNode('repairToMatchReceipt') == false){
                  //   break
                  // }
                  node = null
                  continue
                }
              }

              let message = { key: requestObject.accountId, hash: requestObject.accountHash, txid: queueEntry.acceptedTx.id, timestamp: queueEntry.acceptedTx.timestamp }
              let result: RequestStateForTxResp = await this.p2p.ask(node, 'request_state_for_tx_post', message) // not sure if we should await this.

              if (result == null) {
                if (this.verboseLogs) {
                  this.mainLogger.error(`ASK FAIL repairToMatchReceipt request_state_for_tx_post result == null tx:${shortHash}  acc:${shortKey}`)
                }
                // We shuffle the array of votes each time so hopefully will ask another node next time
                // TODO more robust limits to this process, maybe a delay?
                this.mainLogger.error(`ASK FAIL repairToMatchReceipt request_state_for_tx_post no reponse from ${utils.stringifyReduce(node.id)}  tx:${shortHash}  acc:${shortKey}`)
                //this.fatalLogger.fatal(`ASK FAIL repairToMatchReceipt missing logic to ask a new node! 1 ${utils.stringifyReduce(node.id)}`)
                node = null
                continue
              }

              if (result.success !== true) {
                this.mainLogger.error(`ASK FAIL repairToMatchReceipt result.success === ${result.success}   tx:${shortHash}  acc:${shortKey}`)
                //this.fatalLogger.fatal(`ASK FAIL repairToMatchReceipt missing logic to ask a new node! 2 ${utils.stringifyReduce(node.id)}`)
                node = null
                continue
              }

              let dataCountReturned = 0
              let accountIdsReturned = []
              for (let data of result.stateList) {

                // let shortKey = utils.stringifyReduce(data.accountId)

                if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `write data: ${utils.stringifyReduce(data)}  acc:${shortKey}`)
                //Commit the data
                let dataToSet = [data]
                let failedHashes = await this.stateManager.checkAndSetAccountData(dataToSet, `tx:${shortHash} repairToMatchReceipt`, false)
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
                  this.mainLogger.error(`repairToMatchReceipt: statsDataSummaryUpdate2 beforeData: had to query for data 1 ${utils.stringifyReduce(data.accountId)}  tx:${shortHash}  acc:${shortKey}`)
                  if (beforeData == null) {
                    this.mainLogger.error(`repairToMatchReceipt: statsDataSummaryUpdate2 beforeData: had to query for data 1 not found ${utils.stringifyReduce(data.accountId)}  tx:${shortHash}  acc:${shortKey}`)
                  }
                }
                if (beforeData == null) {
                  this.mainLogger.error(`repairToMatchReceipt: statsDataSummaryUpdate2 beforeData data is null ${utils.stringifyReduce(data.accountId)} WILL CAUSE DATA OOS  tx:${shortHash}  acc:${shortKey}`)
                } else {
                  if (this.stateManager.partitionStats.hasAccountBeenSeenByStats(data.accountId) === false) {
                    // Init stats because we have not seen this account yet.
                    this.stateManager.partitionStats.statsDataSummaryInitRaw(queueEntry.cycleToRecordOn, data.accountId, beforeData)
                  }

                  // important to update the timestamp.  There are various reasons it could be incorrectly set to 0
                  let { timestamp: updatedTimestamp, hash: updatedHash } = this.app.getTimestampAndHashFromAccount(data.data)
                  if (data.timestamp != updatedTimestamp) {
                    this.mainLogger.error(`repairToMatchReceipt: statsDataSummaryUpdate2 timstamp had to be corrected from ${data.timestamp} to ${updatedTimestamp}   tx:${shortHash}  acc:${shortKey}`)
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
                  
                  let isGlobal = this.stateManager.accountGlobals.isGlobalAccount(data.accountId)
                  let test3 = false
                  if (isGlobal) {
                    if (oldhash === updatedHash) {
                      updateStateTable = false
                      test3 = true
                    }
                  }

                  let test4 = false
                  if(isGlobal === false){
                    let hash = this.stateManager.accountCache.getAccountHash(data.accountId)
                    test4 = hash.h === updatedHash
                  }

                  if (updateStateTable === true) {
                    await this.storage.addAccountStates(stateTableResults)
                  }
                  this.mainLogger.debug(`repairToMatchReceipt: addAccountStates tx:${shortHash} neededUpdate:${hashNeededUpdate} updateStateTable:${updateStateTable} timeStampMatches:${timeStampMatches} test2:${test2} test3:${test3} test4:${test4} ${utils.stringifyReduce(stateTableResults)}  acc:${shortKey}`)
                }
              }

              // if (queueEntry.hasAll === true) {
              //   queueEntry.logstate = 'got all missing data'
              // } else {
              //   queueEntry.logstate = 'failed to get data:' + queueEntry.hasAll
              //   // queueEntry.state = 'failed to get data'
              // }

              if (this.logger.playbackLogEnabled) this.logger.playbackLogNote('shrd_repairToMatchReceipt_result', `${shortHash}`, `r:${relationString}   result:${queueEntry.logstate} dataCount:${dataCountReturned} asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID}  AccountsMissing:${utils.stringifyReduce(allKeys)} AccountsReturned:${utils.stringifyReduce(accountIdsReturned)}`)
              
              if(outerloopCount > 1){
                this.statemanager_fatal(`repairToMatchReceipt_5ok`, `ASK FAIL repairToMatchReceipt FIX WORKED ${outerloopCount} tx:${shortHash}  acc:${shortKey}`)
              }

              break
              
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
        // next account
      }

      // Set this when data has been repaired.
      queueEntry.repairFinished = true
      this.stateManager.dataRepairsCompleted++ //visible to report
    } finally {
      this.profiler.profileSectionEnd('repair')
    }
  }
}

export default TransactionRepair
