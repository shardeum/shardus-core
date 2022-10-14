import * as Shardus from '../shardus/shardus-types'
import { StateManager as StateManagerTypes } from '@shardus/types'
import * as utils from '../utils'
const stringify = require('fast-stable-stringify')

import Profiler from '../utils/profiler'
import { P2PModuleContext as P2P } from '../p2p/Context'
import Storage from '../storage'
import Crypto from '../crypto'
import Logger, {logFlags} from '../logger'
import ShardFunctions from './shardFunctions'
import { time } from 'console'
import StateManager from '.'
import { json } from 'sequelize/types'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { potentiallyRemoved } from '../p2p/NodeList'
import * as CycleChain from '../p2p/CycleChain'
import { QueueEntry, AppliedVote, AccountHashCache, RequestStateForTxResp, AppliedReceipt, RequestTxResp, RequestReceiptForTxResp, RequestReceiptForTxResp_old } from './state-manager-types'

class TransactionRepairOld {
  app: Shardus.App
  crypto: Crypto
  config: Shardus.StrictServerConfiguration
  profiler: Profiler
  
  logger: Logger
  p2p: P2P
  storage: Storage
  stateManager: StateManager

  mainLogger: any
  fatalLogger: any
  shardLogger: any
  statsLogger: any
  statemanager_fatal: (key: string, log: string) => void

  constructor(stateManager: StateManager,  profiler: Profiler, app: Shardus.App, logger: Logger, storage: Storage, p2p: P2P, crypto: Crypto, config: Shardus.StrictServerConfiguration) {
    
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
      nestedCountersInstance.countEvent('repair1', 'queueEntry.uniqueKeys == null')
      throw new Error('repairToMatchReceipt queueEntry.uniqueKeys == null')
    }

    queueEntry.repairStarted = true
    
    let requestObjectCount = 0
    let requestsMade = 0
    let responseFails = 0
    let dataRecieved = 0
    let dataApplied = 0
    let failedHash = 0
    let numUpToDateAccounts = 0
    let updatedAccountAndHashes = []

    let allKeys = []
    try {
      this.stateManager.dataRepairsStarted++

      this.profiler.profileSectionStart('repair')
      this.profiler.profileSectionStart('repair_init')

      if(queueEntry.didSync){
        nestedCountersInstance.countEvent('repair1', 'init-didSync')
      } else {
        nestedCountersInstance.countEvent('repair1', 'init-normal')
      }

      let shortHash = queueEntry.logID
      // Need to build a list of what accounts we need, what state they should be in and who to get them from
      let requestObjects: { [id: string]: { appliedVote: AppliedVote; voteIndex: number; accountHash: string; accountId: string; nodeShardInfo: StateManagerTypes.shardFunctionTypes.NodeShardData; alternates: string[] } } = {}
      let appliedVotes = queueEntry.appliedReceiptForRepair.appliedVotes

      //shuffle the array
      utils.shuffleArray(appliedVotes)



      if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `appliedVotes ${utils.stringifyReduce(appliedVotes)}  `)
      if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `queueEntry.uniqueKeys ${utils.stringifyReduce(queueEntry.uniqueKeys)}`)

      if (logFlags.debug) this.mainLogger.debug(`repairToMatchReceipt: ${shortHash} queueEntry.uniqueKeys ${utils.stringifyReduce(queueEntry.uniqueKeys)}`)

      // Build a request object for each key involved.
      // once we have a valid request object add in alternate nodes we could use as a backup

      let upToDateAccounts: { [id: string]: boolean }  = {}

      this.profiler.profileSectionEnd('repair_init')

      // STEP 1
      // Build a list of request objects
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
                  numUpToDateAccounts++
                  if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `account ${shortKey} already up to date our: cached:${utils.stringifyReduce(hashObj)}`)
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
                if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `appliedVote.node_id != this.stateManager.currentCycleShardData.ourNode.id ${utils.stringifyReduce(appliedVote.node_id)} our: ${utils.stringifyReduce(this.stateManager.currentCycleShardData.ourNode.id)} acc:${shortKey}`)
                continue
              }
              if (this.stateManager.currentCycleShardData.nodeShardDataMap.has(appliedVote.node_id) === false) {
                if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `this.stateManager.currentCycleShardData.nodeShardDataMap.has(appliedVote.node_id) === false ${utils.stringifyReduce(appliedVote.node_id)}  acc:${shortKey}`)
                continue
              }
              let nodeShardInfo: StateManagerTypes.shardFunctionTypes.NodeShardData = this.stateManager.currentCycleShardData.nodeShardDataMap.get(appliedVote.node_id)

              if (nodeShardInfo == null) {
                if (logFlags.error) this.mainLogger.error(`shrd_repairToMatchReceipt nodeShardInfo == null ${utils.stringifyReduce(appliedVote.node_id)} tx:${shortHash} acc:${shortKey}`)
                if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `nodeShardInfo == null ${utils.stringifyReduce(appliedVote.node_id)}  acc:${shortKey}`)
                continue
              }
              // if the account is not global check if it is in range.
              if (isGlobal === false && ShardFunctions.testAddressInRange(id, nodeShardInfo.storedPartitions) == false) {
                if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `address not in range ${utils.stringifyReduce(nodeShardInfo.storedPartitions)}  acc:${shortKey}`)
                continue
              }
              let objectToSet = { appliedVote, voteIndex: j, accountHash: hash, accountId: id, nodeShardInfo, alternates: [] }
              if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `setting key ${utils.stringifyReduce(key)} ${utils.stringifyReduce(objectToSet)}  acc:${shortKey}`)
              requestObjects[key] = objectToSet
              allKeys.push(key)
              requestObjectCount++
            } else {
            }
          }
        }

        if (coveredKey === false) {
          if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `coveredKey === false  acc:${shortKey}`)
          //todo log error on us not finding this key
        }
      }

      if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_start', `${shortHash}`, `qId: ${queueEntry.entryID} AccountsMissing:${utils.stringifyReduce(allKeys)}  requestObject:${utils.stringifyReduce(requestObjects)}`)

      // STEP 2
      // repair each unique key, if needed by asking an appropirate node for account state
      for (let key of queueEntry.uniqueKeys) {
        let shortKey = utils.stringifyReduce(key)
        if (requestObjects[key] != null) {
          let requestObject = requestObjects[key]

          if (requestObject == null) {
            if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `requestObject == null  acc:${shortKey}`)
            continue
          }

          let node = requestObject.nodeShardInfo.node
          if (node == null) {
            if (logFlags.error) this.mainLogger.error(`shrd_repairToMatchReceipt node == null ${utils.stringifyReduce(requestObject.accountId)}`)
            if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `node == null  acc:${shortKey}`)
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
              //if node == null, find a node to request data from. go down alternates list as needed.
              while (node == null) {
                //possibly make this not at an error once verified
                if (logFlags.error) this.mainLogger.error(`shrd_repairToMatchReceipt while(node == null) look for other node txId. idx:${alternateIndex} txid: ${utils.stringifyReduce(requestObject.appliedVote.txid)} alts: ${utils.stringifyReduce(requestObject.alternates)}  acc:${shortKey}`)
                //find alternate
                if (alternateIndex >= requestObject.alternates.length) {
                  this.statemanager_fatal(`repairToMatchReceipt_1`, `ASK FAIL repairToMatchReceipt failed to find alternate node to ask for receipt data. txId. ${utils.stringifyReduce(requestObject.appliedVote.txid)} alts: ${utils.stringifyReduce(requestObject.alternates)}  acc:${shortKey}`)
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
                    if (logFlags.error) this.mainLogger.error(`repairToMatchReceipt FAILED out of attempts #${outerloopCount + 1} tx:${shortHash}  acc:${shortKey}`)
                    this.statemanager_fatal(`repairToMatchReceipt_3`, `ASK FAIL repairToMatchReceipt FAILED out of attempts   tx:${shortHash}  acc:${shortKey}`)
                    return
                  }
                  
                }
                let altId = requestObject.alternates[alternateIndex]
                let nodeShardInfo: StateManagerTypes.shardFunctionTypes.NodeShardData = this.stateManager.currentCycleShardData.nodeShardDataMap.get(altId)
                if (nodeShardInfo != null) {
                  node = nodeShardInfo.node
                  if (logFlags.error) this.mainLogger.error(`shrd_repairToMatchReceipt got alt source node: idx:${alternateIndex} txid: ${utils.stringifyReduce(requestObject.appliedVote.txid)} alts: ${utils.stringifyReduce(node.id)}  acc:${shortKey}`)
                } else {
                  if (logFlags.error) this.mainLogger.error(`shrd_repairToMatchReceipt nodeShardInfo == null for ${utils.stringifyReduce(altId)}  tx:${shortHash}  acc:${shortKey}`)
                }
                alternateIndex++
              }

              if(node == null){
                this.statemanager_fatal(`repairToMatchReceipt_4`, `ASK FAIL repairToMatchReceipt node == null in list. #${outerloopCount + 1}  tx:${shortHash}  acc:${shortKey}`)
                node = null
                break
              }

              let relationString = '' //ShardFunctions.getNodeRelation(homeNodeShardData, this.stateManager.currentCycleShardData.ourNode.id)
              if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_ask', `${shortHash}`, `r:${relationString}   asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} AccountsMissing:${utils.stringifyReduce(allKeys)}  acc:${shortKey}`)

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

              // if our data is already good no need to ask for it again
              if (this.stateManager.accountCache.hasAccount(requestObject.accountId)) {
                let accountMemData: AccountHashCache = this.stateManager.accountCache.getAccountHash(requestObject.accountId)
                if (accountMemData.h === requestObject.accountHash) {
                  if (logFlags.error) this.mainLogger.error(`Fix Worked: repairToMatchReceipt. already have latest ${utils.makeShortHash(requestObject.accountId)} cache:${utils.stringifyReduce(accountMemData)}`)
                  attemptsRemaining = false
                  continue
                }
              }

              let result: RequestStateForTxResp
              try{
                this.profiler.profileSectionStart('repair_asking_for_data')
                nestedCountersInstance.countEvent('repair1', 'asking')
              
                requestsMade++
                let message = { key: requestObject.accountId, hash: requestObject.accountHash, txid: queueEntry.acceptedTx.txId, timestamp: queueEntry.acceptedTx.timestamp }
                result = await this.p2p.ask(node, 'request_state_for_tx_post', message) // not sure if we should await this.

                if (result == null) {
                  if (logFlags.verbose) {
                    if (logFlags.error) this.mainLogger.error(`ASK FAIL repairToMatchReceipt request_state_for_tx_post result == null tx:${shortHash}  acc:${shortKey}`)
                  }
                  // We shuffle the array of votes each time so hopefully will ask another node next time
                  // TODO more robust limits to this process, maybe a delay?
                  if (logFlags.error) this.mainLogger.error(`ASK FAIL repairToMatchReceipt request_state_for_tx_post no reponse from ${utils.stringifyReduce(node.id)}  tx:${shortHash}  acc:${shortKey}`)
                  //this.fatalLogger.fatal(`ASK FAIL repairToMatchReceipt missing logic to ask a new node! 1 ${utils.stringifyReduce(node.id)}`)
                  node = null
                  responseFails++
                  continue
                }

                if (result.success !== true) {
                  if (logFlags.error) this.mainLogger.error(`ASK FAIL repairToMatchReceipt result.success === ${result.success}   tx:${shortHash}  acc:${shortKey}`)
                  //this.fatalLogger.fatal(`ASK FAIL repairToMatchReceipt missing logic to ask a new node! 2 ${utils.stringifyReduce(node.id)}`)
                  node = null
                  responseFails++
                  continue
                }
              } finally{
                this.profiler.profileSectionEnd('repair_asking_for_data')
              }
              let dataCountReturned = 0
              let accountIdsReturned = []
              for (let data of result.stateList) {
                try{
                  dataRecieved++
                  this.profiler.profileSectionStart('repair_saving_account_data')
                  nestedCountersInstance.countEvent('repair1', 'saving')
                  // let shortKey = utils.stringifyReduce(data.accountId)

                  //cycleToRecordOn = this.stateManager.getCycleNumberFromTimestamp(timestamp)

                  if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `write data: ${utils.stringifyReduce(data)}  acc:${shortKey}`)
                  //Commit the data
                  let dataToSet = [data]
                  let failedHashes = await this.stateManager.checkAndSetAccountData(dataToSet, `tx:${shortHash} repairToMatchReceipt`, true)

                  if(failedHashes.length === 0){
                    dataApplied++
                    nestedCountersInstance.countEvent('repair1', `q.repair applied cycle: ${this.stateManager.currentCycleShardData.cycleNumber}`)
                  } else {
                    failedHash++
                    this.statemanager_fatal(`repairToMatchReceipt_failedhash`, ` tx:${shortHash}  failed:${failedHashes[0]} acc:${shortKey}`)
                  }

                  nestedCountersInstance.countEvent('repair1', 'writeCombinedAccountDataToBackups')
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
                    nestedCountersInstance.countEvent('repair1', 'getAccountDataByList')
                    let results = await this.app.getAccountDataByList([data.accountId])
                    beforeData = results[0]
                    if (logFlags.error) this.mainLogger.error(`repairToMatchReceipt: statsDataSummaryUpdate2 beforeData: had to query for data 1 ${utils.stringifyReduce(data.accountId)}  tx:${shortHash}  acc:${shortKey}`)
                    if (beforeData == null) {
                      if (logFlags.error) this.mainLogger.error(`repairToMatchReceipt: statsDataSummaryUpdate2 beforeData: had to query for data 1 not found ${utils.stringifyReduce(data.accountId)}  tx:${shortHash}  acc:${shortKey}`)
                    }
                  }
                  if (beforeData == null) {
                    if (logFlags.error) this.mainLogger.error(`repairToMatchReceipt: statsDataSummaryUpdate2 beforeData data is null ${utils.stringifyReduce(data.accountId)} WILL CAUSE DATA OOS  tx:${shortHash}  acc:${shortKey}`)
                  } else {

                    // USEDEFAULT=checkAndSetAccountData for stats. use the default behavoir of checkAndSetAccountData instead since that used the local before data, and is better for stat deltas
                    // state table repairs needed the state exactly before repair state, which would create a different delta.

                    // if (this.stateManager.partitionStats.hasAccountBeenSeenByStats(data.accountId) === false) {
                    //   // Init stats because we have not seen this account yet.
                    //   this.stateManager.partitionStats.statsDataSummaryInitRaw(queueEntry.cycleToRecordOn, data.accountId, beforeData, 'repairToMatchReceipt')
                    // }

                    // important to update the timestamp.  There are various reasons it could be incorrectly set to 0
                    let { timestamp: updatedTimestamp, hash: updatedHash } = this.app.getTimestampAndHashFromAccount(data.data)
                    if (data.timestamp != updatedTimestamp) {
                      if (logFlags.error) this.mainLogger.error(`repairToMatchReceipt: statsDataSummaryUpdate2 timstamp had to be corrected from ${data.timestamp} to ${updatedTimestamp}   tx:${shortHash}  acc:${shortKey} hash:${utils.stringifyReduce(updatedHash)} `)
                    }
                    // This is correcting the timestamp on the wrapper
                    data.timestamp = updatedTimestamp
                    

                    // USEDEFAULT=checkAndSetAccountData for stats.  (search USEDEFAULT for more context)
                    // this.stateManager.partitionStats.statsDataSummaryUpdate2(queueEntry.cycleToRecordOn, beforeData, data, 'repairToMatchReceipt')

                    // record state table data
                    let { timestamp: oldtimestamp, hash: oldhash } = this.app.getTimestampAndHashFromAccount(beforeData)

                    let hashNeededUpdate = oldhash !== result.beforeHashes[data.accountId]
                    oldhash = result.beforeHashes[data.accountId]

                    let stateTableResults: Shardus.StateTableObject = {
                      accountId: data.accountId,
                      txId: queueEntry.acceptedTx.txId,
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
                    let branch4 = -1
                    if(isGlobal === false){
                      let hash = this.stateManager.accountCache.getAccountHash(data.accountId)

                      if(hash != null){
                        test4 = hash.h === updatedHash    
                        branch4 = 1
                      } else {
                        branch4 = 0
                      }
                    }

                    if (updateStateTable === true) {
                      nestedCountersInstance.countEvent('repair1', 'addAccountStates')
                      await this.storage.addAccountStates(stateTableResults)
                    }

                    //update hash
                    data.stateId = updatedHash

                    updatedAccountAndHashes.push({accountID: data.accountId, hash: data.stateId})

                    /*if (logFlags.debug)*/ this.mainLogger.debug(`repairToMatchReceipt: addAccountStates tx:${shortHash} neededUpdate:${hashNeededUpdate} updateStateTable:${updateStateTable} timeStampMatches:${timeStampMatches} test2:${test2} test3:${test3} test4:${test4} branch4:${branch4} ${utils.stringifyReduce(stateTableResults)} acc:${shortKey}`)
                  }

                } finally {
                  this.profiler.profileSectionEnd('repair_saving_account_data')
                }
              }

              if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_result', `${shortHash}`, `r:${relationString}   result:${queueEntry.logstate} dataCount:${dataCountReturned} asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID}  AccountsMissing:${utils.stringifyReduce(allKeys)} AccountsReturned:${utils.stringifyReduce(accountIdsReturned)}`)
              
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
      this.stateManager.cycleDebugNotes.repairs++ //per cycle debug info

      if(this.stateManager.currentCycleShardData.cycleNumber != queueEntry.cycleToRecordOn){
        this.stateManager.cycleDebugNotes.lateRepairs++ //per cycle debug info
      }

    } finally {

      if(queueEntry.repairFinished === true){
        queueEntry.hasValidFinalData = true

        let repairLogString = `tx:${queueEntry.logID} updatedAccountAndHashes:${utils.stringifyReduce(updatedAccountAndHashes)} counters:${utils.stringifyReduce({ requestObjectCount,requestsMade,responseFails,dataRecieved,dataApplied,failedHash, numUpToDateAccounts})}`
        if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_success', queueEntry.logID, repairLogString)
        this.mainLogger.debug('shrd_repairToMatchReceipt_success ' + repairLogString)
        nestedCountersInstance.countEvent('repair1', 'success')

      } else {
        queueEntry.repairFailed = true
        this.statemanager_fatal(`repairToMatchReceipt_failed`, `tx:${queueEntry.logID} counters:${utils.stringifyReduce({requestObjectCount,requestsMade,responseFails,dataRecieved,dataApplied,failedHash})}  keys ${utils.stringifyReduce(allKeys)}  `)        
        nestedCountersInstance.countEvent('repair1', 'failed')
      }

      this.profiler.profileSectionEnd('repair')
    }
  }


  // can the repair work if just have the receipt
  async repairToMatchReceiptWithoutQueueEntry(receipt: AppliedReceipt, refAccountId:string) : Promise<boolean> {
    if (this.stateManager.currentCycleShardData == null) {
      return false
    }

    let txID = receipt.txid
    let uniqueKeys = []
    let timestamp = 0
    let cycleToRecordOn = 0

    let repairFinished = false

    let missingTXFound = 0
    let requestObjectCount = 0
    let requestsMade = 0
    let responseFails = 0
    let dataRecieved = 0
    let dataApplied = 0
    let failedHash = 0
    let needUpdateAccounts: { [id: string]: boolean }  = {}
    let upToDateAccounts: { [id: string]: boolean }  = {}
    let updatedAccounts: { [id: string]: boolean }  = {}

    let updatedAccountAndHashes = []

    let shortHash = utils.makeShortHash(txID)
    let allKeys
    try {
      nestedCountersInstance.countEvent('repair2', `init`)

      // STEP 0: need to find the TX
      let txRequestResult = await this.requestMissingTX(txID, refAccountId)
      if(txRequestResult == null || txRequestResult.success != true){
        nestedCountersInstance.countEvent('repair2', `txRequestResult.success == ${txRequestResult?.success}`)
        this.statemanager_fatal(`repairToMatchReceipt2_a`, `ASK FAIL requestMissingTX   tx:${shortHash} result:${utils.stringifyReduce(txRequestResult)} `)
        return false
      }
      timestamp = txRequestResult.acceptedTX.timestamp

      const {keys :keysResponse} = this.app.crack(txRequestResult.acceptedTX.data, txRequestResult.acceptedTX.appData)
      allKeys = keysResponse.allKeys
      //cycleToRecordOn = this.stateManager.getCycleNumberFromTimestamp(timestamp)
      cycleToRecordOn = CycleChain.getCycleNumberFromTimestamp(timestamp)

      let originalData = txRequestResult.originalData

      missingTXFound++

      let keyMap = {}
      for (let key of allKeys) {
        //filter only keys that we cover up here.
        let isStored = ShardFunctions.testAddressInRange(key, this.stateManager.currentCycleShardData.nodeShardData.storedPartitions)
        if(isStored != true){
          // continue
          nestedCountersInstance.countEvent('repair2', `non stored key?`)
        }

        keyMap[key] = true
      }
      uniqueKeys = Object.keys(keyMap)
      
      // if(uniqueKeys.length === 0){

      //   this.statemanager_fatal('ABORT no covered keys', `ABORT no covered keys  ${utils.stringifyReduce(allKeys)} tx:${shortHash} ${utils.stringifyReduce(this.stateManager.currentCycleShardData.nodeShardData.storedPartitions)} cycle:${this.stateManager.currentCycleShardData.cycleNumber}`)
      //   nestedCountersInstance.countEvent('repair2', `ABORT no covered keys  ${utils.stringifyReduce(allKeys)} tx:${shortHash} ${utils.stringifyReduce(this.stateManager.currentCycleShardData.nodeShardData.storedPartitions)} cycle:${this.stateManager.currentCycleShardData.cycleNumber}`)
      //   if (logFlags.error) this.mainLogger.error(`shrd_repairToMatchReceipt2: ABORT no covered keys ${utils.stringifyReduce(allKeys)} tx:${shortHash} `)
      //   if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_noKeys', `${shortHash}`, `ABORT no covered keys  ${utils.stringifyReduce(allKeys)} tx:${shortHash} `)

      //   // hack?  pick all the keys
      //   for (let key of allKeys) {
      //     keyMap[key] = true
      //   }
      //   uniqueKeys = Object.keys(keyMap)
      //   //return false
      // }

      this.stateManager.dataRepairsStarted++
      this.profiler.profileSectionStart('repair2')

      // Need to build a list of what accounts we need, what state they should be in and who to get them from
      let requestObjects: { [id: string]: { appliedVote: AppliedVote; voteIndex: number; accountHash: string; accountId: string; nodeShardInfo: StateManagerTypes.shardFunctionTypes.NodeShardData; alternates: string[] } } = {}
      let appliedVotes = receipt.appliedVotes

      //shuffle the array
      utils.shuffleArray(appliedVotes)

      if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note2', `${shortHash}`, `appliedVotes ${utils.stringifyReduce(appliedVotes)}  `)
      if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note2', `${shortHash}`, `queueEntry.uniqueKeys ${utils.stringifyReduce(uniqueKeys)}`)

      if (logFlags.debug) this.mainLogger.debug(`repairToMatchReceipt2: ${shortHash} queueEntry.uniqueKeys ${utils.stringifyReduce(uniqueKeys)} ${utils.stringifyReduce(txRequestResult)}`)

      // Build a request object for each key involved.
      // once we have a valid request object add in alternate nodes we could use as a backup


      //let numUpToDateAccounts = 0

      // STEP 1: build a list of request objects
      for (let key of uniqueKeys) {
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
                  //numUpToDateAccounts++
                  if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note2', `${shortHash}`, `account ${shortKey} already up to date our: cached:${utils.stringifyReduce(hashObj)}`)

                  //update cache state.


                  break
                } else {
                  needUpdateAccounts[id] = true
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
                if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note2', `${shortHash}`, `appliedVote.node_id != this.stateManager.currentCycleShardData.ourNode.id ${utils.stringifyReduce(appliedVote.node_id)} our: ${utils.stringifyReduce(this.stateManager.currentCycleShardData.ourNode.id)} acc:${shortKey}`)
                continue
              }
              if (this.stateManager.currentCycleShardData.nodeShardDataMap.has(appliedVote.node_id) === false) {
                if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note2', `${shortHash}`, `this.stateManager.currentCycleShardData.nodeShardDataMap.has(appliedVote.node_id) === false ${utils.stringifyReduce(appliedVote.node_id)}  acc:${shortKey}`)
                continue
              }
              let nodeShardInfo: StateManagerTypes.shardFunctionTypes.NodeShardData = this.stateManager.currentCycleShardData.nodeShardDataMap.get(appliedVote.node_id)

              if (nodeShardInfo == null) {
                if (logFlags.error) this.mainLogger.error(`shrd_repairToMatchReceipt2 nodeShardInfo == null ${utils.stringifyReduce(appliedVote.node_id)} tx:${shortHash} acc:${shortKey}`)
                if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note2', `${shortHash}`, `nodeShardInfo == null ${utils.stringifyReduce(appliedVote.node_id)}  acc:${shortKey}`)
                continue
              }
              // if the account is not global check if it is in range.
              if (isGlobal === false && ShardFunctions.testAddressInRange(id, nodeShardInfo.storedPartitions) == false) {
                if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note2', `${shortHash}`, `address not in range ${utils.stringifyReduce(nodeShardInfo.storedPartitions)}  acc:${shortKey}`)
                //continue
                nestedCountersInstance.countEvent('repair2', `dont skip account for repair..`)

              }
              let objectToSet = { appliedVote, voteIndex: j, accountHash: hash, accountId: id, nodeShardInfo, alternates: [] }
              if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note2', `${shortHash}`, `setting key ${utils.stringifyReduce(key)} ${utils.stringifyReduce(objectToSet)}  acc:${shortKey}`)
              requestObjects[key] = objectToSet
              requestObjectCount++
              allKeys.push(key)
            } else {
            }
          }
        }

        if (coveredKey === false) {
          if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note2', `${shortHash}`, `coveredKey === false  acc:${shortKey}`)
          //todo log error on us not finding this key
        }
      }

      if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_start2', `${shortHash}`, ` AccountsMissing:${utils.stringifyReduce(allKeys)}  requestObject:${utils.stringifyReduce(requestObjects)}`)

      if(requestObjectCount === 0){
        nestedCountersInstance.countEvent('repair2', `ABORT no covered keys  ${utils.stringifyReduce(allKeys)} tx:${shortHash} cycle:${this.stateManager.currentCycleShardData.cycleNumber}`)
      }


      // STEP 2: repear account if needed
      for (let key of uniqueKeys) {
        let shortKey = utils.stringifyReduce(key)
        if (requestObjects[key] != null) {
          let requestObject = requestObjects[key]

          if (requestObject == null) {
            if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note2', `${shortHash}`, `requestObject == null  acc:${shortKey}`)
            continue
          }

          let node = requestObject.nodeShardInfo.node
          if (node == null) {
            if (logFlags.error) this.mainLogger.error(`shrd_repairToMatchReceipt2 node == null ${utils.stringifyReduce(requestObject.accountId)}`)
            if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note2', `${shortHash}`, `node == null  acc:${shortKey}`)
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
                if (logFlags.error) this.mainLogger.error(`shrd_repairToMatchReceipt2 while(node == null) look for other node txId. idx:${alternateIndex} txid: ${utils.stringifyReduce(requestObject.appliedVote.txid)} alts: ${utils.stringifyReduce(requestObject.alternates)}  acc:${shortKey}`)
                //find alternate
                if (alternateIndex >= requestObject.alternates.length) {
                  this.statemanager_fatal(`repairToMatchReceipt2_1`, `ASK FAIL repairToMatchReceipt failed to find alternate node to ask for receipt data. txId. ${utils.stringifyReduce(requestObject.appliedVote.txid)} alts: ${utils.stringifyReduce(requestObject.alternates)}  acc:${shortKey}`)
                  attemptsRemaining = false


                  if(outerloopCount <= 2){
                    //retry one more time but with out checking down or lost
                    alternateIndex = 0
                    attemptsRemaining = true
                    checkNodeDown = false
                    checkNodeLost = false      
                    this.statemanager_fatal(`repairToMatchReceipt2_2`, `ASK FAIL repairToMatchReceipt making attempt #${outerloopCount + 1}   tx:${shortHash}  acc:${shortKey}`)
                    break              
                  } else {
                    if (logFlags.error) this.mainLogger.error(`repairToMatchReceipt2 FAILED out of attempts #${outerloopCount + 1} tx:${shortHash}  acc:${shortKey}`)
                    this.statemanager_fatal(`repairToMatchReceipt2_3`, `ASK FAIL repairToMatchReceipt FAILED out of attempts   tx:${shortHash}  acc:${shortKey}`)
                    return false
                  }
                  
                }
                let altId = requestObject.alternates[alternateIndex]
                let nodeShardInfo: StateManagerTypes.shardFunctionTypes.NodeShardData = this.stateManager.currentCycleShardData.nodeShardDataMap.get(altId)
                if (nodeShardInfo != null) {
                  node = nodeShardInfo.node
                  if (logFlags.error) this.mainLogger.error(`shrd_repairToMatchReceipt2 got alt source node: idx:${alternateIndex} txid: ${utils.stringifyReduce(requestObject.appliedVote.txid)} alts: ${utils.stringifyReduce(node.id)}  acc:${shortKey}`)
                } else {
                  if (logFlags.error) this.mainLogger.error(`shrd_repairToMatchReceipt2 nodeShardInfo == null for ${utils.stringifyReduce(altId)}  tx:${shortHash}  acc:${shortKey}`)
                }
                alternateIndex++
              }

              if(node == null){
                this.statemanager_fatal(`repairToMatchReceipt2_4`, `ASK FAIL repairToMatchReceipt node == null in list. #${outerloopCount + 1}  tx:${shortHash}  acc:${shortKey}`)
                node = null
                break
              }

              let relationString = '' //ShardFunctions.getNodeRelation(homeNodeShardData, this.stateManager.currentCycleShardData.ourNode.id)
              if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt2_ask', `${shortHash}`, `r:${relationString}   asking: ${utils.makeShortHash(node.id)} AccountsMissing:${utils.stringifyReduce(allKeys)}  acc:${shortKey}`)

              if(outerloopCount < 2){
                // Node Precheck!
                if (this.stateManager.isNodeValidForInternalMessage(node.id, 'repairToMatchReceipt2', checkNodeDown, checkNodeLost) === false) {
                  // if(this.tryNextDataSourceNode('repairToMatchReceipt') == false){
                  //   break
                  // }
                  node = null
                  continue
                }
              }

              // if our data is already good no need to ask for it again
              if (this.stateManager.accountCache.hasAccount(requestObject.accountId)) {
                let accountMemData: AccountHashCache = this.stateManager.accountCache.getAccountHash(requestObject.accountId)
                if (accountMemData.h === requestObject.accountHash) {
                  if (logFlags.error) this.mainLogger.error(`Fix Worked: repairToMatchReceipt2. already have latest ${utils.makeShortHash(requestObject.accountId)} cache:${utils.stringifyReduce(accountMemData)}`)
                  attemptsRemaining = false
                  continue
                }
              }

              requestsMade++
              let message = { key: requestObject.accountId, hash: requestObject.accountHash, txid: txID, timestamp: timestamp }
              let result: RequestStateForTxResp = await this.p2p.ask(node, 'request_state_for_tx_post', message) // not sure if we should await this.

              if (result == null) {
                if (logFlags.verbose) {
                  if (logFlags.error) this.mainLogger.error(`ASK FAIL repairToMatchReceipt2 request_state_for_tx_post result == null tx:${shortHash}  acc:${shortKey}`)
                }
                // We shuffle the array of votes each time so hopefully will ask another node next time
                // TODO more robust limits to this process, maybe a delay?
                if (logFlags.error) this.mainLogger.error(`ASK FAIL repairToMatchReceipt2 request_state_for_tx_post no reponse from ${utils.stringifyReduce(node.id)}  tx:${shortHash}  acc:${shortKey}`)
                //this.fatalLogger.fatal(`ASK FAIL repairToMatchReceipt missing logic to ask a new node! 1 ${utils.stringifyReduce(node.id)}`)
                node = null
                responseFails++
                continue
              }

              if (result.success !== true) {
                if (logFlags.error) this.mainLogger.error(`ASK FAIL repairToMatchReceipt2 result.success === ${result.success}   tx:${shortHash}  acc:${shortKey}`)
                //this.fatalLogger.fatal(`ASK FAIL repairToMatchReceipt missing logic to ask a new node! 2 ${utils.stringifyReduce(node.id)}`)
                node = null
                responseFails++
                continue
              }

              let dataCountReturned = 0
              let accountIdsReturned = []
              for (let data of result.stateList) {

                if(updatedAccounts[data.accountId]){
                  //already updated so skip
                  continue
                }

                // let shortKey = utils.stringifyReduce(data.accountId)
                dataRecieved++

                if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt2_note', `${shortHash}`, `write data: ${utils.stringifyReduce(data)}  acc:${shortKey}`)
                //Commit the data
                let dataToSet = [data]
                let failedHashes = await this.stateManager.checkAndSetAccountData(dataToSet, `tx:${shortHash} repairToMatchReceipt2`, false)

                if(failedHashes.length === 0){
                  dataApplied++
                  updatedAccounts[data.accountId] = true
                } else {
                  failedHash++
                  this.statemanager_fatal(`repairToMatchReceipt_failedhash`, ` tx:${shortHash}  failed:${failedHashes[0]} acc:${shortKey}`)
                }

                await this.stateManager.writeCombinedAccountDataToBackups(dataToSet, failedHashes)
                attemptsRemaining = false
                //update global cache?  that will be obsolete soona anyhow!
                //need to loop and call update
                let beforeData = data.prevDataCopy

                if (beforeData == null) {
                  //prevDataCopy
                  // let wrappedAccountDataBefore = queueEntry.collectedData[data.accountId]
                  // if (wrappedAccountDataBefore != null) {
                  //   beforeData = wrappedAccountDataBefore.data
                  // }

                  let beforeDataString = originalData[data.accountId]
                  if (beforeDataString != null) {
                    beforeData = JSON.parse(beforeDataString)
                    if (logFlags.debug) this.mainLogger.debug(`repairToMatchReceipt2:  got before data tx: ${shortHash} acc: ${utils.stringifyReduce(data.accountId)} data: ${beforeDataString}`)
                  }
                }
                if (beforeData == null) {
                  let results = await this.app.getAccountDataByList([data.accountId])
                  beforeData = results[0]
                  if (logFlags.error) this.mainLogger.error(`repairToMatchReceipt2: statsDataSummaryUpdate2 beforeData: had to query for data 1 ${utils.stringifyReduce(data.accountId)}  tx:${shortHash}  acc:${shortKey}`)
                  if (beforeData == null) {
                    if (logFlags.error) this.mainLogger.error(`repairToMatchReceipt2: statsDataSummaryUpdate2 beforeData: had to query for data 1 not found ${utils.stringifyReduce(data.accountId)}  tx:${shortHash}  acc:${shortKey}`)
                  }
                }
                if (beforeData == null) {
                  if (logFlags.error) this.mainLogger.error(`repairToMatchReceipt2: statsDataSummaryUpdate2 beforeData data is null ${utils.stringifyReduce(data.accountId)} WILL CAUSE DATA OOS  tx:${shortHash}  acc:${shortKey}`)
                } else {
                  // USEDEFAULT=checkAndSetAccountData for stats.  (search USEDEFAULT for more context)
                  // if (this.stateManager.partitionStats.hasAccountBeenSeenByStats(data.accountId) === false) {
                  //   // Init stats because we have not seen this account yet.
                  //   this.stateManager.partitionStats.statsDataSummaryInitRaw(cycleToRecordOn, data.accountId, beforeData, 'repairToMatchReceipt2')
                  // }

                  // important to update the timestamp.  There are various reasons it could be incorrectly set to 0
                  let { timestamp: updatedTimestamp, hash: updatedHash } = this.app.getTimestampAndHashFromAccount(data.data)
                  if (data.timestamp != updatedTimestamp) {
                    if (logFlags.error) this.mainLogger.error(`repairToMatchReceipt2: statsDataSummaryUpdate2 timstamp had to be corrected from ${data.timestamp} to ${updatedTimestamp}   tx:${shortHash}  acc:${shortKey} hash:${utils.stringifyReduce(updatedHash)} `)
                  }
                  // This is correcting the timestamp on the wrapper
                  data.timestamp = updatedTimestamp

                  // USEDEFAULT=checkAndSetAccountData for stats. (search USEDEFAULT for more context)
                  //this.stateManager.partitionStats.statsDataSummaryUpdate2(cycleToRecordOn, beforeData, data, 'repairToMatchReceipt2')

                  // record state table data
                  let { timestamp: oldtimestamp, hash: oldhash } = this.app.getTimestampAndHashFromAccount(beforeData)

                  let hashNeededUpdate = oldhash !== result.beforeHashes[data.accountId]
                  oldhash = result.beforeHashes[data.accountId]

                  let stateTableResults: Shardus.StateTableObject = {
                    accountId: data.accountId,
                    txId: txID,
                    stateBefore: oldhash,
                    stateAfter: updatedHash,
                    txTimestamp: `${updatedTimestamp}`,
                  }

                  let updateStateTable = true
                  let timeStampMatches = updatedTimestamp === timestamp
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

                  //update hash
                  //data.stateId = updatedHash

                  updatedAccountAndHashes.push({accountID: data.accountId, hash: data.stateId})

                  /*if (logFlags.debug)*/ this.mainLogger.debug(`repairToMatchReceipt2: addAccountStates tx:${shortHash} neededUpdate:${hashNeededUpdate} updateStateTable:${updateStateTable} timeStampMatches:${timeStampMatches} test2:${test2} test3:${test3} test4:${test4} ${utils.stringifyReduce(stateTableResults)}  acc:${shortKey}`)
                }
              }

              if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt2_result', `${shortHash}`, `r:${relationString}   result: dataCount:${dataCountReturned} asking: ${utils.makeShortHash(node.id)}   AccountsMissing:${utils.stringifyReduce(allKeys)} AccountsReturned:${utils.stringifyReduce(accountIdsReturned)}`)
              
              if(outerloopCount > 1){
                this.statemanager_fatal(`repairToMatchReceipt2_5ok`, `ASK FAIL repairToMatchReceipt FIX WORKED ${outerloopCount} tx:${shortHash}  acc:${shortKey}`)
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
      //queueEntry.repairFinished = true
      this.stateManager.dataRepairsCompleted++ //visible to report
      //this.stateManager.cycleDebugNotes.repairs++ //per cycle debug info

      //if(this.stateManager.currentCycleShardData.cycleNumber != queueEntry.cycleToRecordOn){
        this.stateManager.cycleDebugNotes.noRcptRepairs++ //per cycle debug info
      //}

      return true
    } finally {

      let neededUpdate = Object.keys(needUpdateAccounts ?? {}).length
      let upToDateCount = Object.keys(upToDateAccounts ?? {}).length
      let updatedAccountsCount = Object.keys(updatedAccounts ?? {}).length
      if(neededUpdate === updatedAccountsCount){
        repairFinished = true
      }

      let skippedKeys = []
      if(updatedAccounts != null){
        for(let key of allKeys){
          if(updatedAccounts[key] != true){
            skippedKeys.push(key)
          }
        }        
      } else {
        skippedKeys = allKeys
      }

      if(Object.keys(skippedKeys).length > 0 && (dataApplied < neededUpdate)){
        this.statemanager_fatal(`repairToMatchReceiptNoRecipt_tempSkippedKeys`, `counters:${utils.stringifyReduce({missingTXFound, requestObjectCount,requestsMade,responseFails,dataRecieved,dataApplied,failedHash,neededUpdate,upToDateCount,updatedAccountsCount})} keys ${utils.stringifyReduce(allKeys)} skipped ${utils.stringifyReduce(skippedKeys)}  `)
      }

      if(repairFinished == false){
        this.statemanager_fatal(`repairToMatchReceiptNoRecipt_failed`, `counters:${utils.stringifyReduce({missingTXFound, requestObjectCount,requestsMade,responseFails,dataRecieved,dataApplied,failedHash,neededUpdate,upToDateCount,updatedAccountsCount})} keys ${utils.stringifyReduce(allKeys)}  skipped ${utils.stringifyReduce(skippedKeys)} `)
        nestedCountersInstance.countEvent('repair2', 'complete-failed')
      } else {
        let repairLogString = `tx:${shortHash} updatedAccountAndHashes:${utils.stringifyReduce(updatedAccountAndHashes )} counters:${utils.stringifyReduce({missingTXFound, requestObjectCount,requestsMade,responseFails,dataRecieved,dataApplied,failedHash,neededUpdate,upToDateCount,updatedAccountsCount})}`
        if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_success2', shortHash, repairLogString) 
        this.mainLogger.debug('shrd_repairToMatchReceipt_success2 ' + repairLogString)

        nestedCountersInstance.countEvent('repair2', `complete-ok`)
        nestedCountersInstance.countEvent('repair2', `s.repair applied cycle: ${this.stateManager.currentCycleShardData.cycleNumber}`)
      }
      
      this.profiler.profileSectionEnd('repair2')
    }
  }


  async requestMissingTX(txID:string, refAccountId:string) : Promise<RequestTxResp | null> {
    if (this.stateManager.currentCycleShardData == null) {
      return null
    }

    let shortID = utils.stringifyReduce(txID)
    if (logFlags.playback) this.logger.playbackLogNote('requestMissingTX_start', txID, ``)

    // will have to just ask node that cover our shard!

    let timestamp = 0

    let queryGroup:Shardus.Node[] = []

    // get nodes for address
    let homeNode = ShardFunctions.findHomeNode(this.stateManager.currentCycleShardData.shardGlobals, refAccountId, this.stateManager.currentCycleShardData.parititionShardDataMap)
    queryGroup = homeNode.nodeThatStoreOurParitionFull.slice()  

    // technically could look at all the keys from a reciept and build a larger list.
    // queryGroup = [...this.stateManager.currentCycleShardData.nodeShardData.nodeThatStoreOurParition]



    this.stateManager.debugNodeGroup(txID, timestamp, `requestMissingTX`, queryGroup)

    let gotReceipt = false

    let keepTrying = true
    let triesLeft = Math.min(5, queryGroup.length)
    let nodeIndex = 0
    while (keepTrying) {
      if (triesLeft <= 0) {
        keepTrying = false
        break
      }
      triesLeft--

      let node = queryGroup[nodeIndex]
      nodeIndex++

      if (node == null) {
        continue
      }
      if (node.status != 'active' || potentiallyRemoved.has(node.id)) {
        continue
      }
      if (node === this.stateManager.currentCycleShardData.ourNode) {
        continue
      }

      // Node Precheck!
      if (this.stateManager.isNodeValidForInternalMessage(node.id, 'requestMissingTX', true, true) === false) {
        continue
      }

      let message = {txid:txID}
      let result: RequestTxResp = await this.p2p.ask(node, 'request_tx_and_state', message)

      if (result == null) {
        if (logFlags.verbose) {
          if (logFlags.error) this.mainLogger.error(`ASK FAIL request_tx_and_state ${triesLeft} ${utils.makeShortHash(node.id)}`)
        }
        if (logFlags.playback) this.logger.playbackLogNote('shrd_requestMissingTX_askfailretry', `${shortID}`, `asking: ${utils.makeShortHash(node.id)}`)
        continue
      }
      if (result.success !== true) {
        if (logFlags.error) this.mainLogger.error(`ASK FAIL requestMissingTX 9 ${triesLeft} ${utils.makeShortHash(node.id)}:${utils.makeShortHash(node.internalPort)} note:${result.note} tx:${shortID}`)
        continue
      }

      if (logFlags.playback) this.logger.playbackLogNote('shrd_requestMissingTX_result', `${shortID}`, `asking: ${utils.makeShortHash(node.id)} result: ${utils.stringifyReduce(result)}`)

      if (result.success === true) {
        keepTrying = false
        gotReceipt = true

        if (logFlags.error) this.mainLogger.error(`requestMissingTX got good receipt for: ${shortID} from: ${utils.makeShortHash(node.id)}:${utils.makeShortHash(node.internalPort)}`)

        return result
      }
    }
    return null
  }

  async requestMissingReceipt(txID:string, timestamp: number, refAccountId:string) : Promise<RequestReceiptForTxResp_old | null> {
    if (this.stateManager.currentCycleShardData == null) {
      return null
    }

    let shortID = utils.stringifyReduce(txID)
    if (logFlags.playback) this.logger.playbackLogNote('requestMissingReceipt', txID, ``)

    // will have to just ask node that cover our shard!
    let queryGroup:Shardus.Node[] = []

    // get nodes for address
    let homeNode = ShardFunctions.findHomeNode(this.stateManager.currentCycleShardData.shardGlobals, refAccountId, this.stateManager.currentCycleShardData.parititionShardDataMap)
    queryGroup = homeNode.nodeThatStoreOurParitionFull.slice()  

    // technically could look at all the keys from a reciept and build a larger list.
    //queryGroup = [...this.stateManager.currentCycleShardData.nodeShardData.nodeThatStoreOurParition]

    this.stateManager.debugNodeGroup(txID, timestamp, `requestMissingReceipt`, queryGroup)

    let gotReceipt = false

    let keepTrying = true
    let triesLeft = Math.min(5, queryGroup.length)
    let nodeIndex = 0
    while (keepTrying) {
      if (triesLeft <= 0) {
        keepTrying = false
        break
      }
      triesLeft--

      let node = queryGroup[nodeIndex]
      nodeIndex++

      if (node == null) {
        continue
      }
      if (node.status != 'active' || potentiallyRemoved.has(node.id)) {
        continue
      }
      if (node === this.stateManager.currentCycleShardData.ourNode) {
        continue
      }

      // Node Precheck!
      if (this.stateManager.isNodeValidForInternalMessage(node.id, 'requestMissingReceipt', true, true) === false) {
        continue
      }

      let message = { txid: txID, timestamp }
      let result: RequestReceiptForTxResp_old = await this.p2p.ask(node, 'request_receipt_for_tx_old', message) // not sure if we should await this.


      if (result == null) {
        if (logFlags.verbose) {
          if (logFlags.error) this.mainLogger.error(`ASK FAIL request_tx_and_state ${triesLeft} ${utils.makeShortHash(node.id)}`)
        }
        if (logFlags.playback) this.logger.playbackLogNote('shrd_requestMissingReceipt_askfailretry', `${shortID}`, `asking: ${utils.makeShortHash(node.id)}`)
        continue
      }
      if (result.success !== true) {
        if (logFlags.error) this.mainLogger.error(`ASK FAIL requestMissingReceipt 9 ${triesLeft} ${utils.makeShortHash(node.id)}:${utils.makeShortHash(node.internalPort)} note:${result.note} tx:${shortID}`)
        continue
      }

      if (logFlags.playback) this.logger.playbackLogNote('shrd_requestMissingReceipt_result', `${shortID}`, `asking: ${utils.makeShortHash(node.id)} result: ${utils.stringifyReduce(result)}`)

      if (result.success === true) {
        keepTrying = false
        gotReceipt = true

        if (logFlags.error) this.mainLogger.error(`requestMissingReceipt got good receipt for: ${shortID} from: ${utils.makeShortHash(node.id)}:${utils.makeShortHash(node.internalPort)}`)
        return result
      }
    }
    return null
  }

}

export default TransactionRepairOld
