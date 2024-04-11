import * as Shardus from '../shardus/shardus-types'
import { StateManager as StateManagerTypes } from '@shardus/types'
import * as utils from '../utils'

import Profiler from '../utils/profiler'
import { P2PModuleContext as P2P } from '../p2p/Context'
import Storage from '../storage'
import Crypto from '../crypto'
import Logger, { logFlags } from '../logger'
import ShardFunctions from './shardFunctions'
import StateManager from '.'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { QueueEntry, AppliedVote, AccountHashCache, RequestStateForTxResp } from './state-manager-types'
import { Logger as log4jsLogger } from 'log4js'
import { RequestStateForTxPostReq, serializeRequestStateForTxPostReq } from '../types/RequestStateForTxPostReq'
import { RequestStateForTxPostResp, deserializeRequestStateForTxPostResp } from '../types/RequestStateForTxPostResp'
import { InternalRouteEnum } from '../types/enum/InternalRouteEnum'

class TransactionRepair {
  app: Shardus.App
  crypto: Crypto
  config: Shardus.StrictServerConfiguration
  profiler: Profiler

  logger: Logger
  p2p: P2P
  storage: Storage
  stateManager: StateManager

  mainLogger: log4jsLogger
  fatalLogger: log4jsLogger
  shardLogger: log4jsLogger
  statsLogger: log4jsLogger
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

  async repairToMatchReceipt(queueEntry: QueueEntry): Promise<void> {
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
    const updatedAccountAndHashes = []
    const localUpdatedAccountAndHashes = []

    //let localAccUsed = 0
    //let localAccSkipped = 0
    //let skipNonStored = 0

    const stats = {
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

    const allKeys = []
    const repairFix = true
    let keysList = []
    const voteHashMap: Map<string, string> = new Map()
    const localReadyRepairs: Map<string, Shardus.WrappedResponse> = new Map()

    const nonStoredKeys = []

    try {
      this.stateManager.dataRepairsStarted++

      this.profiler.profileSectionStart('repair')
      this.profiler.profileSectionStart('repair_init')

      if (queueEntry.didSync) {
        nestedCountersInstance.countEvent('repair1', 'init-didSync')
      } else {
        nestedCountersInstance.countEvent('repair1', 'init-normal')
      }

      const txLogID = queueEntry.logID // queueEntry.logID
      // Need to build a list of what accounts we need, what state they should be in and who to get them from
      const requestObjects: {
        [id: string]: {
          appliedVote: AppliedVote
          voteIndex: number
          accountHash: string
          accountId: string
          nodeShardInfo: StateManagerTypes.shardFunctionTypes.NodeShardData
          alternates: string[]
        }
      } = {}
      
      const receivedReceipt = queueEntry?.appliedReceiptForRepair2
      if(!receivedReceipt) {
        nestedCountersInstance.countEvent('repair1', 'receivedReceipt is falsy')
        return
      }
      const appliedVote = queueEntry?.appliedReceiptForRepair2?.appliedVote
      if(!appliedVote) {
        nestedCountersInstance.countEvent('repair1', 'appliedVote is falsy')
        /* prettier-ignore */  if (logFlags.debug) this.mainLogger.debug(`appliedVote is undefined for queueEntry: ${JSON.stringify(queueEntry)}`)
        return
      }

      const voters = queueEntry.appliedReceiptForRepair2.signatures
      //shuffle the array
      utils.shuffleArray(voters)

      if (queueEntry.ourVoteHash != null) {
        if (
          queueEntry.ourVoteHash ===
          this.stateManager.transactionConsensus.calculateVoteHash(
            queueEntry.appliedReceiptForRepair2.appliedVote
          )
        ) {
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

      /* prettier-ignore */ if (logFlags.debug || this.stateManager.consensusLog) this.mainLogger.debug(`repairToMatchReceipt: ${txLogID} queueEntry.uniqueKeys ${utils.stringifyReduce(queueEntry.uniqueKeys)}`)

      // Build a request object for each key involved.
      // once we have a valid request object add in alternate nodes we could use as a backup

      const upToDateAccounts: { [id: string]: boolean } = {}

      this.profiler.profileSectionEnd('repair_init')

      //TODO!! figure out if we need to check shard data from different cycle!!!
      //there are several place like this in the code. search for testAddressInRange
      const nodeShardData: StateManagerTypes.shardFunctionTypes.NodeShardData =
        this.stateManager.currentCycleShardData.nodeShardData

      for (let i = 0; i < appliedVote.account_id.length; i++) {
        /* eslint-disable security/detect-object-injection */
        const accountID = appliedVote.account_id[i]
        //only check for stored keys.  TODO task. make sure nodeShardData is from correct cycle!
        //TODO is there a better way/time to build this knowlege set?
        if (ShardFunctions.testAddressInRange(accountID, nodeShardData.storedPartitions) === false) {
          stats.skipNonStored++
          nonStoredKeys.push(accountID)
          continue
        }

        voteHashMap.set(appliedVote.account_id[i], appliedVote.account_state_hash_after[i])
        /* eslint-enable security/detect-object-injection */
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
        const applyResponse = queueEntry?.preApplyTXResult?.applyResponse
        if (applyResponse != null) {
          if (applyResponse.accountWrites != null && applyResponse.accountWrites.length > 0) {
            for (const writtenAccount of applyResponse.accountWrites) {
              const key = writtenAccount.accountId
              const shortKey = utils.stringifyReduce(key)
              const goalHash = voteHashMap.get(key)
              const data = writtenAccount.data
              const hashObj = this.stateManager.accountCache.getAccountHash(key)

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

                const dataToSet = [data]
                const failedHashes = await this.stateManager.checkAndSetAccountData(
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
                  /* prettier-ignore */ if (logFlags.error) this.statemanager_fatal(
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
      for (const key of keysList) {
        stats.rLoop1++

        if (localReadyRepairs.has(key)) {
          stats.localAccSkipped++
          continue //can skip this data, we already have it
        }

        let coveredKey = false
        const isGlobal = this.stateManager.accountGlobals.isGlobalAccount(key)
        const shortKey = utils.stringifyReduce(key)
        const eligibleNodeIdMap: any = {}
        if (this.stateManager.transactionQueue.useNewPOQ === false) {
          for (let i = 0; i < voters.length; i++) {
            const voter = voters[i]
            const node = this.stateManager.p2p.state.getNodeByPubKey(voter.owner)
            if (node == null) {
              continue
            }
            eligibleNodeIdMap[node.id] = true
          }
        } else {
          // loop through topConfirmations and add to eligibleNodeIdMap
          for (const nodeId of queueEntry.topConfirmations) {
            eligibleNodeIdMap[nodeId] = true
          }
          eligibleNodeIdMap[receivedReceipt.confirmOrChallenge.nodeId] = true
          eligibleNodeIdMap[receivedReceipt.appliedVote.node_id] = true
        }
        const eligibleNodeIdsArray = Object.keys(eligibleNodeIdMap)
        utils.shuffleArray(eligibleNodeIdsArray)
        const eligibleNodeIds = new Set(eligibleNodeIdsArray)
        this.mainLogger.debug(`repairToMatchReceipt: ${txLogID} eligibleNodeIds ${eligibleNodeIds.size} && eligibleNodeIdMap ${Object.keys(eligibleNodeIdMap).length}`)

        nestedCountersInstance.countEvent('repair1', `eligibleNodeIds: ${eligibleNodeIds.size}`)

        //It modifying global.
        for (const node_id of eligibleNodeIds) {
          /* eslint-disable security/detect-object-injection */
          stats.rLoop2++
          for (let j = 0; j < appliedVote.account_id.length; j++) {
            stats.rLoop3++
            const accountId = appliedVote.account_id[j]
            const hash = appliedVote.account_state_hash_after[j]
            if (accountId === key && hash != null) {
              if (upToDateAccounts[accountId] === true) {
                continue
              }

              const hashObj = this.stateManager.accountCache.getAccountHash(key)
              if (hashObj != null) {
                // eslint-disable-next-line security/detect-possible-timing-attacks
                if (hashObj.h === hash) {
                  upToDateAccounts[accountId] = true
                  stats.numUpToDateAccounts++
                  /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${txLogID}`, `account ${shortKey} already up to date our: cached:${utils.stringifyReduce(hashObj)}`)
                  break
                }
              }
              /* eslint-enable security/detect-object-injection */
              if (repairFix) {
                if (hashObj != null && hashObj.t > queueEntry.acceptedTx.timestamp) {
                  nestedCountersInstance.countEvent('repair1', 'skip account repair, we have a newer copy')
                  continue
                }
              }
              /* eslint-disable security/detect-object-injection */
              if (requestObjects[key] != null) {
                //todo perf delay these checks for jit.
                if (node_id !== this.stateManager.currentCycleShardData.ourNode.id) {
                  if (this.stateManager.currentCycleShardData.nodeShardDataMap.has(node_id) === true) {
                    //build a list of alternates
                    requestObjects[key].alternates.push(node_id)
                  }
                }
                /* eslint-enable security/detect-object-injection */
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
              // if (node_id !== receivedReceipt.appliedVote.node_id && node_id !== receivedReceipt.confirmOrChallenge.nodeId) {
              //   //dont reference our own node, should not happen anyway
              //   /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${txLogID}`, `node_id is neither a voted node nor confirmation node ${utils.stringifyReduce(node_id)} our: ${utils.stringifyReduce(this.stateManager.currentCycleShardData.ourNode.id)} acc:${shortKey}`)
              //   nestedCountersInstance.countEvent('repair1', 'skip account repair, not a voted or confirmation node')
              //   continue
              // }
              const nodeShardInfo: StateManagerTypes.shardFunctionTypes.NodeShardData =
                this.stateManager.currentCycleShardData.nodeShardDataMap.get(node_id)

              if (nodeShardInfo == null) {
                /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`shrd_repairToMatchReceipt nodeShardInfo == null ${utils.stringifyReduce(node_id)} tx:${txLogID} acc:${shortKey}`)
                /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${txLogID}`, `nodeShardInfo == null ${utils.stringifyReduce(node_id)}  acc:${shortKey}`)
                continue
              }

              //only need to check for account being in range if the node is not in the execution group?
              if (queueEntry.executionGroupMap.has(node_id) === false) {
                // if the account is not global check if it is in range.
                if (
                  isGlobal === false &&
                  ShardFunctions.testAddressInRange(accountId, nodeShardInfo.storedPartitions) == false
                ) {
                  /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${txLogID}`, `address not in range ${utils.stringifyReduce(nodeShardInfo.storedPartitions)}  acc:${shortKey}`)
                  stats.rangeErr++
                  continue
                }
              }

              const objectToSet = {
                appliedVote,
                voteIndex: j,
                accountHash: hash,
                accountId: accountId,
                nodeShardInfo,
                alternates: [],
              }
              this.mainLogger.debug(`repairToMatchReceipt: ${txLogID} node_id ${node_id} is selected as source node. ${utils.stringifyReduce(receivedReceipt)}`)
              /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${txLogID}`, `setting key ${utils.stringifyReduce(key)} ${utils.stringifyReduce(objectToSet)}  acc:${shortKey}`)
              // eslint-disable-next-line security/detect-object-injection
              requestObjects[key] = objectToSet
              allKeys.push(key)
              stats.requestObjectCount++
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
      for (const key of allKeys) {
        /* eslint-disable security/detect-object-injection */
        const shortKey = utils.stringifyReduce(key)
        if (requestObjects[key] != null) {
          const requestObject = requestObjects[key]
          /* eslint-enable security/detect-object-injection */
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
                  /* prettier-ignore */ if (logFlags.error) this.statemanager_fatal(
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
                    /* prettier-ignore */ if (logFlags.error) this.statemanager_fatal(
                      `repairToMatchReceipt_2`,
                      `ASK FAIL repairToMatchReceipt making attempt #${
                        outerloopCount + 1
                      }   tx:${txLogID}  acc:${shortKey}`
                    )
                    break
                  } else {
                    /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`repairToMatchReceipt FAILED out of attempts #${outerloopCount + 1} tx:${txLogID}  acc:${shortKey}`)
                    /* prettier-ignore */ if (logFlags.error) this.statemanager_fatal(
                      `repairToMatchReceipt_3`,
                      `ASK FAIL repairToMatchReceipt FAILED out of attempts   tx:${txLogID}  acc:${shortKey}`
                    )
                    nestedCountersInstance.countEvent('repair1', 'failed out of attempts')
                    return
                  }
                }
                // eslint-disable-next-line security/detect-object-injection
                const altId = requestObject.alternates[alternateIndex]
                const nodeShardInfo: StateManagerTypes.shardFunctionTypes.NodeShardData =
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
                /* prettier-ignore */ if (logFlags.error) this.statemanager_fatal(
                  `repairToMatchReceipt_4`,
                  `ASK FAIL repairToMatchReceipt node == null in list. #${
                    outerloopCount + 1
                  }  tx:${txLogID}  acc:${shortKey}`
                )
                node = null
                break
              }

              const relationString = '' //ShardFunctions.getNodeRelation(homeNodeShardData, this.stateManager.currentCycleShardData.ourNode.id)
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
                const accountMemData: AccountHashCache = this.stateManager.accountCache.getAccountHash(
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
                const message = {
                  key: requestObject.accountId,
                  hash: requestObject.accountHash,
                  txid: queueEntry.acceptedTx.txId,
                  timestamp: queueEntry.acceptedTx.timestamp,
                }

                if (
                  this.config.p2p.useBinarySerializedEndpoints &&
                  this.config.p2p.requestStateForTxPostBinary
                ) {
                  const request = message as RequestStateForTxPostReq
                  result = await this.p2p.askBinary<RequestStateForTxPostReq, RequestStateForTxPostResp>(
                    node,
                    InternalRouteEnum.binary_request_state_for_tx_post,
                    request,
                    serializeRequestStateForTxPostReq,
                    deserializeRequestStateForTxPostResp,
                    {}
                  )
                } else {
                  result = await this.p2p.ask(node, 'request_state_for_tx_post', message) // not sure if we should await this.
                }
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
              const dataCountReturned = 0
              const accountIdsReturned = []
              for (const data of result.stateList) {
                try {
                  stats.dataRecieved++
                  this.profiler.profileSectionStart('repair_saving_account_data')
                  nestedCountersInstance.countEvent('repair1', 'saving')
                  // let shortKey = utils.stringifyReduce(data.accountId)

                  //cycleToRecordOn = this.stateManager.getCycleNumberFromTimestamp(timestamp)

                  /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_note', `${txLogID}`, `write data: ${utils.stringifyReduce(data)}  acc:${shortKey}`)

                  if (repairFix) {
                    //some temp checking.  A just in time check to see if we dont need to save this account.
                    const hashObj = this.stateManager.accountCache.getAccountHash(key)
                    if (hashObj != null && hashObj.t > data.timestamp) {
                      /* prettier-ignore */ nestedCountersInstance.countEvent('repair1', 'skip account repair 2, we have a newer copy')
                      continue
                    }
                  }

                  if (data.stateId !== requestObject.accountHash) {
                    nestedCountersInstance.countEvent('repair1', 'skip account repair 3, stateId mismatch')
                    /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`repairToMatchReceipt: ${txLogID} data.stateId !== requestObject.accountHash  tx:${txLogID}  acc:${shortKey} data.stateId:${data.stateId}, requestObj.accountHash: ${requestObject.accountHash}`)
                    continue
                  }

                  //Commit the data
                  const dataToSet = [data]
                  const failedHashes = await this.stateManager.checkAndSetAccountData(
                    dataToSet,
                    `tx:${txLogID} repairToMatchReceipt`,
                    true
                  )

                  if (failedHashes.length === 0) {
                    stats.dataApplied++
                    /* prettier-ignore */ nestedCountersInstance.countEvent('repair1', `q.repair applied cycle: ${this.stateManager.currentCycleShardData.cycleNumber}`)
                  } else {
                    stats.failedHash++
                    /* prettier-ignore */ if (logFlags.error) this.statemanager_fatal(
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
                    const wrappedAccountDataBefore = queueEntry.collectedData[data.accountId]
                    if (wrappedAccountDataBefore != null) {
                      beforeData = wrappedAccountDataBefore.data
                    }
                  }
                  if (beforeData == null) {
                    nestedCountersInstance.countEvent('repair1', 'getAccountDataByList')
                    const results = await this.app.getAccountDataByList([data.accountId])
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
                    const { timestamp: updatedTimestamp, hash: updatedHash } =
                      this.app.getTimestampAndHashFromAccount(data.data)
                    if (data.timestamp != updatedTimestamp) {
                      /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`repairToMatchReceipt: statsDataSummaryUpdate2 timstamp had to be corrected from ${data.timestamp} to ${updatedTimestamp}   tx:${txLogID}  acc:${shortKey} hash:${utils.stringifyReduce(updatedHash)} `)
                    }
                    // This is correcting the timestamp on the wrapper
                    data.timestamp = updatedTimestamp

                    // USEDEFAULT=checkAndSetAccountData for stats.  (search USEDEFAULT for more context)
                    // this.stateManager.partitionStats.statsDataSummaryUpdate2(queueEntry.cycleToRecordOn, beforeData, data, 'repairToMatchReceipt')

                    // record state table data
                    let { hash: oldhash } = this.app.getTimestampAndHashFromAccount(beforeData)

                    const hashNeededUpdate = oldhash !== result.beforeHashes[data.accountId]
                    oldhash = result.beforeHashes[data.accountId]

                    const stateTableResults: Shardus.StateTableObject = {
                      accountId: data.accountId,
                      txId: queueEntry.acceptedTx.txId,
                      stateBefore: oldhash,
                      stateAfter: updatedHash,
                      txTimestamp: `${updatedTimestamp}`,
                    }

                    let updateStateTable = true
                    const timeStampMatches = updatedTimestamp === queueEntry.acceptedTx.timestamp
                    let test2 = false
                    if (timeStampMatches === false) {
                      if (this.stateManager.accountGlobals.isGlobalAccount(data.accountId)) {
                        updateStateTable = false
                        test2 = true
                      }
                    }

                    const isGlobal = this.stateManager.accountGlobals.isGlobalAccount(data.accountId)
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
                      const hash = this.stateManager.accountCache.getAccountHash(data.accountId)

                      // eslint-disable-next-line security/detect-possible-timing-attacks
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

                    /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug( `repairToMatchReceipt: addAccountStates tx:${txLogID} neededUpdate:${hashNeededUpdate} updateStateTable:${updateStateTable} timeStampMatches:${timeStampMatches} test2:${test2} test3:${test3} test4:${test4} branch4:${branch4} ${utils.stringifyReduce( stateTableResults )} acc:${shortKey}` )
                  }
                } finally {
                  this.profiler.profileSectionEnd('repair_saving_account_data')
                }
              }

              /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_result', `${txLogID}`, `r:${relationString}   result:${queueEntry.logstate} dataCount:${dataCountReturned} asking: ${utils.makeShortHash(node.id)} qId: ${queueEntry.entryID}  AccountsMissing:${utils.stringifyReduce(allKeys)} AccountsReturned:${utils.stringifyReduce(accountIdsReturned)}`)

              if (outerloopCount > 1) {
                /* prettier-ignore */ if (logFlags.important_as_error) this.statemanager_fatal(
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
        const badHashKeys = []
        const noHashKeys = []
        for (const key of keysList) {
          const hashObj = this.stateManager.accountCache.getAccountHash(key)
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

        // console.log(
        //   'REPAIR FINISHED isInExecutionHome',
        //   queueEntry.acceptedTx.txId,
        //   queueEntry.isInExecutionHome
        // )
        // console.log('REPAIR FINISHED', queueEntry.acceptedTx.txId, queueEntry)
        if (queueEntry.isInExecutionHome === true) {
          if (queueEntry.preApplyTXResult && queueEntry.preApplyTXResult.applyResponse) {
            // Temp solution to forward the receipt to the subscribed archivers although it has to be repaired
            // This still needs checking of the our votehash matches with the winning votehash or our appReceiptDataHash matches with the winning appReceiptDataHash
            if (
              queueEntry.ourVoteHash &&
              queueEntry.appliedReceiptForRepair2 &&
              queueEntry.appliedReceiptForRepair2.appliedVote
            )
              if (
                queueEntry.ourVoteHash === this.crypto.hash(queueEntry.appliedReceiptForRepair2.appliedVote)
              ) {
                if (this.config.p2p.experimentalSnapshot)
                  if (logFlags.verbose)
                    console.log('repair commit', queueEntry.acceptedTx.txId, queueEntry.acceptedTx.timestamp)
                  this.stateManager.transactionQueue.addReceiptToForward(queueEntry, 'repair')
              }
          }
        }

        const repairLogString = `tx:${queueEntry.logID} updatedAccountAndHashes:${utils.stringifyReduce(
          updatedAccountAndHashes
        )}  localUpdatedAccountAndHashes:${utils.stringifyReduce(localUpdatedAccountAndHashes)} state:${
          queueEntry.state
        } counters:${utils.stringifyReduce(stats)}`
        /* prettier-ignore */ if (logFlags.playback) this.logger.playbackLogNote('shrd_repairToMatchReceipt_success', queueEntry.logID, repairLogString)
        /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug('shrd_repairToMatchReceipt_success ' + repairLogString)
        nestedCountersInstance.countEvent('repair1', 'success')
        /* prettier-ignore */ nestedCountersInstance.countEvent('repair1', `success: req:${stats.requestsMade} apl:${stats.dataApplied} localAccUsed:${stats.localAccUsed} localAccSkipped:${stats.localAccSkipped} key count:${voteHashMap.size} allGood:${allGood}`)
        nestedCountersInstance.countEvent('repair1', `success: key count:${voteHashMap.size}`)
        /* prettier-ignore */ nestedCountersInstance.countEvent('repair1', `success: state:${queueEntry.state} allGood:${allGood}`)
        /* prettier-ignore */ nestedCountersInstance.countEvent('repair1', `success: state:${queueEntry.state} allGood:${allGood} skipNonStored:${stats.skipNonStored}`)

        /* prettier-ignore */ if (logFlags.error && allGood === false) this.mainLogger.error(`repair1 success: req:${stats.requestsMade} apl:${stats.dataApplied} localAccUsed:${stats.localAccUsed} localAccSkipped:${stats.localAccSkipped} key count:${voteHashMap.size} allGood:${allGood} updatedAccountAndHashes:${utils.stringifyReduce(updatedAccountAndHashes)} localUpdatedAccountAndHashes:${utils.stringifyReduce(localUpdatedAccountAndHashes)} badHashKeys:${utils.stringifyReduce(badHashKeys)} noHashKeys:${utils.stringifyReduce(noHashKeys)} nonStoredKeys:${utils.stringifyReduce(nonStoredKeys)} keysList:${utils.stringifyReduce(keysList)} localReadyRepairs:${utils.stringifyReduce(localReadyRepairs.keys())} stats:${utils.stringifyReduce(stats)}`)
      } else {
        queueEntry.repairFailed = true
        /* prettier-ignore */ if (logFlags.error) this.statemanager_fatal(
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
}

export default TransactionRepair
