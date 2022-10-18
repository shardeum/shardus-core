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
  AppliedReceipt2,
  WrappedResponses,
} from './state-manager-types'
import { stat } from 'fs'

class TransactionRepair {
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

    //let requestObjectCount = 0
    //let requestsMade = 0
    //let responseFails = 0
    //let dataRecieved = 0
    //let dataApplied = 0
    //let failedHash = 0
    //let numUpToDateAccounts = 0
    let updatedAccountAndHashes = []
    let localUpdatedAccountAndHashes = []

    //let localAccUsed = 0
    //let localAccSkipped = 0
    //let skipNonStored = 0

    let stats = {
      requestObjectCount: 0,
      requestsMade: 0,
      responseFails: 0,
      dataRecieved: 0,
      dataApplied: 0,
      failedHash: 0,
      numUpToDateAccounts: 0,
      repairsGoodCount: 0,
      skipNonStored: 0,
      localAccUsed: 0,
      localAccSkipped: 0,
      rLoop1: 0,
      rLoop2: 0,
      rLoop3: 0,
      rLoop4: 0,
      rangeErr: 0,
    }

    let allKeys = []
    let repairFix = true
    let keysList = []
    let voteHashMap: Map<string, string> = new Map()
    let localReadyRepairs: Map<string, Shardus.WrappedResponse> = new Map()

    let nonStoredKeys = []

    try {
      this.stateManager.dataRepairsStarted++

      this.profiler.profileSectionStart('repair')
      this.profiler.profileSectionStart('repair_init')

      if (queueEntry.didSync) {
        nestedCountersInstance.countEvent('repair1', 'init-didSync')
      } else {
        nestedCountersInstance.countEvent('repair1', 'init-normal')
      }

      let txLogID = queueEntry.logID // queueEntry.logID
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
      let appliedVote = queueEntry.appliedReceiptForRepair2.appliedVote

      let voters = queueEntry.appliedReceiptForRepair2.signatures
      //shuffle the array
      utils.shuffleArray(voters)

      if (queueEntry.ourVoteHash != null) {
        if (queueEntry.ourVoteHash === this.crypto.hash(queueEntry.appliedReceiptForRepair2.appliedVote)) {
          //This case is ok.  A tx in the queue may get expired after it pre-applied and cast a vote.
          //This method should detect that we already have correct state available for the accounts and
          //simply apply this repair with 100% local data.
          nestedCountersInstance.countEvent('repair1', 'ourVoteHash matched receipt')
          //In the past we errored out here.  But that causes us to miss the repair opportunity in
          //some valid cases
        }
      }

      /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${txLogID}`, `appliedVoters ${utils.stringifyReduce(voters)}  `)
      /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${txLogID}`, `queueEntry.uniqueKeys ${utils.stringifyReduce(queueEntry.uniqueKeys)}`)

      /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`repairToMatchReceipt: ${txLogID} queueEntry.uniqueKeys ${utils.stringifyReduce(queueEntry.uniqueKeys)}`)

      // Build a request object for each key involved.
      // once we have a valid request object add in alternate nodes we could use as a backup

      let upToDateAccounts: { [id: string]: boolean } = {}

      this.profiler.profileSectionEnd('repair_init')

      //TODO!! figure out if we need to check shard data from different cycle!!!
      //there are several place like this in the code. search for testAddressInRange
      let nodeShardData: StateManagerTypes.shardFunctionTypes.NodeShardData =
        this.stateManager.currentCycleShardData.nodeShardData

      for (let i = 0; i < appliedVote.account_id.length; i++) {
        let accountID = appliedVote.account_id[i]
        //only check for stored keys.  TODO task. make sure nodeShardData is from correct cycle!
        //TODO is there a better way/time to build this knowlege set?
        if (ShardFunctions.testAddressInRange(accountID, nodeShardData.storedPartitions) === false) {
          stats.skipNonStored++
          nonStoredKeys.push(accountID)
          continue
        }

        voteHashMap.set(appliedVote.account_id[i], appliedVote.account_state_hash_after[i])
      }

      if (repairFix) {
        //look at the vote to get the list of keys to repair
        // let uniqueKeysSet = new Set()
        // for(let key of appliedVote.account_id){
        //   uniqueKeysSet.add(key)
        // }
        //keysList = Array.from(uniqueKeysSet)
        keysList = Array.from(voteHashMap.keys())
        /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`repairToMatchReceipt: ${txLogID} uniqueKeysSet ${utils.stringifyReduce(keysList)}`)
      } else {
        keysList = Array.from(queueEntry.uniqueKeys)
      }

      //if we have some pre applied data that results in the correct states we can use it instead of asking other nodeds for data
      //This will only work if the node was in the execution group
      if (repairFix) {
        let applyResponse = queueEntry?.preApplyTXResult?.applyResponse
        if (applyResponse != null) {
          if (applyResponse.accountWrites != null && applyResponse.accountWrites.length > 0) {
            for (let writtenAccount of applyResponse.accountWrites) {
              let key = writtenAccount.accountId
              let shortKey = utils.stringifyReduce(key)
              let goalHash = voteHashMap.get(key)
              let data = writtenAccount.data
              let hashObj = this.stateManager.accountCache.getAccountHash(key)

              if (goalHash != null && goalHash === data.stateId) {
                localReadyRepairs.set(key, data)
                if (hashObj != null && hashObj.t > data.timestamp) {
                  /* prettier-ignore */ nestedCountersInstance.countEvent('repair1', 'skip account repair 4, we have a newer copy')
                  continue
                }
                if (hashObj != null && hashObj.h === data.stateId) {
                  nestedCountersInstance.countEvent('repair1', 'skip account repair 4, already have hash')
                  continue
                }

                let dataToSet = [data]
                let failedHashes = await this.stateManager.checkAndSetAccountData(
                  dataToSet,
                  `tx:${txLogID} repairToMatchReceipt`,
                  true
                )

                if (failedHashes.length === 0) {
                  //dataApplied++
                  stats.localAccUsed++
                  /* prettier-ignore */ nestedCountersInstance.countEvent('repair1', `q.repair applied cycle: ${this.stateManager.currentCycleShardData.cycleNumber}`)
                } else {
                  stats.failedHash++
                  this.statemanager_fatal(
                    `repairToMatchReceipt_failedhash 2`,
                    ` tx:${txLogID}  failed:${failedHashes[0]} acc:${shortKey}`
                  )
                }

                nestedCountersInstance.countEvent('repair1', 'writeCombinedAccountDataToBackups')
                await this.stateManager.writeCombinedAccountDataToBackups(dataToSet, failedHashes)

                localUpdatedAccountAndHashes.push({ accountID: data.accountId, hash: data.stateId })
                //todo state table updates
              }
            }
          }
        }
      }

      //TODO could look at forwarded data to see if there is any to use

      // STEP 1
      // Build a list of request objects
      for (let key of keysList) {
        stats.rLoop1++

        if (localReadyRepairs.has(key)) {
          stats.localAccSkipped++
          continue //can skip this data, we already have it
        }

        let coveredKey = false
        let isGlobal = this.stateManager.accountGlobals.isGlobalAccount(key)
        let shortKey = utils.stringifyReduce(key)
        //It modifying global.
        for (let i = 0; i < voters.length; i++) {
          stats.rLoop2++

          let voter = voters[i]
          let node = this.stateManager.p2p.state.getNodeByPubKey(voter.owner)
          if (node == null) {
            continue
          }
          let node_id = node.id
          for (let j = 0; j < appliedVote.account_id.length; j++) {
            stats.rLoop3++
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
                  stats.numUpToDateAccounts++
                  /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${txLogID}`, `account ${shortKey} already up to date our: cached:${utils.stringifyReduce(hashObj)}`)
                  break
                }
              }

              if (repairFix) {
                if (hashObj != null && hashObj.t > queueEntry.acceptedTx.timestamp) {
                  nestedCountersInstance.countEvent('repair1', 'skip account repair, we have a newer copy')
                  continue
                }
              }

              if (requestObjects[key] != null) {
                //todo perf delay these checks for jit.
                if (node_id !== this.stateManager.currentCycleShardData.ourNode.id) {
                  if (this.stateManager.currentCycleShardData.nodeShardDataMap.has(node_id) === true) {
                    //build a list of alternates
                    requestObjects[key].alternates.push(node_id)
                  }
                }
                continue //we already have this request ready to go
              }
              stats.rLoop4++

              coveredKey = true
              if (node_id === this.stateManager.currentCycleShardData.ourNode.id) {
                //dont reference our own node, should not happen anyway
                /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${txLogID}`, `node_id != this.stateManager.currentCycleShardData.ourNode.id ${utils.stringifyReduce(node_id)} our: ${utils.stringifyReduce(this.stateManager.currentCycleShardData.ourNode.id)} acc:${shortKey}`)
                continue
              }
              if (this.stateManager.currentCycleShardData.nodeShardDataMap.has(node_id) === false) {
                //node is not listed as available in the lattest node shard data map
                /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${txLogID}`, `this.stateManager.currentCycleShardData.nodeShardDataMap.has(node_id) === false ${utils.stringifyReduce(node_id)}  acc:${shortKey}`)
                continue
              }
              let nodeShardInfo: StateManagerTypes.shardFunctionTypes.NodeShardData =
                this.stateManager.currentCycleShardData.nodeShardDataMap.get(node_id)

              if (nodeShardInfo == null) {
                /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`shrd_repairToMatchReceipt nodeShardInfo == null ${utils.stringifyReduce(node_id)} tx:${txLogID} acc:${shortKey}`)
                /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${txLogID}`, `nodeShardInfo == null ${utils.stringifyReduce(node_id)}  acc:${shortKey}`)
                continue
              }

              //only need to check for account being in range if the node is not in the execution group?
              if (queueEntry.executionIdSet.has(node_id) === false) {
                // if the account is not global check if it is in range.
                if (
                  isGlobal === false &&
                  ShardFunctions.testAddressInRange(id, nodeShardInfo.storedPartitions) == false
                ) {
                  /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${txLogID}`, `address not in range ${utils.stringifyReduce(nodeShardInfo.storedPartitions)}  acc:${shortKey}`)
                  stats.rangeErr++
                  continue
                }
              }

              let objectToSet = {
                appliedVote,
                voteIndex: j,
                accountHash: hash,
                accountId: id,
                nodeShardInfo,
                alternates: [],
              }
              /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${txLogID}`, `setting key ${utils.stringifyReduce(key)} ${utils.stringifyReduce(objectToSet)}  acc:${shortKey}`)
              requestObjects[key] = objectToSet
              allKeys.push(key)
              stats.requestObjectCount++
            } else {
            }
          }
        }

        if (coveredKey === false) {
          /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${txLogID}`, `coveredKey === false  acc:${shortKey}`)
          //todo log error on us not finding this key
        }
      }

      /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_start', `${txLogID}`, `qId: ${queueEntry.entryID} AccountsMissing:${utils.stringifyReduce(allKeys)}  requestObject:${utils.stringifyReduce(requestObjects)}`)

      // STEP 2
      // repair each unique key, if needed by asking an appropirate node for account state
      for (let key of allKeys) {
        let shortKey = utils.stringifyReduce(key)
        if (requestObjects[key] != null) {
          let requestObject = requestObjects[key]

          if (requestObject == null) {
            /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${txLogID}`, `requestObject == null  acc:${shortKey}`)
            continue
          }

          let node = requestObject.nodeShardInfo.node
          if (node == null) {
            /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`shrd_repairToMatchReceipt node == null ${utils.stringifyReduce(requestObject.accountId)}`)
            /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${txLogID}`, `node == null  acc:${shortKey}`)
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
                      }   tx:${txLogID}  acc:${shortKey}`
                    )
                    break
                  } else {
                    /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`repairToMatchReceipt FAILED out of attempts #${outerloopCount + 1} tx:${txLogID}  acc:${shortKey}`)
                    this.statemanager_fatal(
                      `repairToMatchReceipt_3`,
                      `ASK FAIL repairToMatchReceipt FAILED out of attempts   tx:${txLogID}  acc:${shortKey}`
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
                  /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`shrd_repairToMatchReceipt nodeShardInfo == null for ${utils.stringifyReduce(altId)}  tx:${txLogID}  acc:${shortKey}`)
                }
                alternateIndex++
              }

              if (node == null) {
                this.statemanager_fatal(
                  `repairToMatchReceipt_4`,
                  `ASK FAIL repairToMatchReceipt node == null in list. #${
                    outerloopCount + 1
                  }  tx:${txLogID}  acc:${shortKey}`
                )
                node = null
                break
              }

              let relationString = '' //ShardFunctions.getNodeRelation(homeNodeShardData, this.stateManager.currentCycleShardData.ourNode.id)
              /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_ask', `${txLogID}`, `r:${relationString}   asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID} AccountsMissing:${utils.stringifyReduce(allKeys)}  acc:${shortKey}`)

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
                  nestedCountersInstance.countEvent('repair1', 'skip request, already have correct hash')
                  continue
                }
              }

              let result: RequestStateForTxResp
              try {
                this.profiler.profileSectionStart('repair_asking_for_data')
                nestedCountersInstance.countEvent('repair1', 'asking')

                stats.requestsMade++
                let message = {
                  key: requestObject.accountId,
                  hash: requestObject.accountHash,
                  txid: queueEntry.acceptedTx.txId,
                  timestamp: queueEntry.acceptedTx.timestamp,
                }
                result = await this.p2p.ask(node, 'request_state_for_tx_post', message) // not sure if we should await this.

                if (result == null) {
                  if (logFlags.verbose) {
                    /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`ASK FAIL repairToMatchReceipt request_state_for_tx_post result == null tx:${txLogID}  acc:${shortKey}`)
                  }
                  // We shuffle the array of votes each time so hopefully will ask another node next time
                  // TODO more robust limits to this process, maybe a delay?
                  /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`ASK FAIL repairToMatchReceipt request_state_for_tx_post no reponse from ${utils.stringifyReduce(node.id)}  tx:${txLogID}  acc:${shortKey}`)
                  //this.fatalLogger.fatal(`ASK FAIL repairToMatchReceipt missing logic to ask a new node! 1 ${utils.stringifyReduce(node.id)}`)
                  node = null
                  stats.responseFails++
                  continue
                }

                if (result.success !== true) {
                  /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`ASK FAIL repairToMatchReceipt result.success === ${result.success}   tx:${txLogID}  acc:${shortKey}`)
                  //this.fatalLogger.fatal(`ASK FAIL repairToMatchReceipt missing logic to ask a new node! 2 ${utils.stringifyReduce(node.id)}`)
                  node = null
                  stats.responseFails++
                  continue
                }
              } finally {
                this.profiler.profileSectionEnd('repair_asking_for_data')
              }
              let dataCountReturned = 0
              let accountIdsReturned = []
              for (let data of result.stateList) {
                try {
                  stats.dataRecieved++
                  this.profiler.profileSectionStart('repair_saving_account_data')
                  nestedCountersInstance.countEvent('repair1', 'saving')
                  // let shortKey = utils.stringifyReduce(data.accountId)

                  //cycleToRecordOn = this.stateManager.getCycleNumberFromTimestamp(timestamp)

                  /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${txLogID}`, `write data: ${utils.stringifyReduce(data)}  acc:${shortKey}`)

                  if (repairFix) {
                    //some temp checking.  A just in time check to see if we dont need to save this account.
                    let hashObj = this.stateManager.accountCache.getAccountHash(key)
                    if (hashObj != null && hashObj.t > data.timestamp) {
                      /* prettier-ignore */ nestedCountersInstance.countEvent('repair1', 'skip account repair 2, we have a newer copy')
                      continue
                    }
                  }

                  //Commit the data
                  let dataToSet = [data]
                  let failedHashes = await this.stateManager.checkAndSetAccountData(
                    dataToSet,
                    `tx:${txLogID} repairToMatchReceipt`,
                    true
                  )

                  if (failedHashes.length === 0) {
                    stats.dataApplied++
                    /* prettier-ignore */ nestedCountersInstance.countEvent('repair1', `q.repair applied cycle: ${this.stateManager.currentCycleShardData.cycleNumber}`)
                  } else {
                    stats.failedHash++
                    this.statemanager_fatal(
                      `repairToMatchReceipt_failedhash`,
                      ` tx:${txLogID}  failed:${failedHashes[0]} acc:${shortKey}`
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
                    /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`repairToMatchReceipt: statsDataSummaryUpdate2 beforeData: had to query for data 1 ${utils.stringifyReduce(data.accountId)}  tx:${txLogID}  acc:${shortKey} h:${utils.stringifyReduce(data.stateId)}`)
                    if (beforeData == null) {
                      /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`repairToMatchReceipt: statsDataSummaryUpdate2 beforeData: had to query for data 1 not found ${utils.stringifyReduce(data.accountId)}  tx:${txLogID}  acc:${shortKey} h:${utils.stringifyReduce(data.stateId)}`)
                    }
                  }
                  if (beforeData == null) {
                    /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`repairToMatchReceipt: statsDataSummaryUpdate2 beforeData data is null ${utils.stringifyReduce(data.accountId)} WILL CAUSE DATA OOS  tx:${txLogID}  acc:${shortKey} h:${utils.stringifyReduce(data.stateId)}`)
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
                      /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`repairToMatchReceipt: statsDataSummaryUpdate2 timstamp had to be corrected from ${data.timestamp} to ${updatedTimestamp}   tx:${txLogID}  acc:${shortKey} hash:${utils.stringifyReduce(updatedHash)} `)
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
                      if (stateTableResults.stateBefore == null) {
                        nestedCountersInstance.countEvent('repair1', 'addAccountStates-null')
                        stateTableResults.stateBefore = '0000'
                        await this.storage.addAccountStates(stateTableResults)
                      } else {
                        nestedCountersInstance.countEvent('repair1', 'addAccountStates')
                        await this.storage.addAccountStates(stateTableResults)
                      }
                    }

                    //update hash
                    data.stateId = updatedHash

                    updatedAccountAndHashes.push({ accountID: data.accountId, hash: data.stateId })

                    /*if (logFlags.debug)*/ this.mainLogger.debug(
                      `repairToMatchReceipt: addAccountStates tx:${txLogID} neededUpdate:${hashNeededUpdate} updateStateTable:${updateStateTable} timeStampMatches:${timeStampMatches} test2:${test2} test3:${test3} test4:${test4} branch4:${branch4} ${utils.stringifyReduce(
                        stateTableResults
                      )} acc:${shortKey}`
                    )
                  }
                } finally {
                  this.profiler.profileSectionEnd('repair_saving_account_data')
                }
              }

              /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_result', `${txLogID}`, `r:${relationString}   result:${queueEntry.logstate} dataCount:${dataCountReturned} asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID}  AccountsMissing:${utils.stringifyReduce(allKeys)} AccountsReturned:${utils.stringifyReduce(accountIdsReturned)}`)

              if (outerloopCount > 1) {
                this.statemanager_fatal(
                  `repairToMatchReceipt_5 outerloopCount ok`,
                  `ASK FAIL repairToMatchReceipt FIX WORKED ${outerloopCount} tx:${txLogID}  acc:${shortKey}`
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
        let allGood = false
        //let repairsGoodCount = 0

        //todo need to fix up the definition of all good.
        //we wont have account hashes for everything in a sharded context!
        //need a keylist of stored accounts only.. or filter the
        //keylist sooner!
        let badHashKeys = []
        let noHashKeys = []
        for (let key of keysList) {
          let hashObj = this.stateManager.accountCache.getAccountHash(key)
          if (hashObj == null) {
            noHashKeys.push(key)
            continue
          }
          if (hashObj.h === voteHashMap.get(key)) {
            stats.repairsGoodCount++
          } else {
            badHashKeys.push(key)
          }
        }

        if (stats.repairsGoodCount === keysList.length) {
          allGood = true
          nestedCountersInstance.countEvent('repair1', 'AllGood')
        } else {
          nestedCountersInstance.countEvent('repair1', 'AllGood-failed')
        }

        queueEntry.hasValidFinalData = true

        let repairLogString = `tx:${queueEntry.logID} updatedAccountAndHashes:${utils.stringifyReduce(
          updatedAccountAndHashes
        )}  localUpdatedAccountAndHashes:${utils.stringifyReduce(localUpdatedAccountAndHashes)} state:${
          queueEntry.state
        } counters:${utils.stringifyReduce(stats)}`
        /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_success', queueEntry.logID, repairLogString)
        this.mainLogger.debug('shrd_repairToMatchReceipt_success ' + repairLogString)
        nestedCountersInstance.countEvent('repair1', 'success')
        /* prettier-ignore */ nestedCountersInstance.countEvent('repair1', `success: req:${stats.requestsMade} apl:${stats.dataApplied} localAccUsed:${stats.localAccUsed} localAccSkipped:${stats.localAccSkipped} key count:${voteHashMap.size} allGood:${allGood}`)
        nestedCountersInstance.countEvent('repair1', `success: key count:${voteHashMap.size}`)
        /* prettier-ignore */ nestedCountersInstance.countEvent('repair1', `success: state:${queueEntry.state} allGood:${allGood}`)
        /* prettier-ignore */ nestedCountersInstance.countEvent('repair1', `success: state:${queueEntry.state} allGood:${allGood} skipNonStored:${stats.skipNonStored}`)

        /* prettier-ignore */ if (logFlags.error && allGood === false) this.mainLogger.error(`repair1 success: req:${stats.requestsMade} apl:${stats.dataApplied} localAccUsed:${stats.localAccUsed} localAccSkipped:${stats.localAccSkipped} key count:${voteHashMap.size} allGood:${allGood} updatedAccountAndHashes:${utils.stringifyReduce(updatedAccountAndHashes)} localUpdatedAccountAndHashes:${utils.stringifyReduce(localUpdatedAccountAndHashes)} badHashKeys:${utils.stringifyReduce(badHashKeys)} noHashKeys:${utils.stringifyReduce(noHashKeys)} nonStoredKeys:${utils.stringifyReduce(nonStoredKeys)} keysList:${utils.stringifyReduce(keysList)} localReadyRepairs:${utils.stringifyReduce(localReadyRepairs.keys())} stats:${utils.stringifyReduce(stats)}`)
      } else {
        queueEntry.repairFailed = true
        this.statemanager_fatal(
          `repairToMatchReceipt_failed`,
          `tx:${queueEntry.logID} state:${queueEntry.state} counters:${utils.stringifyReduce(
            stats
          )}  keys ${utils.stringifyReduce(allKeys)}  `
        )
        nestedCountersInstance.countEvent('repair1', 'failed')
        nestedCountersInstance.countEvent('repair1', `failed: key count:${voteHashMap.size}`)
        nestedCountersInstance.countEvent('repair1', `failed state:${queueEntry.state}`)
      }

      this.profiler.profileSectionEnd('repair')
    }
  }

  // can the repair work if just have the receipt
  async repairToMatchReceiptWithoutQueueEntry(
    receipt: AppliedReceipt2,
    refAccountId: string
  ): Promise<boolean> {
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
    let needUpdateAccounts: { [id: string]: boolean } = {}
    let upToDateAccounts: { [id: string]: boolean } = {}
    let updatedAccounts: { [id: string]: boolean } = {}

    let updatedAccountAndHashes = []

    let shortHash = utils.makeShortHash(txID)
    let allKeys
    try {
      nestedCountersInstance.countEvent('repair2', `init`)

      // STEP 0: need to find the TX
      let txRequestResult = await this.requestMissingTX(txID, refAccountId)
      if (txRequestResult == null || txRequestResult.success != true) {
        /* prettier-ignore */ nestedCountersInstance.countEvent('repair2', `txRequestResult.success == ${txRequestResult?.success}`)
        this.statemanager_fatal(
          `repairToMatchReceipt2_a`,
          `ASK FAIL requestMissingTX   tx:${shortHash} result:${utils.stringifyReduce(txRequestResult)} `
        )
        return false
      }
      timestamp = txRequestResult.acceptedTX.timestamp

      const { keys: keysResponse } = this.app.crack(
        txRequestResult.acceptedTX.data,
        txRequestResult.acceptedTX.appData
      )
      allKeys = keysResponse.allKeys
      //cycleToRecordOn = this.stateManager.getCycleNumberFromTimestamp(timestamp)
      cycleToRecordOn = CycleChain.getCycleNumberFromTimestamp(timestamp)

      let originalData = txRequestResult.originalData

      missingTXFound++

      let keyMap = {}
      for (let key of allKeys) {
        //filter only keys that we cover up here.
        let isStored = ShardFunctions.testAddressInRange(
          key,
          this.stateManager.currentCycleShardData.nodeShardData.storedPartitions
        )
        if (isStored != true) {
          // continue
          nestedCountersInstance.countEvent('repair2', `non stored key?`)
        }

        keyMap[key] = true
      }
      uniqueKeys = Object.keys(keyMap)

      // if(uniqueKeys.length === 0){

      //   this.statemanager_fatal('ABORT no covered keys', `ABORT no covered keys  ${utils.stringifyReduce(allKeys)} tx:${shortHash} ${utils.stringifyReduce(this.stateManager.currentCycleShardData.nodeShardData.storedPartitions)} cycle:${this.stateManager.currentCycleShardData.cycleNumber}`)
      //   /* prettier-ignore */ nestedCountersInstance.countEvent('repair2', `ABORT no covered keys  ${utils.stringifyReduce(allKeys)} tx:${shortHash} ${utils.stringifyReduce(this.stateManager.currentCycleShardData.nodeShardData.storedPartitions)} cycle:${this.stateManager.currentCycleShardData.cycleNumber}`)
      //   /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`shrd_repairToMatchReceipt2: ABORT no covered keys ${utils.stringifyReduce(allKeys)} tx:${shortHash} `)
      //   /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_noKeys', `${shortHash}`, `ABORT no covered keys  ${utils.stringifyReduce(allKeys)} tx:${shortHash} `)

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
      let appliedVote = receipt.appliedVote

      let voters = receipt.signatures
      //shuffle the array
      utils.shuffleArray(voters)

      /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note2', `${shortHash}`, `appliedVotes ${utils.stringifyReduce(voters)}  `)
      /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note2', `${shortHash}`, `queueEntry.uniqueKeys ${utils.stringifyReduce(uniqueKeys)}`)

      /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`repairToMatchReceipt2: ${shortHash} queueEntry.uniqueKeys ${utils.stringifyReduce(uniqueKeys)} ${utils.stringifyReduce(txRequestResult)}`)

      // Build a request object for each key involved.
      // once we have a valid request object add in alternate nodes we could use as a backup

      //let numUpToDateAccounts = 0

      // STEP 1: build a list of request objects
      for (let key of uniqueKeys) {
        let coveredKey = false

        let isGlobal = this.stateManager.accountGlobals.isGlobalAccount(key)
        let shortKey = utils.stringifyReduce(key)
        //It modifying global.
        for (let i = 0; i < voters.length; i++) {
          let voter = voters[i]
          let node = this.stateManager.p2p.state.getNodeByPubKey(voter.owner)
          if (node == null) {
            continue
          }
          let node_id = node.id
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
                  //numUpToDateAccounts++
                  /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note2', `${shortHash}`, `account ${shortKey} already up to date our: cached:${utils.stringifyReduce(hashObj)}`)

                  //update cache state.

                  break
                } else {
                  needUpdateAccounts[id] = true
                }
              }

              if (requestObjects[key] != null) {
                //todo perf delay these checks for jit.
                if (node_id !== this.stateManager.currentCycleShardData.ourNode.id) {
                  if (this.stateManager.currentCycleShardData.nodeShardDataMap.has(node_id) === true) {
                    //build a list of alternates
                    requestObjects[key].alternates.push(node_id)
                  }
                }
                continue //we already have this request ready to go
              }

              coveredKey = true
              if (node_id === this.stateManager.currentCycleShardData.ourNode.id) {
                //dont reference our own node, should not happen anyway
                /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note2', `${shortHash}`, `node_id != this.stateManager.currentCycleShardData.ourNode.id ${utils.stringifyReduce(node_id)} our: ${utils.stringifyReduce(this.stateManager.currentCycleShardData.ourNode.id)} acc:${shortKey}`)
                continue
              }
              if (this.stateManager.currentCycleShardData.nodeShardDataMap.has(node_id) === false) {
                /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note2', `${shortHash}`, `this.stateManager.currentCycleShardData.nodeShardDataMap.has(node_id) === false ${utils.stringifyReduce(node_id)}  acc:${shortKey}`)
                continue
              }
              let nodeShardInfo: StateManagerTypes.shardFunctionTypes.NodeShardData =
                this.stateManager.currentCycleShardData.nodeShardDataMap.get(node_id)

              if (nodeShardInfo == null) {
                /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`shrd_repairToMatchReceipt2 nodeShardInfo == null ${utils.stringifyReduce(node_id)} tx:${shortHash} acc:${shortKey}`)
                /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note2', `${shortHash}`, `nodeShardInfo == null ${utils.stringifyReduce(node_id)}  acc:${shortKey}`)
                continue
              }
              // if the account is not global check if it is in range.
              if (
                isGlobal === false &&
                ShardFunctions.testAddressInRange(id, nodeShardInfo.storedPartitions) == false
              ) {
                /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note2', `${shortHash}`, `address not in range ${utils.stringifyReduce(nodeShardInfo.storedPartitions)}  acc:${shortKey}`)
                //continue
                nestedCountersInstance.countEvent('repair2', `dont skip account for repair..`)
              }
              let objectToSet = {
                appliedVote,
                voteIndex: j,
                accountHash: hash,
                accountId: id,
                nodeShardInfo,
                alternates: [],
              }
              /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note2', `${shortHash}`, `setting key ${utils.stringifyReduce(key)} ${utils.stringifyReduce(objectToSet)}  acc:${shortKey}`)
              requestObjects[key] = objectToSet
              requestObjectCount++
              allKeys.push(key)
            } else {
            }
          }
        }

        if (coveredKey === false) {
          /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note2', `${shortHash}`, `coveredKey === false  acc:${shortKey}`)
          //todo log error on us not finding this key
        }
      }

      /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_start2', `${shortHash}`, ` AccountsMissing:${utils.stringifyReduce(allKeys)}  requestObject:${utils.stringifyReduce(requestObjects)}`)

      if (requestObjectCount === 0) {
        /* prettier-ignore */ nestedCountersInstance.countEvent('repair2', `ABORT no covered keys  ${utils.stringifyReduce(allKeys)} tx:${shortHash} cycle:${this.stateManager.currentCycleShardData.cycleNumber}`)
      }

      // STEP 2: repear account if needed
      for (let key of uniqueKeys) {
        let shortKey = utils.stringifyReduce(key)
        if (requestObjects[key] != null) {
          let requestObject = requestObjects[key]

          if (requestObject == null) {
            /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note2', `${shortHash}`, `requestObject == null  acc:${shortKey}`)
            continue
          }

          let node = requestObject.nodeShardInfo.node
          if (node == null) {
            /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`shrd_repairToMatchReceipt2 node == null ${utils.stringifyReduce(requestObject.accountId)}`)
            /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note2', `${shortHash}`, `node == null  acc:${shortKey}`)
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
                /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`shrd_repairToMatchReceipt2 while(node == null) look for other node txId. idx:${alternateIndex} txid: ${utils.stringifyReduce(requestObject.appliedVote.txid)} alts: ${utils.stringifyReduce(requestObject.alternates)}  acc:${shortKey}`)
                //find alternate
                if (alternateIndex >= requestObject.alternates.length) {
                  this.statemanager_fatal(
                    `repairToMatchReceipt2_1`,
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
                      `repairToMatchReceipt2_2`,
                      `ASK FAIL repairToMatchReceipt making attempt #${
                        outerloopCount + 1
                      }   tx:${shortHash}  acc:${shortKey}`
                    )
                    break
                  } else {
                    /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`repairToMatchReceipt2 FAILED out of attempts #${outerloopCount + 1} tx:${shortHash}  acc:${shortKey}`)
                    this.statemanager_fatal(
                      `repairToMatchReceipt2_3`,
                      `ASK FAIL repairToMatchReceipt FAILED out of attempts   tx:${shortHash}  acc:${shortKey}`
                    )
                    return false
                  }
                }
                let altId = requestObject.alternates[alternateIndex]
                let nodeShardInfo: StateManagerTypes.shardFunctionTypes.NodeShardData =
                  this.stateManager.currentCycleShardData.nodeShardDataMap.get(altId)
                if (nodeShardInfo != null) {
                  node = nodeShardInfo.node
                  /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`shrd_repairToMatchReceipt2 got alt source node: idx:${alternateIndex} txid: ${utils.stringifyReduce(requestObject.appliedVote.txid)} alts: ${utils.stringifyReduce(node.id)}  acc:${shortKey}`)
                } else {
                  /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`shrd_repairToMatchReceipt2 nodeShardInfo == null for ${utils.stringifyReduce(altId)}  tx:${shortHash}  acc:${shortKey}`)
                }
                alternateIndex++
              }

              if (node == null) {
                this.statemanager_fatal(
                  `repairToMatchReceipt2_4`,
                  `ASK FAIL repairToMatchReceipt node == null in list. #${
                    outerloopCount + 1
                  }  tx:${shortHash}  acc:${shortKey}`
                )
                node = null
                break
              }

              let relationString = '' //ShardFunctions.getNodeRelation(homeNodeShardData, this.stateManager.currentCycleShardData.ourNode.id)
              /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt2_ask', `${shortHash}`, `r:${relationString}   asking: ${utils.makeShortHash(node.id)} AccountsMissing:${utils.stringifyReduce(allKeys)}  acc:${shortKey}`)

              if (outerloopCount < 2) {
                // Node Precheck!
                if (
                  this.stateManager.isNodeValidForInternalMessage(
                    node.id,
                    'repairToMatchReceipt2',
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
                  /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`Fix Worked: repairToMatchReceipt2. already have latest ${utils.makeShortHash(requestObject.accountId)} cache:${utils.stringifyReduce(accountMemData)}`)
                  attemptsRemaining = false
                  continue
                }
              }

              requestsMade++
              let message = {
                key: requestObject.accountId,
                hash: requestObject.accountHash,
                txid: txID,
                timestamp: timestamp,
              }
              let result: RequestStateForTxResp = await this.p2p.ask(
                node,
                'request_state_for_tx_post',
                message
              ) // not sure if we should await this.

              if (result == null) {
                if (logFlags.verbose) {
                  /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`ASK FAIL repairToMatchReceipt2 request_state_for_tx_post result == null tx:${shortHash}  acc:${shortKey}`)
                }
                // We shuffle the array of votes each time so hopefully will ask another node next time
                // TODO more robust limits to this process, maybe a delay?
                /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`ASK FAIL repairToMatchReceipt2 request_state_for_tx_post no reponse from ${utils.stringifyReduce(node.id)}  tx:${shortHash}  acc:${shortKey}`)
                //this.fatalLogger.fatal(`ASK FAIL repairToMatchReceipt missing logic to ask a new node! 1 ${utils.stringifyReduce(node.id)}`)
                node = null
                responseFails++
                continue
              }

              if (result.success !== true) {
                /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`ASK FAIL repairToMatchReceipt2 result.success === ${result.success}   tx:${shortHash}  acc:${shortKey}`)
                //this.fatalLogger.fatal(`ASK FAIL repairToMatchReceipt missing logic to ask a new node! 2 ${utils.stringifyReduce(node.id)}`)
                node = null
                responseFails++
                continue
              }

              let dataCountReturned = 0
              let accountIdsReturned = []
              for (let data of result.stateList) {
                if (updatedAccounts[data.accountId]) {
                  //already updated so skip
                  continue
                }

                // let shortKey = utils.stringifyReduce(data.accountId)
                dataRecieved++

                /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt2_note', `${shortHash}`, `write data: ${utils.stringifyReduce(data)}  acc:${shortKey}`)
                //Commit the data
                let dataToSet = [data]
                let failedHashes = await this.stateManager.checkAndSetAccountData(
                  dataToSet,
                  `tx:${shortHash} repairToMatchReceipt2`,
                  false
                )

                if (failedHashes.length === 0) {
                  dataApplied++
                  updatedAccounts[data.accountId] = true
                } else {
                  failedHash++
                  this.statemanager_fatal(
                    `repairToMatchReceipt_failedhash`,
                    ` tx:${shortHash}  failed:${failedHashes[0]} acc:${shortKey}`
                  )
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
                    /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`repairToMatchReceipt2:  got before data tx: ${shortHash} acc: ${utils.stringifyReduce(data.accountId)} data: ${beforeDataString}`)
                  }
                }
                if (beforeData == null) {
                  let results = await this.app.getAccountDataByList([data.accountId])
                  beforeData = results[0]
                  /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`repairToMatchReceipt2: statsDataSummaryUpdate2 beforeData: had to query for data 1 ${utils.stringifyReduce(data.accountId)}  tx:${shortHash}  acc:${shortKey}`)
                  if (beforeData == null) {
                    /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`repairToMatchReceipt2: statsDataSummaryUpdate2 beforeData: had to query for data 1 not found ${utils.stringifyReduce(data.accountId)}  tx:${shortHash}  acc:${shortKey}`)
                  }
                }
                if (beforeData == null) {
                  /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`repairToMatchReceipt2: statsDataSummaryUpdate2 beforeData data is null ${utils.stringifyReduce(data.accountId)} WILL CAUSE DATA OOS  tx:${shortHash}  acc:${shortKey}`)
                } else {
                  // USEDEFAULT=checkAndSetAccountData for stats.  (search USEDEFAULT for more context)
                  // if (this.stateManager.partitionStats.hasAccountBeenSeenByStats(data.accountId) === false) {
                  //   // Init stats because we have not seen this account yet.
                  //   this.stateManager.partitionStats.statsDataSummaryInitRaw(cycleToRecordOn, data.accountId, beforeData, 'repairToMatchReceipt2')
                  // }

                  // important to update the timestamp.  There are various reasons it could be incorrectly set to 0
                  let { timestamp: updatedTimestamp, hash: updatedHash } =
                    this.app.getTimestampAndHashFromAccount(data.data)
                  if (data.timestamp != updatedTimestamp) {
                    /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`repairToMatchReceipt2: statsDataSummaryUpdate2 timstamp had to be corrected from ${data.timestamp} to ${updatedTimestamp}   tx:${shortHash}  acc:${shortKey} hash:${utils.stringifyReduce(updatedHash)} `)
                  }
                  // This is correcting the timestamp on the wrapper
                  data.timestamp = updatedTimestamp

                  // USEDEFAULT=checkAndSetAccountData for stats. (search USEDEFAULT for more context)
                  //this.stateManager.partitionStats.statsDataSummaryUpdate2(cycleToRecordOn, beforeData, data, 'repairToMatchReceipt2')

                  // record state table data
                  let { timestamp: oldtimestamp, hash: oldhash } =
                    this.app.getTimestampAndHashFromAccount(beforeData)

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
                  if (isGlobal === false) {
                    let hash = this.stateManager.accountCache.getAccountHash(data.accountId)
                    test4 = hash.h === updatedHash
                  }

                  if (updateStateTable === true) {
                    await this.storage.addAccountStates(stateTableResults)
                  }

                  //update hash
                  //data.stateId = updatedHash

                  updatedAccountAndHashes.push({ accountID: data.accountId, hash: data.stateId })

                  /*if (logFlags.debug)*/ this.mainLogger.debug(
                    `repairToMatchReceipt2: addAccountStates tx:${shortHash} neededUpdate:${hashNeededUpdate} updateStateTable:${updateStateTable} timeStampMatches:${timeStampMatches} test2:${test2} test3:${test3} test4:${test4} ${utils.stringifyReduce(
                      stateTableResults
                    )}  acc:${shortKey}`
                  )
                }
              }

              /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt2_result', `${shortHash}`, `r:${relationString}   result: dataCount:${dataCountReturned} asking: ${utils.makeShortHash(node.id)}   AccountsMissing:${utils.stringifyReduce(allKeys)} AccountsReturned:${utils.stringifyReduce(accountIdsReturned)}`)

              if (outerloopCount > 1) {
                this.statemanager_fatal(
                  `repairToMatchReceipt2_5ok`,
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
      if (neededUpdate === updatedAccountsCount) {
        repairFinished = true
      }

      let skippedKeys = []
      if (updatedAccounts != null) {
        for (let key of allKeys) {
          if (updatedAccounts[key] != true) {
            skippedKeys.push(key)
          }
        }
      } else {
        skippedKeys = allKeys
      }

      if (Object.keys(skippedKeys).length > 0 && dataApplied < neededUpdate) {
        this.statemanager_fatal(
          `repairToMatchReceiptNoRecipt_tempSkippedKeys`,
          `counters:${utils.stringifyReduce({
            missingTXFound,
            requestObjectCount,
            requestsMade,
            responseFails,
            dataRecieved,
            dataApplied,
            failedHash,
            neededUpdate,
            upToDateCount,
            updatedAccountsCount,
          })} keys ${utils.stringifyReduce(allKeys)} skipped ${utils.stringifyReduce(skippedKeys)}  `
        )
      }

      if (repairFinished == false) {
        this.statemanager_fatal(
          `repairToMatchReceiptNoRecipt_failed`,
          `counters:${utils.stringifyReduce({
            missingTXFound,
            requestObjectCount,
            requestsMade,
            responseFails,
            dataRecieved,
            dataApplied,
            failedHash,
            neededUpdate,
            upToDateCount,
            updatedAccountsCount,
          })} keys ${utils.stringifyReduce(allKeys)}  skipped ${utils.stringifyReduce(skippedKeys)} `
        )
        nestedCountersInstance.countEvent('repair2', 'complete-failed')
      } else {
        let repairLogString = `tx:${shortHash} updatedAccountAndHashes:${utils.stringifyReduce(
          updatedAccountAndHashes
        )} counters:${utils.stringifyReduce({
          missingTXFound,
          requestObjectCount,
          requestsMade,
          responseFails,
          dataRecieved,
          dataApplied,
          failedHash,
          neededUpdate,
          upToDateCount,
          updatedAccountsCount,
        })}`
        /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_success2', shortHash, repairLogString)
        this.mainLogger.debug('shrd_repairToMatchReceipt_success2 ' + repairLogString)

        nestedCountersInstance.countEvent('repair2', `complete-ok`)
        /* prettier-ignore */ nestedCountersInstance.countEvent('repair2', `s.repair applied cycle: ${this.stateManager.currentCycleShardData.cycleNumber}`)
      }

      this.profiler.profileSectionEnd('repair2')
    }
  }

  async requestMissingTX(txID: string, refAccountId: string): Promise<RequestTxResp | null> {
    if (this.stateManager.currentCycleShardData == null) {
      return null
    }

    let shortID = utils.stringifyReduce(txID)
    if (logFlags.playback) this.logger.playbackLogNote('requestMissingTX_start', txID, ``)

    // will have to just ask node that cover our shard!

    let timestamp = 0

    let queryGroup: Shardus.Node[] = []

    // get nodes for address
    let homeNode = ShardFunctions.findHomeNode(
      this.stateManager.currentCycleShardData.shardGlobals,
      refAccountId,
      this.stateManager.currentCycleShardData.parititionShardDataMap
    )
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
      if (
        this.stateManager.isNodeValidForInternalMessage(node.id, 'requestMissingTX', true, true) === false
      ) {
        continue
      }

      let message = { txid: txID }
      let result: RequestTxResp = await this.p2p.ask(node, 'request_tx_and_state', message)

      if (result == null) {
        if (logFlags.verbose) {
          /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`ASK FAIL request_tx_and_state ${triesLeft} ${utils.makeShortHash(node.id)}`)
        }
        /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_requestMissingTX_askfailretry', `${shortID}`, `asking: ${utils.makeShortHash(node.id)}`)
        continue
      }
      if (result.success !== true) {
        /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`ASK FAIL requestMissingTX 9 ${triesLeft} ${utils.makeShortHash(node.id)}:${utils.makeShortHash(node.internalPort)} note:${result.note} tx:${shortID}`)
        continue
      }

      /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_requestMissingTX_result', `${shortID}`, `asking: ${utils.makeShortHash(node.id)} result: ${utils.stringifyReduce(result)}`)

      if (result.success === true) {
        keepTrying = false
        gotReceipt = true

        /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`requestMissingTX got good receipt for: ${shortID} from: ${utils.makeShortHash(node.id)}:${utils.makeShortHash(node.internalPort)}`)

        return result
      }
    }
    return null
  }

  async requestMissingReceipt(
    txID: string,
    timestamp: number,
    refAccountId: string
  ): Promise<RequestReceiptForTxResp | null> {
    if (this.stateManager.currentCycleShardData == null) {
      return null
    }

    let shortID = utils.stringifyReduce(txID)
    if (logFlags.playback) this.logger.playbackLogNote('requestMissingReceipt', txID, ``)

    // will have to just ask node that cover our shard!
    let queryGroup: Shardus.Node[] = []

    // get nodes for address
    let homeNode = ShardFunctions.findHomeNode(
      this.stateManager.currentCycleShardData.shardGlobals,
      refAccountId,
      this.stateManager.currentCycleShardData.parititionShardDataMap
    )
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
      if (
        this.stateManager.isNodeValidForInternalMessage(node.id, 'requestMissingReceipt', true, true) ===
        false
      ) {
        continue
      }

      let message = { txid: txID, timestamp }
      let result: RequestReceiptForTxResp = await this.p2p.ask(node, 'request_receipt_for_tx', message) // not sure if we should await this.

      if (result == null) {
        if (logFlags.verbose) {
          /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`ASK FAIL request_tx_and_state ${triesLeft} ${utils.makeShortHash(node.id)}`)
        }
        /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_requestMissingReceipt_askfailretry', `${shortID}`, `asking: ${utils.makeShortHash(node.id)}`)
        continue
      }
      if (result.success !== true) {
        /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`ASK FAIL requestMissingReceipt 9 ${triesLeft} ${utils.makeShortHash(node.id)}:${utils.makeShortHash(node.internalPort)} note:${result.note} tx:${shortID}`)
        continue
      }

      /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_requestMissingReceipt_result', `${shortID}`, `asking: ${utils.makeShortHash(node.id)} result: ${utils.stringifyReduce(result)}`)

      if (result.success === true) {
        keepTrying = false
        gotReceipt = true

        /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`requestMissingReceipt got good receipt for: ${shortID} from: ${utils.makeShortHash(node.id)}:${utils.makeShortHash(node.internalPort)}`)
        return result
      }
    }
    return null
  }
}

export default TransactionRepair
