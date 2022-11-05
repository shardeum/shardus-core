import * as Shardus from '../shardus/shardus-types'
import { StateManager as StateManagerTypes } from '@shardus/types'
import * as utils from '../utils'
const stringify = require('fast-stable-stringify')

import Profiler from '../utils/profiler'
import { P2PModuleContext as P2P } from '../p2p/Context'
import Storage from '../storage'
import Crypto from '../crypto'
import Logger, { logFlags } from '../logger'
import ShardFunctions from './shardFunctions'
import { time } from 'console'
import StateManager from '.'
import { json } from 'sequelize/types'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { potentiallyRemoved } from '../p2p/NodeList'
import * as CycleChain from '../p2p/CycleChain'
import {
  QueueEntry,
  AppliedVote,
  AccountHashCache,
  RequestStateForTxResp,
  AppliedReceipt,
  RequestTxResp,
  RequestReceiptForTxResp,
  RequestReceiptForTxResp_old,
} from './state-manager-types'

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

  constructor(
    stateManager: StateManager,
    profiler: Profiler,
    app: Shardus.App,
    logger: Logger,
    storage: Storage,
    p2p: P2P,
    crypto: Crypto,
    config: Shardus.StrictServerConfiguration
  ) {
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

      if (queueEntry.didSync) {
        nestedCountersInstance.countEvent('repair1', 'init-didSync')
      } else {
        nestedCountersInstance.countEvent('repair1', 'init-normal')
      }

      let shortHash = queueEntry.logID
      // Need to build a list of what accounts we need, what state they should be in and who to get them from
      let requestObjects: {
        [id: string]: {
          appliedVote: AppliedVote
          voteIndex: number
          accountHash: string
          accountId: string
          nodeShardInfo: StateManagerTypes.shardFunctionTypes.NodeShardData
          alternates: string[]
        }
      } = {}
      let appliedVotes = queueEntry.appliedReceiptForRepair.appliedVotes

      //shuffle the array
      utils.shuffleArray(appliedVotes)

      /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `appliedVotes ${utils.stringifyReduce(appliedVotes)}  `)
      /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `queueEntry.uniqueKeys ${utils.stringifyReduce(queueEntry.uniqueKeys)}`)

      /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`repairToMatchReceipt: ${shortHash} queueEntry.uniqueKeys ${utils.stringifyReduce(queueEntry.uniqueKeys)}`)

      // Build a request object for each key involved.
      // once we have a valid request object add in alternate nodes we could use as a backup

      let upToDateAccounts: { [id: string]: boolean } = {}

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
              if (upToDateAccounts[id] === true) {
                continue
              }

              let hashObj = this.stateManager.accountCache.getAccountHash(key)
              if (hashObj != null) {
                if (hashObj.h === hash) {
                  upToDateAccounts[id] = true
                  numUpToDateAccounts++
                  /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `account ${shortKey} already up to date our: cached:${utils.stringifyReduce(hashObj)}`)
                  break
                }
              }

              if (requestObjects[key] != null) {
                //todo perf delay these checks for jit.
                if (appliedVote.node_id !== this.stateManager.currentCycleShardData.ourNode.id) {
                  if (
                    this.stateManager.currentCycleShardData.nodeShardDataMap.has(appliedVote.node_id) === true
                  ) {
                    //build a list of alternates
                    requestObjects[key].alternates.push(appliedVote.node_id)
                  }
                }
                continue //we already have this request ready to go
              }

              coveredKey = true
              if (appliedVote.node_id === this.stateManager.currentCycleShardData.ourNode.id) {
                //dont reference our own node, should not happen anyway
                /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `appliedVote.node_id != this.stateManager.currentCycleShardData.ourNode.id ${utils.stringifyReduce(appliedVote.node_id)} our: ${utils.stringifyReduce(this.stateManager.currentCycleShardData.ourNode.id)} acc:${shortKey}`)
                continue
              }
              if (
                this.stateManager.currentCycleShardData.nodeShardDataMap.has(appliedVote.node_id) === false
              ) {
                /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `this.stateManager.currentCycleShardData.nodeShardDataMap.has(appliedVote.node_id) === false ${utils.stringifyReduce(appliedVote.node_id)}  acc:${shortKey}`)
                continue
              }
              let nodeShardInfo: StateManagerTypes.shardFunctionTypes.NodeShardData =
                this.stateManager.currentCycleShardData.nodeShardDataMap.get(appliedVote.node_id)

              if (nodeShardInfo == null) {
                /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`shrd_repairToMatchReceipt nodeShardInfo == null ${utils.stringifyReduce(appliedVote.node_id)} tx:${shortHash} acc:${shortKey}`)
                /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `nodeShardInfo == null ${utils.stringifyReduce(appliedVote.node_id)}  acc:${shortKey}`)
                continue
              }
              // if the account is not global check if it is in range.
              if (
                isGlobal === false &&
                ShardFunctions.testAddressInRange(id, nodeShardInfo.storedPartitions) == false
              ) {
                /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `address not in range ${utils.stringifyReduce(nodeShardInfo.storedPartitions)}  acc:${shortKey}`)
                continue
              }
              let objectToSet = {
                appliedVote,
                voteIndex: j,
                accountHash: hash,
                accountId: id,
                nodeShardInfo,
                alternates: [],
              }
              /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `setting key ${utils.stringifyReduce(key)} ${utils.stringifyReduce(objectToSet)}  acc:${shortKey}`)
              requestObjects[key] = objectToSet
              allKeys.push(key)
              requestObjectCount++
            } else {
            }
          }
        }

        if (coveredKey === false) {
          /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `coveredKey === false  acc:${shortKey}`)
          //todo log error on us not finding this key
        }
      }

      /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_start', `${shortHash}`, `qId: ${queueEntry.entryID} AccountsMissing:${utils.stringifyReduce(allKeys)}  requestObject:${utils.stringifyReduce(requestObjects)}`)

      // STEP 2
      // repair each unique key, if needed by asking an appropirate node for account state
      for (let key of queueEntry.uniqueKeys) {
        let shortKey = utils.stringifyReduce(key)
        if (requestObjects[key] != null) {
          let requestObject = requestObjects[key]

          if (requestObject == null) {
            /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `requestObject == null  acc:${shortKey}`)
            continue
          }

          let node = requestObject.nodeShardInfo.node
          if (node == null) {
            /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`shrd_repairToMatchReceipt node == null ${utils.stringifyReduce(requestObject.accountId)}`)
            /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `node == null  acc:${shortKey}`)
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
                /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`shrd_repairToMatchReceipt while(node == null) look for other node txId. idx:${alternateIndex} txid: ${utils.stringifyReduce(requestObject.appliedVote.txid)} alts: ${utils.stringifyReduce(requestObject.alternates)}  acc:${shortKey}`)
                //find alternate
                if (alternateIndex >= requestObject.alternates.length) {
                  this.statemanager_fatal(
                    `repairToMatchReceipt_1`,
                    `ASK FAIL repairToMatchReceipt failed to find alternate node to ask for receipt data. txId. ${utils.stringifyReduce(
                      requestObject.appliedVote.txid
                    )} alts: ${utils.stringifyReduce(requestObject.alternates)}  acc:${shortKey}`
                  )
                  attemptsRemaining = false

                  if (outerloopCount <= 2) {
                    //retry one more time but with out checking down or lost
                    alternateIndex = 0
                    attemptsRemaining = true
                    checkNodeDown = false
                    checkNodeLost = false
                    this.statemanager_fatal(
                      `repairToMatchReceipt_2`,
                      `ASK FAIL repairToMatchReceipt making attempt #${
                        outerloopCount + 1
                      }   tx:${shortHash}  acc:${shortKey}`
                    )
                    break
                  } else {
                    /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`repairToMatchReceipt FAILED out of attempts #${outerloopCount + 1} tx:${shortHash}  acc:${shortKey}`)
                    this.statemanager_fatal(
                      `repairToMatchReceipt_3`,
                      `ASK FAIL repairToMatchReceipt FAILED out of attempts   tx:${shortHash}  acc:${shortKey}`
                    )
                    return
                  }
                }
                let altId = requestObject.alternates[alternateIndex]
                let nodeShardInfo: StateManagerTypes.shardFunctionTypes.NodeShardData =
                  this.stateManager.currentCycleShardData.nodeShardDataMap.get(altId)
                if (nodeShardInfo != null) {
                  node = nodeShardInfo.node
                  /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`shrd_repairToMatchReceipt got alt source node: idx:${alternateIndex} txid: ${utils.stringifyReduce(requestObject.appliedVote.txid)} alts: ${utils.stringifyReduce(node.id)}  acc:${shortKey}`)
                } else {
                  /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`shrd_repairToMatchReceipt nodeShardInfo == null for ${utils.stringifyReduce(altId)}  tx:${shortHash}  acc:${shortKey}`)
                }
                alternateIndex++
              }

              if (node == null) {
                this.statemanager_fatal(
                  `repairToMatchReceipt_4`,
                  `ASK FAIL repairToMatchReceipt node == null in list. #${
                    outerloopCount + 1
                  }  tx:${shortHash}  acc:${shortKey}`
                )
                node = null
                break
              }

              let relationString = '' //ShardFunctions.getNodeRelation(homeNodeShardData, this.stateManager.currentCycleShardData.ourNode.id)
              /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_ask', `${shortHash}`, `r:${relationString}   asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} AccountsMissing:${utils.stringifyReduce(allKeys)}  acc:${shortKey}`)

              if (outerloopCount < 2) {
                // Node Precheck!
                if (
                  this.stateManager.isNodeValidForInternalMessage(
                    node.id,
                    'repairToMatchReceipt',
                    checkNodeDown,
                    checkNodeLost
                  ) === false
                ) {
                  // if(this.tryNextDataSourceNode('repairToMatchReceipt') == false){
                  //   break
                  // }
                  node = null
                  continue
                }
              }

              // if our data is already good no need to ask for it again
              if (this.stateManager.accountCache.hasAccount(requestObject.accountId)) {
                let accountMemData: AccountHashCache = this.stateManager.accountCache.getAccountHash(
                  requestObject.accountId
                )
                if (accountMemData.h === requestObject.accountHash) {
                  /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`Fix Worked: repairToMatchReceipt. already have latest ${utils.makeShortHash(requestObject.accountId)} cache:${utils.stringifyReduce(accountMemData)}`)
                  attemptsRemaining = false
                  continue
                }
              }

              let result: RequestStateForTxResp
              try {
                this.profiler.profileSectionStart('repair_asking_for_data')
                nestedCountersInstance.countEvent('repair1', 'asking')

                requestsMade++
                let message = {
                  key: requestObject.accountId,
                  hash: requestObject.accountHash,
                  txid: queueEntry.acceptedTx.txId,
                  timestamp: queueEntry.acceptedTx.timestamp,
                }
                result = await this.p2p.ask(node, 'request_state_for_tx_post', message) // not sure if we should await this.

                if (result == null) {
                  if (logFlags.verbose) {
                    /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`ASK FAIL repairToMatchReceipt request_state_for_tx_post result == null tx:${shortHash}  acc:${shortKey}`)
                  }
                  // We shuffle the array of votes each time so hopefully will ask another node next time
                  // TODO more robust limits to this process, maybe a delay?
                  /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`ASK FAIL repairToMatchReceipt request_state_for_tx_post no reponse from ${utils.stringifyReduce(node.id)}  tx:${shortHash}  acc:${shortKey}`)
                  //this.fatalLogger.fatal(`ASK FAIL repairToMatchReceipt missing logic to ask a new node! 1 ${utils.stringifyReduce(node.id)}`)
                  node = null
                  responseFails++
                  continue
                }

                if (result.success !== true) {
                  /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`ASK FAIL repairToMatchReceipt result.success === ${result.success}   tx:${shortHash}  acc:${shortKey}`)
                  //this.fatalLogger.fatal(`ASK FAIL repairToMatchReceipt missing logic to ask a new node! 2 ${utils.stringifyReduce(node.id)}`)
                  node = null
                  responseFails++
                  continue
                }
              } finally {
                this.profiler.profileSectionEnd('repair_asking_for_data')
              }
              let dataCountReturned = 0
              let accountIdsReturned = []
              for (let data of result.stateList) {
                try {
                  dataRecieved++
                  this.profiler.profileSectionStart('repair_saving_account_data')
                  nestedCountersInstance.countEvent('repair1', 'saving')
                  // let shortKey = utils.stringifyReduce(data.accountId)

                  //cycleToRecordOn = this.stateManager.getCycleNumberFromTimestamp(timestamp)

                  /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${shortHash}`, `write data: ${utils.stringifyReduce(data)}  acc:${shortKey}`)
                  //Commit the data
                  let dataToSet = [data]
                  let failedHashes = await this.stateManager.checkAndSetAccountData(
                    dataToSet,
                    `tx:${shortHash} repairToMatchReceipt`,
                    true
                  )

                  if (failedHashes.length === 0) {
                    dataApplied++
                    /* prettier-ignore */ nestedCountersInstance.countEvent('repair1', `q.repair applied cycle: ${this.stateManager.currentCycleShardData.cycleNumber}`)
                  } else {
                    failedHash++
                    this.statemanager_fatal(
                      `repairToMatchReceipt_failedhash`,
                      ` tx:${shortHash}  failed:${failedHashes[0]} acc:${shortKey}`
                    )
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
                    /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`repairToMatchReceipt: statsDataSummaryUpdate2 beforeData: had to query for data 1 ${utils.stringifyReduce(data.accountId)}  tx:${shortHash}  acc:${shortKey}`)
                    if (beforeData == null) {
                      /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`repairToMatchReceipt: statsDataSummaryUpdate2 beforeData: had to query for data 1 not found ${utils.stringifyReduce(data.accountId)}  tx:${shortHash}  acc:${shortKey}`)
                    }
                  }
                  if (beforeData == null) {
                    /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`repairToMatchReceipt: statsDataSummaryUpdate2 beforeData data is null ${utils.stringifyReduce(data.accountId)} WILL CAUSE DATA OOS  tx:${shortHash}  acc:${shortKey}`)
                  } else {
                    // USEDEFAULT=checkAndSetAccountData for stats. use the default behavoir of checkAndSetAccountData instead since that used the local before data, and is better for stat deltas
                    // state table repairs needed the state exactly before repair state, which would create a different delta.

                    // if (this.stateManager.partitionStats.hasAccountBeenSeenByStats(data.accountId) === false) {
                    //   // Init stats because we have not seen this account yet.
                    //   this.stateManager.partitionStats.statsDataSummaryInitRaw(queueEntry.cycleToRecordOn, data.accountId, beforeData, 'repairToMatchReceipt')
                    // }

                    // important to update the timestamp.  There are various reasons it could be incorrectly set to 0
                    let { timestamp: updatedTimestamp, hash: updatedHash } =
                      this.app.getTimestampAndHashFromAccount(data.data)
                    if (data.timestamp != updatedTimestamp) {
                      /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`repairToMatchReceipt: statsDataSummaryUpdate2 timstamp had to be corrected from ${data.timestamp} to ${updatedTimestamp}   tx:${shortHash}  acc:${shortKey} hash:${utils.stringifyReduce(updatedHash)} `)
                    }
                    // This is correcting the timestamp on the wrapper
                    data.timestamp = updatedTimestamp

                    // USEDEFAULT=checkAndSetAccountData for stats.  (search USEDEFAULT for more context)
                    // this.stateManager.partitionStats.statsDataSummaryUpdate2(queueEntry.cycleToRecordOn, beforeData, data, 'repairToMatchReceipt')

                    // record state table data
                    let { timestamp: oldtimestamp, hash: oldhash } =
                      this.app.getTimestampAndHashFromAccount(beforeData)

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
                    if (isGlobal === false) {
                      let hash = this.stateManager.accountCache.getAccountHash(data.accountId)

                      if (hash != null) {
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

                    updatedAccountAndHashes.push({ accountID: data.accountId, hash: data.stateId })

                    /*if (logFlags.debug)*/ this.mainLogger.debug(
                      `repairToMatchReceipt: addAccountStates tx:${shortHash} neededUpdate:${hashNeededUpdate} updateStateTable:${updateStateTable} timeStampMatches:${timeStampMatches} test2:${test2} test3:${test3} test4:${test4} branch4:${branch4} ${utils.stringifyReduce(
                        stateTableResults
                      )} acc:${shortKey}`
                    )
                  }
                } finally {
                  this.profiler.profileSectionEnd('repair_saving_account_data')
                }
              }

              /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_result', `${shortHash}`, `r:${relationString}   result:${queueEntry.logstate} dataCount:${dataCountReturned} asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID}  AccountsMissing:${utils.stringifyReduce(allKeys)} AccountsReturned:${utils.stringifyReduce(accountIdsReturned)}`)

              if (outerloopCount > 1) {
                this.statemanager_fatal(
                  `repairToMatchReceipt_5ok`,
                  `ASK FAIL repairToMatchReceipt FIX WORKED ${outerloopCount} tx:${shortHash}  acc:${shortKey}`
                )
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

      if (this.stateManager.currentCycleShardData.cycleNumber != queueEntry.cycleToRecordOn) {
        this.stateManager.cycleDebugNotes.lateRepairs++ //per cycle debug info
      }
    } finally {
      if (queueEntry.repairFinished === true) {
        queueEntry.hasValidFinalData = true

        let repairLogString = `tx:${queueEntry.logID} updatedAccountAndHashes:${utils.stringifyReduce(
          updatedAccountAndHashes
        )} counters:${utils.stringifyReduce({
          requestObjectCount,
          requestsMade,
          responseFails,
          dataRecieved,
          dataApplied,
          failedHash,
          numUpToDateAccounts,
        })}`
        /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_success', queueEntry.logID, repairLogString)
        this.mainLogger.debug('shrd_repairToMatchReceipt_success ' + repairLogString)
        nestedCountersInstance.countEvent('repair1', 'success')
      } else {
        queueEntry.repairFailed = true
        this.statemanager_fatal(
          `repairToMatchReceipt_failed`,
          `tx:${queueEntry.logID} counters:${utils.stringifyReduce({
            requestObjectCount,
            requestsMade,
            responseFails,
            dataRecieved,
            dataApplied,
            failedHash,
          })}  keys ${utils.stringifyReduce(allKeys)}  `
        )
        nestedCountersInstance.countEvent('repair1', 'failed')
      }

      this.profiler.profileSectionEnd('repair')
    }
  }
}

export default TransactionRepairOld
