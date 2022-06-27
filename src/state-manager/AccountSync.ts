import * as Shardus from '../shardus/shardus-types'
import { StateManager as StateManagerTypes } from '@shardus/types'
import * as utils from '../utils'
const stringify = require('fast-stable-stringify')

import Profiler, { cUninitializedSize, profilerInstance } from '../utils/profiler'
import { P2PModuleContext as P2P } from '../p2p/Context'
import Storage from '../storage'
import Crypto from '../crypto'
import Logger, { logFlags } from '../logger'
import ShardFunctions from './shardFunctions.js'
import { time } from 'console'
import StateManager from '.'
import { isNullOrUndefined } from 'util'
import { robustQuery } from '../p2p/Utils'
import { nestedCountersInstance } from '../utils/nestedCounters'
import * as Context from '../p2p/Context'
import * as Wrapper from '../p2p/Wrapper'
import * as Self from '../p2p/Self'
import { potentiallyRemoved } from '../p2p/NodeList'
import { SyncTracker, SimpleRange, AccountStateHashReq, AccountStateHashResp, GetAccountStateReq, GetAccountData3Req, GetAccountDataByRangeSmart, GlobalAccountReportResp, GetAccountData3Resp, CycleShardData } from './state-manager-types'
import { safetyModeVals } from '../snapshot'
import { isDebugModeMiddleware } from '../network/debugMiddleware'
import { errorToStringFull } from '../utils'

const allZeroes64 = '0'.repeat(64)

type SyncStatment = {

  p2pJoinTime: number
  timeBeforeDataSync: number
  timeBeforeDataSync2: number
  totalSyncTime: number

  cycleStarted: number
  cycleEnded: number
  numCycles: number
  syncComplete: boolean
  numNodesOnStart: number

  syncStartTime: number
  syncEndTime: number
  syncSeconds: number
  syncRanges: number

  failedAccountLoops: number
  failedAccounts: number
  failAndRestart: number
  discardedTXs: number
  nonDiscardedTXs: number

  numSyncedState: number
  numAccounts: number
  numGlobalAccounts: number

  internalFlag: boolean // makes sure we dont write logs until two sections of async code have both been hit
}
class AccountSync {
  stateManager: StateManager
  app: Shardus.App
  crypto: Crypto
  config: Shardus.StrictServerConfiguration
  profiler: Profiler

  logger: Logger
  p2p: P2P
  storage: Storage

  mainLogger: any
  fatalLogger: any
  shardLogger: any
  statsLogger: any

  dataSyncMainPhaseComplete: boolean
  globalAccountsSynced: boolean
  isSyncingAcceptedTxs: boolean
  requiredNodeCount: number

  runtimeSyncTrackerSyncing: boolean

  syncTrackerIndex: number
  initalSyncRemaining: number

  readyforTXs: boolean

  syncTrackers: SyncTracker[]

  currentRange: SimpleRange
  addressRange: SimpleRange

  dataSourceNode: Shardus.Node
  dataSourceNodeList: Shardus.Node[]
  dataSourceNodeIndex: number

  combinedAccountData: Shardus.WrappedData[]
  accountsWithStateConflict: Shardus.WrappedData[] //{address:string}[] //Shardus.WrappedData[];

  stateTableForMissingTXs: { [accountID: string]: Shardus.StateTableObject }

  lastStateSyncEndtime: number

  failedAccounts: string[]
  missingAccountData: string[]

  mapAccountData: { [accountID: string]: Shardus.WrappedData }

  acceptedTXByHash: { [accountID: string]: string } //not sure if this is correct.  TODO where did this impl go!

  statemanager_fatal: (key: string, log: string) => void

  partitionStartTimeStamp: number

  combinedAccountStateData: Shardus.StateTableObject[]

  syncStatement: SyncStatment
  isSyncStatementCompleted: boolean

  softSync_earlyOut: boolean // exit inital sync early after globals are synced
  softSync_noSyncDelay: boolean // don't delay or TXs let them try to execute
  softSync_checkInitialFlag: boolean // check initalSyncFinished before we give hash reports on sync table data

  initalSyncFinished: boolean // track when we have completed our inital data sync.

  forceSyncComplete: boolean

  useStateTable: boolean
  forwardTXToSyncingNeighbors: boolean

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
    this.stateManager = stateManager

    this.crypto = crypto
    this.app = app
    this.logger = logger
    this.config = config
    this.profiler = profiler
    this.p2p = p2p
    this.storage = storage

    this.mainLogger = logger.getLogger('main')
    this.fatalLogger = logger.getLogger('fatal')
    this.shardLogger = logger.getLogger('shardDump')
    this.statsLogger = logger.getLogger('statsDump')

    this.statemanager_fatal = stateManager.statemanager_fatal

    this.dataSyncMainPhaseComplete = false
    this.globalAccountsSynced = false
    this.isSyncingAcceptedTxs = false

    this.syncTrackers = []
    this.runtimeSyncTrackerSyncing = false

    this.readyforTXs = false
    this.syncTrackerIndex = 1 // increments up for each new sync tracker we create gets maped to calls.

    this.acceptedTXByHash = {}

    this.clearSyncData()

    this.syncStatement = {
      cycleStarted: -1,
      cycleEnded: -1,
      numCycles: -1,
      syncComplete: false,
      numNodesOnStart: 0,
      p2pJoinTime: Self.p2pJoinTime,

      timeBeforeDataSync: 0,
      timeBeforeDataSync2: 0,
      totalSyncTime: 0,

      syncStartTime: 0,
      syncEndTime: 0,
      syncSeconds: 0,
      syncRanges: 0,

      failedAccountLoops: 0,
      failedAccounts: 0,
      failAndRestart: 0,

      discardedTXs: 0,
      nonDiscardedTXs: 0,

      numSyncedState: 0,
      numAccounts: 0,
      numGlobalAccounts: 0,

      internalFlag: false,
    }
    this.isSyncStatementCompleted = false

    this.softSync_earlyOut = false
    this.softSync_noSyncDelay = true
    this.softSync_checkInitialFlag = false

    this.initalSyncFinished = false
    this.initalSyncRemaining = 0

    this.forceSyncComplete = false

    this.useStateTable = false
    this.forwardTXToSyncingNeighbors = false

    console.log('this.p2p', this.p2p)
  }
  // ////////////////////////////////////////////////////////////////////
  //   DATASYNC
  // ////////////////////////////////////////////////////////////////////

  // this clears state data related to the current partion we are syncinge
  clearSyncData() {
    this.lastStateSyncEndtime = 0

    //this seems out of place need to review it.
    this.stateManager.fifoLocks = {}


    //PREP: THESE to become part of the sync range:
    this.addressRange = null    
    this.dataSourceNodeIndex = 0
    this.mapAccountData = {}
    this.dataSourceNode = null
    this.dataSourceNodeList = []
    this.accountsWithStateConflict = []
    this.combinedAccountData = []
    this.failedAccounts = []
  }

  /***
   *    ##     ##    ###    ##    ## ########  ##       ######## ########   ######
   *    ##     ##   ## ##   ###   ## ##     ## ##       ##       ##     ## ##    ##
   *    ##     ##  ##   ##  ####  ## ##     ## ##       ##       ##     ## ##
   *    ######### ##     ## ## ## ## ##     ## ##       ######   ########   ######
   *    ##     ## ######### ##  #### ##     ## ##       ##       ##   ##         ##
   *    ##     ## ##     ## ##   ### ##     ## ##       ##       ##    ##  ##    ##
   *    ##     ## ##     ## ##    ## ########  ######## ######## ##     ##  ######
   */

  setupHandlers() {
    // /get_account_state_hash (Acc_start, Acc_end, Ts_start, Ts_end)
    // Acc_start - get data for accounts starting with this account id; inclusive
    // Acc_end - get data for accounts up to this account id; inclusive
    // Ts_start - get data newer than this timestamp
    // Ts_end - get data older than this timestamp
    // Returns a single hash of the data from the Account State Table determined by the input parameters; sort by Tx_ts  then Tx_id before taking the hash
    // Updated names:  accountStart , accountEnd, tsStart, tsEnd
    this.p2p.registerInternal('get_account_state_hash', async (payload: AccountStateHashReq, respond: (arg0: AccountStateHashResp) => any, sender, tracker: string, msgSize: number) => {
      profilerInstance.scopedProfileSectionStart('get_account_state_hash', false, msgSize)
      let responseSize = cUninitializedSize
      try {
        let result = {} as AccountStateHashResp

        if(this.softSync_checkInitialFlag && this.initalSyncFinished === false){
          //not ready?
          result.ready = false
          result.stateHash = this.stateManager.currentCycleShardData.ourNode.id
          await respond(result)
          return
        }

        // yikes need to potentially hash only N records at a time and return an array of hashes
        let stateHash = await this.stateManager.transactionQueue.getAccountsStateHash(payload.accountStart, payload.accountEnd, payload.tsStart, payload.tsEnd)
        result.stateHash = stateHash
        result.ready = true
        responseSize = await respond(result)
      } catch (e) {
        this.statemanager_fatal('get_account_state_hash', e)
      } finally {
        profilerInstance.scopedProfileSectionEnd('get_account_state_hash', responseSize)
      }
    })

    //    /get_account_state (Acc_start, Acc_end, Ts_start, Ts_end)
    // Acc_start - get data for accounts starting with this account id; inclusive
    // Acc_end - get data for accounts up to this account id; inclusive
    // Ts_start - get data newer than this timestamp
    // Ts_end - get data older than this timestamp
    // Returns data from the Account State Table determined by the input parameters; limits result to 1000 records (as configured)
    // Updated names:  accountStart , accountEnd, tsStart, tsEnd
    this.p2p.registerInternal('get_account_state', async (payload: GetAccountStateReq, respond: (arg0: { accountStates: Shardus.StateTableObject[] }) => any, sender, tracker: string, msgSize: number) => {
      if (this.config.stateManager == null) {
        throw new Error('this.config.stateManager == null') //TODO TSConversion  would be nice to eliminate some of these config checks.
      }
      profilerInstance.scopedProfileSectionStart('get_account_state', false, msgSize)
      let result = {} as { accountStates: Shardus.StateTableObject[] }

      // max records set artificially low for better test coverage
      // todo m11: make configs for how many records to query
      let accountStates = await this.storage.queryAccountStateTable(payload.accountStart, payload.accountEnd, payload.tsStart, payload.tsEnd, this.config.stateManager.stateTableBucketSize)
      result.accountStates = accountStates
      let responseSize = await respond(result)
      profilerInstance.scopedProfileSectionEnd('get_account_state', responseSize)
    })

    this.p2p.registerInternal('get_account_data3', async (payload: GetAccountData3Req, respond: (arg0: { data: GetAccountDataByRangeSmart }) => any, sender, tracker: string, msgSize: number) => {
      profilerInstance.scopedProfileSectionStart('get_account_data3', false, msgSize)
      let result = {} as { data: GetAccountDataByRangeSmart } //TSConversion  This is complicated !!(due to app wrapping)  as {data: Shardus.AccountData[] | null}
      let accountData: GetAccountDataByRangeSmart | null = null
      let ourLockID = -1
      try {
        ourLockID = await this.stateManager.fifoLock('accountModification')
        // returns { wrappedAccounts, lastUpdateNeeded, wrappedAccounts2, highestTs }
        //GetAccountDataByRangeSmart
        accountData = await this.stateManager.getAccountDataByRangeSmart(payload.accountStart, payload.accountEnd, payload.tsStart, payload.maxRecords, payload.offset)
      } finally {
        this.stateManager.fifoUnlock('accountModification', ourLockID)
      }

      //PERF Disiable this in production or performance testing.
      this.stateManager.testAccountDataWrapped(accountData.wrappedAccounts)
      //PERF Disiable this in production or performance testing.
      this.stateManager.testAccountDataWrapped(accountData.wrappedAccounts2)

      result.data = accountData
      let responseSize = await respond(result)
      profilerInstance.scopedProfileSectionEnd('get_account_data3', responseSize)
    })

    // /get_account_data_by_list (Acc_ids)
    // Acc_ids - array of accounts to get
    // Returns data from the application Account Table for just the given account ids;
    // For applications with multiple “Account” tables the returned data is grouped by table name.
    // For example: [ {Acc_id, State_after, Acc_data}, { … }, ….. ]
    // Updated names:  accountIds, max records
    this.p2p.registerInternal('get_account_data_by_list', async (payload: { accountIds: any }, respond: (arg0: { accountData: Shardus.WrappedData[] | null }) => any, sender, tracker: string, msgSize: number) => {
      profilerInstance.scopedProfileSectionStart('get_account_data_by_list', false, msgSize)
      let result = {} as { accountData: Shardus.WrappedData[] | null }
      let accountData = null
      let ourLockID = -1
      try {
        ourLockID = await this.stateManager.fifoLock('accountModification')
        accountData = await this.app.getAccountDataByList(payload.accountIds)
      } finally {
        this.stateManager.fifoUnlock('accountModification', ourLockID)
      }
      //PERF Disiable this in production or performance testing.
      this.stateManager.testAccountDataWrapped(accountData)
      result.accountData = accountData
      let responseSize = await respond(result)
      profilerInstance.scopedProfileSectionEnd('get_account_data_by_list', responseSize)
    })

    Context.network.registerExternalGet('sync-statement', isDebugModeMiddleware, (req, res) => {
      res.write(`${utils.stringifyReduce(this.syncStatement)}\n`)

      res.end()
    })

    //TODO DEBUG DO NOT USE IN LIVE NETWORK
    Context.network.registerExternalGet('sync-statement-all', isDebugModeMiddleware, async (req, res) => {
      try {
        //wow, why does Context.p2p not work..
        let activeNodes = Wrapper.p2p.state.getNodes()
        if (activeNodes) {
          for (let node of activeNodes.values()) {
            let getResp = await this.logger._internalHackGetWithResp(`${node.externalIp}:${node.externalPort}/sync-statement`)
            console.log('getResp active', getResp.body)
            res.write(`${node.externalIp}:${node.externalPort}/sync-statement\n`)
            res.write(getResp.body ? getResp.body : 'no data')
          }
        }
        res.write(`joining nodes...\n`)
        let joiningNodes = Wrapper.p2p.state.getNodesRequestingJoin()
        if (joiningNodes) {
          for (let node of joiningNodes.values()) {
            let getResp = await this.logger._internalHackGetWithResp(`${node.externalIp}:${node.externalPort}/sync-statement`)
            console.log('getResp syncing', getResp.body)
            res.write(`${node.externalIp}:${node.externalPort}/sync-statement\n`)
            res.write(getResp.body ? getResp.body : 'no data')
          }
        }

        res.write(`sending default logs to all nodes\n`)
      } catch (e) {
        res.write(`${e}\n`)
      }

      res.end()
    })

    Context.network.registerExternalGet('forceFinishSync', isDebugModeMiddleware, (req, res) => {
      res.write(`sync forcing complete. \n`)
      this.forceSyncComplete = true
      res.end()
    })


  }

  /***
   *    #### ##    ## #### ######## ####    ###    ##        ######  ##    ## ##    ##  ######  ##     ##    ###    #### ##    ##
   *     ##  ###   ##  ##     ##     ##    ## ##   ##       ##    ##  ##  ##  ###   ## ##    ## ###   ###   ## ##    ##  ###   ##
   *     ##  ####  ##  ##     ##     ##   ##   ##  ##       ##         ####   ####  ## ##       #### ####  ##   ##   ##  ####  ##
   *     ##  ## ## ##  ##     ##     ##  ##     ## ##        ######     ##    ## ## ## ##       ## ### ## ##     ##  ##  ## ## ##
   *     ##  ##  ####  ##     ##     ##  ######### ##             ##    ##    ##  #### ##       ##     ## #########  ##  ##  ####
   *     ##  ##   ###  ##     ##     ##  ##     ## ##       ##    ##    ##    ##   ### ##    ## ##     ## ##     ##  ##  ##   ###
   *    #### ##    ## ####    ##    #### ##     ## ########  ######     ##    ##    ##  ######  ##     ## ##     ## #### ##    ##
   */

  /**
   * initialSyncMain
   * syncs state table data and account data
   * this is only called when a node is first syncing into the network
   *   later on syncing will be from runtime syncTracker ranges
   * @param requiredNodeCount
   */
  async initialSyncMain(requiredNodeCount: number) {
    const safetyMode = safetyModeVals.safetyMode

    //not great, but this currently triggers the storage init in the dapp
    //todo: replace with a specific   initDappStorage() function
    await this.app.deleteLocalAccountData()

    // Dont sync if first node
    if (this.p2p.isFirstSeed || safetyMode) {
      this.dataSyncMainPhaseComplete = true
      this.syncStatement.syncComplete = true
      this.initalSyncFinished = true

      this.globalAccountsSynced = true
      this.stateManager.accountGlobals.hasknownGlobals = true
      this.readyforTXs = true
      if (logFlags.debug) {
        if (this.p2p.isFirstSeed) this.mainLogger.debug(`DATASYNC: isFirstSeed = true. skipping sync`)
        if (safetyMode) this.mainLogger.debug(`DATASYNC: safetyMode = true. skipping sync`)
      }

      // various sync statement stats are zeroed out because we are the first node and dont sync
      this.syncStatement.cycleStarted = 0
      this.syncStatement.cycleEnded = 0
      this.syncStatement.numCycles = 1

      this.syncStatement.syncSeconds = 0
      this.syncStatement.syncStartTime = Date.now()
      this.syncStatement.syncEndTime = this.syncStatement.syncStartTime
      this.syncStatement.numNodesOnStart = 0

      this.syncStatement.p2pJoinTime = Self.p2pJoinTime

      this.syncStatement.timeBeforeDataSync = (Date.now() - Self.p2pSyncEnd)/1000
      this.syncStatement.timeBeforeDataSync2 = this.syncStatement.timeBeforeDataSync

      nestedCountersInstance.countEvent('sync', `sync comlete numCycles: ${this.syncStatement.numCycles} start:${this.syncStatement.cycleStarted} end:${this.syncStatement.cycleEnded}`)

      if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_syncStatement', ` `, `${utils.stringifyReduce(this.syncStatement)}`)

      this.syncStatmentIsComplete()
      this.statemanager_fatal('shrd_sync_syncStatement-tempdebug', `${utils.stringifyReduce(this.syncStatement)}`)
      return
    }

    this.isSyncingAcceptedTxs = true

    this.syncStatement.timeBeforeDataSync = (Date.now() - Self.p2pSyncEnd)/1000


    await utils.sleep(5000) // Temporary delay to make it easier to attach a debugger
    if (logFlags.console) console.log('syncStateData start')
    // delete and re-create some tables before we sync:
    await this.storage.clearAppRelatedState()
    await this.app.deleteLocalAccountData()

    if (logFlags.debug) this.mainLogger.debug(`DATASYNC: starting syncStateData`)

    this.requiredNodeCount = requiredNodeCount

    let hasValidShardData = this.stateManager.currentCycleShardData != null
    if (this.stateManager.currentCycleShardData != null) {
      hasValidShardData = this.stateManager.currentCycleShardData.hasCompleteData
    }

    //wait untill we have valid shard data
    while (hasValidShardData === false) {
      this.stateManager.getCurrentCycleShardData()
      await utils.sleep(1000)
      if (this.stateManager.currentCycleShardData == null) {
        if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_waitForShardData', ` `, ` ${utils.stringifyReduce(this.stateManager.currentCycleShardData)} `)
        hasValidShardData = false
      }
      if (this.stateManager.currentCycleShardData != null) {
        if (this.stateManager.currentCycleShardData.hasCompleteData == false) {
          let temp = this.p2p.state.getActiveNodes(null)
          if (logFlags.playback)
            this.logger.playbackLogNote(
              'shrd_sync_waitForShardData',
              ` `,
              `hasCompleteData:${this.stateManager.currentCycleShardData.hasCompleteData} active:${utils.stringifyReduce(temp)} ${utils.stringifyReduce(this.stateManager.currentCycleShardData)} `
            )
        } else {
          hasValidShardData = true
        }
      }
    }

    this.syncStatement.cycleStarted = this.stateManager.currentCycleShardData.cycleNumber
    this.syncStatement.syncStartTime = Date.now()
    this.syncStatement.numNodesOnStart = this.stateManager.currentCycleShardData.activeNodes.length
    this.syncStatement.p2pJoinTime = Self.p2pJoinTime


    // //DO NOT CHECK IN
    // if(this.syncStatement.numNodesOnStart >= 15) {
    //   nestedCountersInstance.countEvent('hack', 'force default logs on')
    //   this.logger.setDefaultFlags()
    // }

    let nodeShardData = this.stateManager.currentCycleShardData.nodeShardData
    if (logFlags.console) console.log('GOT current cycle ' + '   time:' + utils.stringifyReduce(nodeShardData))

    let rangesToSync: StateManagerTypes.shardFunctionTypes.AddressRange[]

    let cycle = this.stateManager.currentCycleShardData.cycleNumber

    let homePartition = nodeShardData.homePartition

    if (logFlags.console) console.log(`homePartition: ${homePartition} storedPartitions: ${utils.stringifyReduce(nodeShardData.storedPartitions)}`)

    // syncRangeGoal helps us calculate how many partitions per range we need to get our data in chunksGuide number of chunks.
    // chunksGuide === 4, would mean that in a network with many nodes most of the time we would have 4 ranges to sync.
    // there could be less ranges if the network is smaller.
    // TODO review that this is up to spec.
    rangesToSync = this.initRangesToSync(nodeShardData, homePartition)
    this.syncStatement.syncRanges = rangesToSync.length

    for (let range of rangesToSync) {
      // let nodes = ShardFunctions.getNodesThatCoverRange(this.stateManager.currentCycleShardData.shardGlobals, range.low, range.high, this.stateManager.currentCycleShardData.ourNode, this.stateManager.currentCycleShardData.activeNodes)
      this.createSyncTrackerByRange(range, cycle, true)
    }

    let useGlobalAccounts = true // this should stay true now.
 
    //@ts-ignore
    if(useGlobalAccounts === true){
      this.createSyncTrackerByForGlobals(cycle, true)
    }

    this.syncStatement.timeBeforeDataSync2 = (Date.now() - Self.p2pSyncEnd)/1000
    //@ts-ignore
    if(useGlobalAccounts === true){
    // must get a list of globals before we can listen to any TXs, otherwise the isGlobal function returns bad values
    await this.stateManager.accountGlobals.getGlobalListEarly()
    this.readyforTXs = true

    } else {
      //hack force this to true
      this.stateManager.accountGlobals.hasknownGlobals = true
    }

    if(this.useStateTable === true){
      await utils.sleep(8000) // sleep to make sure we are listening to some txs before we sync them
    }

    //This has an inner loop that will process sync trackers one at a time.
    //The outer while loop can be used to recalculate the list of sync trackers and try again
    let breakCount = 0
    let running = true
    while(running){

      try{
        for (let syncTracker of this.syncTrackers) {
          if(this.dataSyncMainPhaseComplete === true){
            // this get set if we force sync to finish
            running = false
            break
          }
          // let partition = syncTracker.partition
          if (logFlags.console) console.log(`syncTracker start. time:${Date.now()} data: ${utils.stringifyReduce(syncTracker)}}`)
          if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_trackerRangeStart', ` `, ` ${utils.stringifyReduce(syncTracker.range)} `)

          syncTracker.syncStarted = true

          if (syncTracker.isGlobalSyncTracker === false) {
            if (this.softSync_earlyOut === true) {
              // do nothing realtime sync will work on this later
            } else {
              //await this.syncStateDataForRange(syncTracker.range)
              await this.syncStateDataForRange2(syncTracker.range)
            }
          } else {
            if (logFlags.console) console.log(`syncTracker syncStateDataGlobals start. time:${Date.now()} data: ${utils.stringifyReduce(syncTracker)}}`)
            await this.syncStateDataGlobals(syncTracker)
          }
          syncTracker.syncFinished = true

          if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_trackerRangeEnd', ` `, ` ${utils.stringifyReduce(syncTracker.range)} `)
          this.clearSyncData()
        }
        //if we get here without an exception that we are finished with the outer loop
        running = false

      } catch (error){

        if(error.message.includes('reset-sync-ranges')){

          this.statemanager_fatal(`mainSyncLoop_reset-sync-ranges`, 'DATASYNC: reset-sync-ranges: ' + errorToStringFull(error))

          if(breakCount > 5){
            this.statemanager_fatal(`mainSyncLoop_reset-sync-ranges-givingUP`,'too many tries' )
            running = false
            this.syncTrackers = []
            continue
          }

          breakCount++
          this.clearSyncData()

          let cleared = 0
          let kept = 0
          let newTrackers = 0
          let trackersToKeep = []
          for (let syncTracker of this.syncTrackers){
            //keep unfinished global sync trackers
            if (syncTracker.isGlobalSyncTracker === true && syncTracker.syncFinished === false){
              trackersToKeep.push(syncTracker)
              kept++
            } else {
              cleared++
            }
          }
          this.syncTrackers = trackersToKeep

          //get fresh nodeShardData, homePartition and cycle so that we can re init the sync ranges.
          nodeShardData = this.stateManager.currentCycleShardData.nodeShardData
          console.log('RETRYSYNC: GOT current cycle ' + '   time:' + utils.stringifyReduce(nodeShardData))
          let lastCycle = cycle
          cycle = this.stateManager.currentCycleShardData.cycleNumber
          homePartition = nodeShardData.homePartition
          console.log(`RETRYSYNC: homePartition: ${homePartition} storedPartitions: ${utils.stringifyReduce(nodeShardData.storedPartitions)}`)


          //init new non global trackers
          rangesToSync = this.initRangesToSync(nodeShardData, homePartition, 4, 4)
          this.syncStatement.syncRanges = rangesToSync.length
          for (let range of rangesToSync) {
            this.createSyncTrackerByRange(range, cycle, true)
            newTrackers++
          }
          nestedCountersInstance.countRareEvent('sync', `RETRYSYNC: lastCycle: ${lastCycle} cycle: ${cycle} ${JSON.stringify({cleared, kept, newTrackers})}`)

          continue //resume loop at top!

        } else {
          running = false
        }
      }
    }
    // if (logFlags.playback ) this.logger.playbackLogNote('shrd_sync_queued_and_set_syncing', `${txQueueEntry.acceptedTx.id}`, ` qId: ${txQueueEntry.entryID}`)
    if (logFlags.console) console.log('syncStateData end' + '   time:' + Date.now())
  }

  private initRangesToSync(nodeShardData: StateManagerTypes.shardFunctionTypes.NodeShardData, homePartition: number, chunksGuide:number = 4, minSyncRangeGuide:number = 1):StateManagerTypes.shardFunctionTypes.AddressRange[] {
    //let chunksGuide = 4
    // todo consider making minSyncRangeGuide = 3 or 4..
    let syncRangeGoal = Math.max(minSyncRangeGuide, Math.min(chunksGuide, Math.floor(this.stateManager.currentCycleShardData.shardGlobals.numPartitions / chunksGuide)))
    let partitionsCovered = 0
    let partitionsPerRange = 1
    let rangesToSync = [] //, rangesToSync: StateManagerTypes.shardFunctionTypes.AddressRange[]

    if (nodeShardData.storedPartitions.rangeIsSplit === true) {
      partitionsCovered = nodeShardData.storedPartitions.partitionEnd1 - nodeShardData.storedPartitions.partitionStart1
      partitionsCovered += nodeShardData.storedPartitions.partitionEnd2 - nodeShardData.storedPartitions.partitionStart2
      partitionsPerRange = Math.max(Math.floor(partitionsCovered / syncRangeGoal), 1)
      if (logFlags.console)
        console.log(
          `syncRangeGoal ${syncRangeGoal}  chunksGuide:${chunksGuide} numPartitions:${this.stateManager.currentCycleShardData.shardGlobals.numPartitions} partitionsPerRange:${partitionsPerRange}`
        )

      let start = nodeShardData.storedPartitions.partitionStart1
      let end = nodeShardData.storedPartitions.partitionEnd1
      let currentStart = start
      let currentEnd = 0
      let nextLowAddress: string | null = null
      let i = 0
      while (currentEnd < end) {
        currentEnd = Math.min(currentStart + partitionsPerRange, end)
        let range = ShardFunctions.partitionToAddressRange2(this.stateManager.currentCycleShardData.shardGlobals, currentStart, currentEnd)

        let { address1, address2 } = ShardFunctions.getNextAdjacentAddresses(range.high)
        range.high = address1

        if (nextLowAddress != null) {
          range.low = nextLowAddress
        }
        if (logFlags.console)
          console.log(`range ${i}  s:${currentStart} e:${currentEnd} h: ${homePartition}  a1: ${range.low} a2: ${range.high}`)
        nextLowAddress = address2
        currentStart = currentEnd
        i++
        rangesToSync.push(range)
      }

      start = nodeShardData.storedPartitions.partitionStart2
      end = nodeShardData.storedPartitions.partitionEnd2
      currentStart = start
      currentEnd = 0
      nextLowAddress = null

      while (currentEnd < end) {
        currentEnd = Math.min(currentStart + partitionsPerRange, end)
        let range = ShardFunctions.partitionToAddressRange2(this.stateManager.currentCycleShardData.shardGlobals, currentStart, currentEnd)

        let { address1, address2 } = ShardFunctions.getNextAdjacentAddresses(range.high)
        range.high = address1

        if (nextLowAddress != null) {
          range.low = nextLowAddress
        }
        if (logFlags.console)
          console.log(`range ${i}  s:${currentStart} e:${currentEnd} h: ${homePartition} a1: ${range.low} a2: ${range.high}`)

        nextLowAddress = address2
        currentStart = currentEnd
        i++
        rangesToSync.push(range)
      }
    } else {
      partitionsCovered = nodeShardData.storedPartitions.partitionEnd - nodeShardData.storedPartitions.partitionStart
      partitionsPerRange = Math.max(Math.floor(partitionsCovered / syncRangeGoal), 1)
      if (logFlags.console)
        console.log(
          `syncRangeGoal ${syncRangeGoal}  chunksGuide:${chunksGuide} numPartitions:${this.stateManager.currentCycleShardData.shardGlobals.numPartitions} partitionsPerRange:${partitionsPerRange}`
        )

      let start = nodeShardData.storedPartitions.partitionStart
      let end = nodeShardData.storedPartitions.partitionEnd

      let currentStart = start
      let currentEnd = 0
      let nextLowAddress: string | null = null
      let i = 0
      while (currentEnd < end) {
        currentEnd = Math.min(currentStart + partitionsPerRange, end)
        let range = ShardFunctions.partitionToAddressRange2(this.stateManager.currentCycleShardData.shardGlobals, currentStart, currentEnd)

        let { address1, address2 } = ShardFunctions.getNextAdjacentAddresses(range.high)
        range.high = address1

        if (nextLowAddress != null) {
          range.low = nextLowAddress
        }
        if (logFlags.console)
          console.log(`range ${i}  s:${currentStart} e:${currentEnd} h: ${homePartition}  a1: ${range.low} a2: ${range.high}`)
        nextLowAddress = address2
        currentStart = currentEnd
        i++
        rangesToSync.push(range)
      }
    }

    // if we don't have a range to sync yet manually sync the whole range.
    if (rangesToSync.length === 0) {
      if (logFlags.console)
        console.log(`syncStateData ranges: pushing full range, no ranges found`)
      let range = ShardFunctions.partitionToAddressRange2(this.stateManager.currentCycleShardData.shardGlobals, 0, this.stateManager.currentCycleShardData.shardGlobals.numPartitions - 1)
      rangesToSync.push(range)
    }
    if (logFlags.console)
      console.log(`syncStateData ranges: ${utils.stringifyReduce(rangesToSync)}}`)

    return rangesToSync
  }

  /***
   *     ######  ##    ## ##    ##  ######   ######  ########    ###    ######## ######## ########     ###    ########    ###    ########  #######  ########  ########     ###    ##    ##  ######   ########
   *    ##    ##  ##  ##  ###   ## ##    ## ##    ##    ##      ## ##      ##    ##       ##     ##   ## ##      ##      ## ##   ##       ##     ## ##     ## ##     ##   ## ##   ###   ## ##    ##  ##
   *    ##         ####   ####  ## ##       ##          ##     ##   ##     ##    ##       ##     ##  ##   ##     ##     ##   ##  ##       ##     ## ##     ## ##     ##  ##   ##  ####  ## ##        ##
   *     ######     ##    ## ## ## ##        ######     ##    ##     ##    ##    ######   ##     ## ##     ##    ##    ##     ## ######   ##     ## ########  ########  ##     ## ## ## ## ##   #### ######
   *          ##    ##    ##  #### ##             ##    ##    #########    ##    ##       ##     ## #########    ##    ######### ##       ##     ## ##   ##   ##   ##   ######### ##  #### ##    ##  ##
   *    ##    ##    ##    ##   ### ##    ## ##    ##    ##    ##     ##    ##    ##       ##     ## ##     ##    ##    ##     ## ##       ##     ## ##    ##  ##    ##  ##     ## ##   ### ##    ##  ##
   *     ######     ##    ##    ##  ######   ######     ##    ##     ##    ##    ######## ########  ##     ##    ##    ##     ## ##        #######  ##     ## ##     ## ##     ## ##    ##  ######   ########
   */

  async syncStateDataForRange2(range: SimpleRange) {
    try {
      let partition = 'notUsed'
      this.currentRange = range
      this.addressRange = range // this.partitionToAddressRange(partition)

      this.partitionStartTimeStamp = Date.now()

      let lowAddress = this.addressRange.low
      let highAddress = this.addressRange.high
      partition = `${utils.stringifyReduce(lowAddress)} - ${utils.stringifyReduce(highAddress)}`

      nestedCountersInstance.countEvent('sync', `sync partition: ${partition} start: ${this.stateManager.currentCycleShardData.cycleNumber}`)
      
      this.readyforTXs = true // open the floodgates of queuing stuffs.

      let accountsSaved = await this.syncAccountData2(lowAddress, highAddress)
      if (logFlags.debug) this.mainLogger.debug(`DATASYNC: partition: ${partition}, syncAccountData2 done.`)

      nestedCountersInstance.countEvent('sync', `sync partition: ${partition} end: ${this.stateManager.currentCycleShardData.cycleNumber} accountsSynced:${accountsSaved} failedHashes:${this.failedAccounts.length}`)
      this.failedAccounts = [] //clear failed hashes.  We dont try to fix them for now.  let the patcher handle it.  could bring back old code if we change mind

    } catch (error) {
      if(error.message.includes('reset-sync-ranges')){

        this.statemanager_fatal(`syncStateDataForRange_reset-sync-ranges`, 'DATASYNC: reset-sync-ranges: ' + errorToStringFull(error))
        //buble up:
        throw new Error('reset-sync-ranges')
      } else if (error.message.includes('FailAndRestartPartition')) {
        if (logFlags.debug) this.mainLogger.debug(`DATASYNC: Error Failed at: ${error.stack}`)
        this.statemanager_fatal(`syncStateDataForRange_ex_failandrestart`, 'DATASYNC: FailAndRestartPartition: ' + errorToStringFull(error))
        await this.failandRestart()
      } else {
        this.statemanager_fatal(`syncStateDataForRange_ex`, 'syncStateDataForPartition failed: ' + errorToStringFull(error))
        if (logFlags.debug) this.mainLogger.debug(`DATASYNC: unexpected error. restaring sync:` + errorToStringFull(error))
        await this.failandRestart()
      }
    }
  }


  async syncAccountData2(lowAddress: string, highAddress: string): Promise<number> {
    // Sync the Account data
    //   Use the /get_account_data API to get the data from the Account Table using any of the nodes that had a matching hash
    if (logFlags.console) console.log(`syncAccountData3` + '   time:' + Date.now())

    if (this.config.stateManager == null) {
      throw new Error('this.config.stateManager == null')
    }
    let totalAccountsSaved = 0

    let queryLow = lowAddress
    let queryHigh = highAddress

    let moreDataRemaining = true

    this.combinedAccountData = []
    let loopCount = 0

    let startTime = 0
    let lowTimeQuery = startTime

    if(this.useStateTable === false){
      this.dataSourceNode = null
      this.getDataSourceNode(lowAddress, highAddress)
    }

    if(this.dataSourceNode == null){
      if (logFlags.error) this.mainLogger.error(`syncAccountData: dataSourceNode == null ${lowAddress} - ${highAddress}`)
      //if we see this then getDataSourceNode failed.
      // this is most likely because the ranges selected when we started sync are now invalid and too wide to be filled.

      //throwing this specific error text will bubble us up to the main sync loop and cause re-init of all the non global sync ranges/trackers
      throw new Error('reset-sync-ranges')
    }

    // This flag is kind of tricky.  It tells us that the loop can go one more time after bumping up the min timestamp to check
    // If we still don't get account data then we will quit.
    // This is needed to solve a case where there are more than 2x account sync max accounts in the same timestamp
    let stopIfNextLoopHasNoResults = false

    let offset = 0

    let retriesLeft = 10

    // this loop is required since after the first query we may have to adjust the address range and re-request to get the next N data entries.
    while (moreDataRemaining) {
      // Node Precheck!
      if (this.stateManager.isNodeValidForInternalMessage(this.dataSourceNode.id, 'syncAccountData', true, true) === false) {
        if (this.tryNextDataSourceNode('syncAccountData') == false) {
          break
        }
        continue
      }

      // max records artificially low to make testing coverage better.  todo refactor: make it a config or calculate based on data size
      let message = { accountStart: queryLow, accountEnd: queryHigh, tsStart: startTime, maxRecords: this.config.stateManager.accountBucketSize, offset }
      let r: GetAccountData3Resp | boolean
      try{
        r = await this.p2p.ask(this.dataSourceNode, 'get_account_data3', message) // need the repeatable form... possibly one that calls apply to allow for datasets larger than memory
      } catch(ex){

        this.statemanager_fatal(`syncAccountData2`, `syncAccountData2 retries:${retriesLeft} ask: ` + errorToStringFull(ex))
        //wait 5 sec
        await utils.sleep(5000)
        //max retries
        if(retriesLeft > 0){
          retriesLeft--
          continue
        } else {
          throw new Error('out of account sync retries')
        }
        
      }

      // TSConversion need to consider better error handling here!
      let result: GetAccountData3Resp = r as GetAccountData3Resp

      if (result == null) {
        if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(`ASK FAIL syncAccountData result == null node:${this.dataSourceNode.id}`)
        if (this.tryNextDataSourceNode('syncAccountData') == false) {
          break
        }
        continue
      }
      if (result.data == null) {
        if (logFlags.verbose) if (logFlags.error) this.mainLogger.error(`ASK FAIL syncAccountData result.data == null node:${this.dataSourceNode.id}`)
        if (this.tryNextDataSourceNode('syncAccountData') == false) {
          break
        }
        continue
      }
      // accountData is in the form [{accountId, stateId, data}] for n accounts.
      let accountData = result.data.wrappedAccounts
      let lastUpdateNeeded = result.data.lastUpdateNeeded

      let lastLowQuery = lowTimeQuery

      // get the timestamp of the last account data received so we can use it as the low timestamp for our next query
      if (accountData.length > 0) {
        let lastAccount = accountData[accountData.length - 1]
        if (lastAccount.timestamp > lowTimeQuery) {
          lowTimeQuery = lastAccount.timestamp
          startTime = lowTimeQuery
        }
      }

      let sameAsStartTS = 0
      let sameAsLastTS = 0
      let lastLoopTS = -1
      //need to track some counters to help with offset calculations
      for(let account of accountData){
        if(account.timestamp === lastLowQuery){
          sameAsStartTS++
        }
        if(account.timestamp === lastLoopTS){
          sameAsLastTS++
        } else {
          sameAsLastTS=0
          lastLoopTS = account.timestamp
        }
      }

      // If this is a repeated query, clear out any dupes from the new list we just got.
      // There could be many rows that use the stame timestamp so we will search and remove them
      let dataDuplicated = true
      if (loopCount > 0) {
        while (accountData.length > 0 && dataDuplicated) {
          let stateData = accountData[0]
          dataDuplicated = false

          //todo get rid of this in next verision
          for (let i = this.combinedAccountData.length - 1; i >= 0; i--) {
            let existingStateData = this.combinedAccountData[i]
            if (existingStateData.timestamp === stateData.timestamp && existingStateData.accountId === stateData.accountId) {
              dataDuplicated = true
              break
            }
            // once we get to an older timestamp we can stop looking, the outer loop will be done also
            if (existingStateData.timestamp < stateData.timestamp) {
              break
            }
          }
          if (dataDuplicated) {
            accountData.shift()
          }
        }
      }

      //finish our calculations related to offset
      if(lastLowQuery === lowTimeQuery){
        //update offset, so we can get next page of data
        //offset+= (result.data.wrappedAccounts.length + result.data.wrappedAccounts2.length)
        offset+=sameAsLastTS //conservative offset!
      } else {
        //clear offset
        offset=0 
      }
      if(accountData.length < message.maxRecords){
        //bump clock up because we didn't get a full data return
        startTime++;            
        //dont need offset because we should already have all the records
        offset = 0
      }      

      // if we have any accounts in wrappedAccounts2
      let accountData2 = result.data.wrappedAccounts2
      if (accountData2.length > 0) {
        while (accountData.length > 0 && dataDuplicated) {
          let stateData = accountData2[0]
          dataDuplicated = false
          for (let i = this.combinedAccountData.length - 1; i >= 0; i--) {
            let existingStateData = this.combinedAccountData[i]
            if (existingStateData.timestamp === stateData.timestamp && existingStateData.accountId === stateData.accountId) {
              dataDuplicated = true
              break
            }
            // once we get to an older timestamp we can stop looking, the outer loop will be done also
            if (existingStateData.timestamp < stateData.timestamp) {
              break
            }
          }
          if (dataDuplicated) {
            accountData2.shift()
          }
        }
      }

      if (lastUpdateNeeded || (accountData2.length === 0 && accountData.length === 0)) {
        if(lastUpdateNeeded){
          //we are done
          moreDataRemaining = false    
        } else {
          if(stopIfNextLoopHasNoResults === true){
            //we are done
            moreDataRemaining = false           
          } else{
            //bump start time and loop once more!
            //If we don't get anymore accounts on that loopl then we will quit for sure
            //If we do get more accounts then stopIfNextLoopHasNoResults will reset in a branch below
            startTime++
            loopCount++  
            stopIfNextLoopHasNoResults = true            
          }    
        }
        
        if (logFlags.debug)
          this.mainLogger.debug(
            `DATASYNC: syncAccountData3 got ${accountData.length} more records.  last update: ${lastUpdateNeeded} extra records: ${result.data.wrappedAccounts2.length} tsStart: ${lastLowQuery} highestTS1: ${result.data.highestTs} delta:${result.data.delta} offset:${offset} sameAsStartTS:${sameAsStartTS}`
          )
        if (accountData.length > 0) {
          this.combinedAccountData = this.combinedAccountData.concat(accountData)
        }
        if (accountData2.length > 0) {
          this.combinedAccountData = this.combinedAccountData.concat(accountData2)
        }
      } else {
        //we got accounts this time so reset this flag to false
        stopIfNextLoopHasNoResults = false
        if (logFlags.debug)
          this.mainLogger.debug(
            `DATASYNC: syncAccountData3b got ${accountData.length} more records.  last update: ${lastUpdateNeeded} extra records: ${result.data.wrappedAccounts2.length} tsStart: ${lastLowQuery} highestTS1: ${result.data.highestTs} delta:${result.data.delta} offset:${offset} sameAsStartTS:${sameAsStartTS}`
          )
        this.combinedAccountData = this.combinedAccountData.concat(accountData)
        loopCount++
        // await utils.sleep(500)
      }

      //process combinedAccountData right away and then clear it
      if(this.combinedAccountData.length > 0){
        let accountToSave = this.combinedAccountData.length
        let accountsSaved = await this.processAccountDataNoStateTable2()
        totalAccountsSaved+=accountsSaved
        if (logFlags.debug)
          this.mainLogger.debug(
            `DATASYNC: syncAccountData3 accountToSave: ${accountToSave} accountsSaved: ${accountsSaved}  offset:${offset} sameAsStartTS:${sameAsStartTS}`
          )
        //clear data
        this.combinedAccountData = []
      }
      await utils.sleep(200)
    }

    return totalAccountsSaved
  }

  async processAccountDataNoStateTable2() : Promise<number> {
    this.missingAccountData = []
    this.mapAccountData = {}
    this.stateTableForMissingTXs = {}
    // create a fast lookup map for the accounts we have.  Perf.  will need to review if this fits into memory.  May need a novel structure.
    let account
    for (let i = 0; i < this.combinedAccountData.length; i++) {
      account = this.combinedAccountData[i]
      this.mapAccountData[account.accountId] = account
    }

    let accountKeys = Object.keys(this.mapAccountData)
    let uniqueAccounts = accountKeys.length
    let initialCombinedAccountLength = this.combinedAccountData.length
    if (uniqueAccounts < initialCombinedAccountLength) {
      // keep only the newest copies of each account:
      // we need this if using a time based datasync
      this.combinedAccountData = []
      for (let accountID of accountKeys) {
        this.combinedAccountData.push(this.mapAccountData[accountID])
      }
    }

    // let missingButOkAccounts = 0
    let missingTXs = 0
    let handledButOk = 0
    let otherMissingCase = 0
    let futureStateTableEntry = 0
    // let missingButOkAccountIDs: { [id: string]: boolean } = {}

    // let missingAccountIDs: { [id: string]: boolean } = {}

    if (logFlags.debug)
      this.mainLogger.debug(
        `DATASYNC: processAccountData unique accounts: ${uniqueAccounts}  initial combined len: ${initialCombinedAccountLength}`
      )
    // For each account in the Account data make sure the entry in the Account State Table has the same State_after value; if not remove the record from the Account data


    //   For each account in the Account State Table make sure the entry in Account data has the same State_after value; if not save the account id to be looked up later
    this.accountsWithStateConflict = []
    let goodAccounts: Shardus.WrappedData[] = []
    let noSyncData = 0
    let noMatches = 0
    let outOfDateNoTxs = 0
    let unhandledCase = 0
    let fix1Worked = 0
    for (let account of this.combinedAccountData) {
      goodAccounts.push(account)
    }

    if (logFlags.debug)
      this.mainLogger.debug(
        `DATASYNC: processAccountData saving ${goodAccounts.length} of ${this.combinedAccountData.length} records to db.  noSyncData: ${noSyncData} noMatches: ${noMatches} missingTXs: ${missingTXs} handledButOk: ${handledButOk} otherMissingCase: ${otherMissingCase} outOfDateNoTxs: ${outOfDateNoTxs} futureStateTableEntry:${futureStateTableEntry} unhandledCase:${unhandledCase} fix1Worked:${fix1Worked}`
      )
    // failedHashes is a list of accounts that failed to match the hash reported by the server
    let failedHashes = await this.stateManager.checkAndSetAccountData(goodAccounts, 'syncNonGlobals:processAccountDataNoStateTable', true) // repeatable form may need to call this in batches

    this.syncStatement.numAccounts += goodAccounts.length

    //TODO need to reconsider this, there are normal cases where accounts can have a bad hash now?
    // should get more details out of checkAndSetAccountData
    if (failedHashes.length > 1000) {
      if (logFlags.debug) this.mainLogger.debug(`DATASYNC: processAccountData failed hashes over 1000:  ${failedHashes.length} restarting sync process`)
      // state -> try another node. TODO record/eval/report blame?
      this.stateManager.recordPotentialBadnode()
      throw new Error('FailAndRestartPartition_processAccountData_A')
    }
    if (failedHashes.length > 0) {
      if (logFlags.debug) this.mainLogger.debug(`DATASYNC: processAccountData failed hashes:  ${failedHashes.length} will have to download them again`)
      // TODO ? record/eval/report blame?
      this.stateManager.recordPotentialBadnode()
      this.failedAccounts = this.failedAccounts.concat(failedHashes)

      // for (let accountId of failedHashes) {
      //   account = this.mapAccountData[accountId]
      //   if (logFlags.verbose) this.mainLogger.debug(`DATASYNC: processAccountData ${accountId}  data: ${utils.stringifyReduce(account)}`)
      //   if (account != null) {
      //     if (logFlags.verbose) this.mainLogger.debug(`DATASYNC: processAccountData adding account to list`)
      //     this.accountsWithStateConflict.push(account)
      //   } else {
      //     if (logFlags.verbose) this.mainLogger.debug(`DATASYNC: processAccountData cant find data: ${accountId}`)
      //     if (accountId) {
      //       //this.accountsWithStateConflict.push({ address: accountId,  }) //NOTE: fixed with refactor
      //       this.accountsWithStateConflict.push({ accountId: accountId, data: null, stateId: null, timestamp: 0 })
      //     }
      //   }
      // }
    }

    let accountsSaved = await this.stateManager.writeCombinedAccountDataToBackups(goodAccounts, failedHashes)

    nestedCountersInstance.countEvent('sync', `accounts written`, accountsSaved)

    this.combinedAccountData = [] // we can clear this now.

    return accountsSaved
  }





  /***
   *     ######  ##    ## ##    ##  ######   ######  ########    ###    ######## ######## ########     ###    ########    ###     ######   ##        #######  ########     ###    ##        ######
   *    ##    ##  ##  ##  ###   ## ##    ## ##    ##    ##      ## ##      ##    ##       ##     ##   ## ##      ##      ## ##   ##    ##  ##       ##     ## ##     ##   ## ##   ##       ##    ##
   *    ##         ####   ####  ## ##       ##          ##     ##   ##     ##    ##       ##     ##  ##   ##     ##     ##   ##  ##        ##       ##     ## ##     ##  ##   ##  ##       ##
   *     ######     ##    ## ## ## ##        ######     ##    ##     ##    ##    ######   ##     ## ##     ##    ##    ##     ## ##   #### ##       ##     ## ########  ##     ## ##        ######
   *          ##    ##    ##  #### ##             ##    ##    #########    ##    ##       ##     ## #########    ##    ######### ##    ##  ##       ##     ## ##     ## ######### ##             ##
   *    ##    ##    ##    ##   ### ##    ## ##    ##    ##    ##     ##    ##    ##       ##     ## ##     ##    ##    ##     ## ##    ##  ##       ##     ## ##     ## ##     ## ##       ##    ##
   *     ######     ##    ##    ##  ######   ######     ##    ##     ##    ##    ######## ########  ##     ##    ##    ##     ##  ######   ########  #######  ########  ##     ## ########  ######
   */

  /**
   * syncStateDataGlobals
   * @param syncTracker
   */
  async syncStateDataGlobals(syncTracker: SyncTracker) {
    try {
      let partition = 'globals!'
      // this.currentRange = range
      // this.addressRange = range // this.partitionToAddressRange(partition)

      let globalAccounts = []
      let remainingAccountsToSync = []
      this.partitionStartTimeStamp = Date.now()

      // let lowAddress = this.addressRange.low
      // let highAddress = this.addressRange.high

      if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals partition: ${partition} `)

      this.readyforTXs = true // open the floodgates of queuing stuffs.

      //Get globals list and hash.

      let globalReport: GlobalAccountReportResp = await this.getRobustGlobalReport()

      let hasAllGlobalData = false

      if (globalReport.accounts.length === 0) {
        if (logFlags.debug) this.mainLogger.debug(`DATASYNC:  syncStateDataGlobals no global accounts `)
        this.globalAccountsSynced = true
        return // no global accounts
      }
      if (logFlags.debug) this.mainLogger.debug(`DATASYNC:  syncStateDataGlobals globalReport: ${utils.stringifyReduce(globalReport)} `)

      let accountReportsByID: { [id: string]: { id: string; hash: string; timestamp: number } } = {}
      for (let report of globalReport.accounts) {
        remainingAccountsToSync.push(report.id)

        accountReportsByID[report.id] = report
      }
      let accountData: Shardus.WrappedData[] = []
      let accountDataById: { [id: string]: Shardus.WrappedData } = {}
      let globalReport2: GlobalAccountReportResp = { ready: false, combinedHash: '', accounts: [] }
      let maxTries = 10
      while (hasAllGlobalData === false) {
        maxTries--
        if (maxTries <= 0) {
          if (logFlags.error) this.mainLogger.error(`DATASYNC: syncStateDataGlobals max tries excceded `)
          return
        }
        if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals hasAllGlobalData === false `)
        //Get accounts.
        //this.combinedAccountData = []

        // Node Precheck!
        if (this.stateManager.isNodeValidForInternalMessage(this.dataSourceNode.id, 'syncStateDataGlobals', true, true) === false) {
          if (this.tryNextDataSourceNode('syncStateDataGlobals') == false) {
            break
          }
          continue
        }

        let message = { accountIds: remainingAccountsToSync }
        let result = await this.p2p.ask(this.dataSourceNode, 'get_account_data_by_list', message)

        if (result == null) {
          if (logFlags.verbose) if (logFlags.error) this.mainLogger.error('ASK FAIL syncStateTableData result == null')
          if (this.tryNextDataSourceNode('syncStateDataGlobals') == false) {
            break
          }
          continue
        }
        if (result.accountData == null) {
          if (logFlags.verbose) if (logFlags.error) this.mainLogger.error('ASK FAIL syncStateTableData result.accountData == null')
          if (this.tryNextDataSourceNode('syncStateDataGlobals') == false) {
            break
          }
          continue
        }
        //{ accountData: Shardus.WrappedData[] | null }
        //this.combinedAccountData = this.combinedAccountData.concat(result.accountData)
        accountData = accountData.concat(result.accountData)

        //Get globals list and hash (if changes then update said accounts and repeath)
        //diff the list and update remainingAccountsToSync
        // add any new accounts to globalAccounts
        if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals get_account_data_by_list ${utils.stringifyReduce(result)} `)

        globalReport2 = await this.getRobustGlobalReport()
        let accountReportsByID2: { [id: string]: { id: string; hash: string; timestamp: number } } = {}
        for (let report of globalReport2.accounts) {
          accountReportsByID2[report.id] = report
        }

        hasAllGlobalData = true
        remainingAccountsToSync = []
        for (let account of accountData) {
          accountDataById[account.accountId] = account
          //newer copies will overwrite older ones in this map
        }
        //check the full report for any missing data
        for (let report of globalReport2.accounts) {
          if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals loop globalReport2.accounts `)
          let data = accountDataById[report.id]
          if (data == null) {
            //we dont have the data
            hasAllGlobalData = false
            remainingAccountsToSync.push(report.id)
            if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals remainingAccountsToSync data===null ${utils.makeShortHash(report.id)} `)
          } else if (data.stateId !== report.hash) {
            //we have the data but he hash is wrong
            hasAllGlobalData = false
            remainingAccountsToSync.push(report.id)
            if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals remainingAccountsToSync data.stateId !== report.hash ${utils.makeShortHash(report.id)} `)
          }
        }
        //set this report to the last report and continue.
        accountReportsByID = accountReportsByID2
      }

      let dataToSet = []
      let cycleNumber = this.stateManager.currentCycleShardData.cycleNumber // Math.max(1, this.stateManager.currentCycleShardData.cycleNumber-1 ) //kinda hacky?

      let goodAccounts: Shardus.WrappedData[] = []

      //Write the data! and set global memory data!.  set accounts copy data too.
      for (let report of globalReport2.accounts) {
        if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals loop globalReport2.accounts 2`)
        let accountData = accountDataById[report.id]
        if (accountData != null) {
          dataToSet.push(accountData)
          goodAccounts.push(accountData)
        }
      }

      let failedHashes = await this.stateManager.checkAndSetAccountData(dataToSet, 'syncStateDataGlobals', true)

      this.syncStatement.numGlobalAccounts += dataToSet.length

      if (logFlags.console) console.log('DBG goodAccounts', goodAccounts)

      await this.stateManager.writeCombinedAccountDataToBackups(goodAccounts, failedHashes)

      if (failedHashes && failedHashes.length > 0) {
        throw new Error('setting data falied no error handling for this yet')
      }
      if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals complete synced ${dataToSet.length} accounts `)
    } catch (error) {
      if (error.message.includes('FailAndRestartPartition')) {
        if (logFlags.debug) this.mainLogger.debug(`DATASYNC: syncStateDataGlobals Error Failed at: ${error.stack}`)
        this.statemanager_fatal(`syncStateDataGlobals_ex_failandrestart`, 'DATASYNC: syncStateDataGlobals FailAndRestartPartition: ' + errorToStringFull(error))
        await this.failandRestart()
      } else {
        this.statemanager_fatal(`syncStateDataGlobals_ex`, 'syncStateDataGlobals failed: ' + errorToStringFull(error))
        if (logFlags.debug) this.mainLogger.debug(`DATASYNC: unexpected error. restaring sync:` + errorToStringFull(error))
        await this.failandRestart()
      }
    }

    if (logFlags.debug) this.mainLogger.debug(`DATASYNC:  syncStateDataGlobals complete ${this.syncStatement.numGlobalAccounts}`)
    this.globalAccountsSynced = true
  }

  /***
   *     ######   ######## ######## ########   #######  ########  ##     ##  ######  ########  ######   ##        #######  ########     ###    ##       ########  ######## ########   #######  ########  ########
   *    ##    ##  ##          ##    ##     ## ##     ## ##     ## ##     ## ##    ##    ##    ##    ##  ##       ##     ## ##     ##   ## ##   ##       ##     ## ##       ##     ## ##     ## ##     ##    ##
   *    ##        ##          ##    ##     ## ##     ## ##     ## ##     ## ##          ##    ##        ##       ##     ## ##     ##  ##   ##  ##       ##     ## ##       ##     ## ##     ## ##     ##    ##
   *    ##   #### ######      ##    ########  ##     ## ########  ##     ##  ######     ##    ##   #### ##       ##     ## ########  ##     ## ##       ########  ######   ########  ##     ## ########     ##
   *    ##    ##  ##          ##    ##   ##   ##     ## ##     ## ##     ##       ##    ##    ##    ##  ##       ##     ## ##     ## ######### ##       ##   ##   ##       ##        ##     ## ##   ##      ##
   *    ##    ##  ##          ##    ##    ##  ##     ## ##     ## ##     ## ##    ##    ##    ##    ##  ##       ##     ## ##     ## ##     ## ##       ##    ##  ##       ##        ##     ## ##    ##     ##
   *     ######   ########    ##    ##     ##  #######  ########   #######   ######     ##     ######   ########  #######  ########  ##     ## ######## ##     ## ######## ##         #######  ##     ##    ##
   */
  /**
   * getRobustGlobalReport
   *
   */
  async getRobustGlobalReport(): Promise<GlobalAccountReportResp> {
    // this.p2p.registerInternal('get_globalaccountreport', async (payload:any, respond: (arg0: GlobalAccountReportResp) => any) => {
    //   let result = {combinedHash:"", accounts:[]} as GlobalAccountReportResp

    let equalFn = (a: GlobalAccountReportResp, b: GlobalAccountReportResp) => {
      // these fail cases should not count towards forming an hash consenus
      if (a.combinedHash == null || a.combinedHash === '') {
        return false
      }
      return a.combinedHash === b.combinedHash
    }
    let queryFn = async (node: Shardus.Node) => {
      // Node Precheck!
      if (this.stateManager.isNodeValidForInternalMessage(node.id, 'getRobustGlobalReport', true, true) === false) {
        return { ready: false, msg: `getRobustGlobalReport invalid node to ask: ${utils.stringifyReduce(node.id)}` }
      }

      let result = await this.p2p.ask(node, 'get_globalaccountreport', {})
      if (result === false) {
        if (logFlags.error) this.mainLogger.error(`ASK FAIL getRobustGlobalReport result === false node:${utils.stringifyReduce(node.id)}`)
      }
      if (result === null) {
        if (logFlags.error) this.mainLogger.error(`ASK FAIL getRobustGlobalReport result === null node:${utils.stringifyReduce(node.id)}`)
      }

      // TODO I dont know the best way to handle a non null network error here, below is something I had before but disabled for some reason
      if (result != null && result.accounts == null) {
        if (logFlags.error) this.mainLogger.error('ASK FAIL getRobustGlobalReport result.stateHash == null')
        result = { ready: false, msg: `invalid data format: ${Math.random()}` }
      }
      if (result != null && result.ready === false) {
        if (logFlags.error) this.mainLogger.error('ASK FAIL getRobustGlobalReport result.ready === false')
        result = { ready: false, msg: `not ready: ${Math.random()}` }
      }
      return result
    }
    //can ask any active nodes for global data.
    let nodes: Shardus.Node[] = this.stateManager.currentCycleShardData.activeNodes
    // let nodes = this.getActiveNodesInRange(lowAddress, highAddress) // this.p2p.state.getActiveNodes(this.p2p.id)
    if (nodes.length === 0) {
      if (logFlags.debug) this.mainLogger.debug(`no nodes available`)
      return // nothing to do
    }
    if (logFlags.debug) this.mainLogger.debug(`DATASYNC: robustQuery getRobustGlobalReport ${utils.stringifyReduce(nodes.map((node) => utils.makeShortHash(node.id) + ':' + node.externalPort))}`)
    let result
    let winners
    try {
      let robustQueryResult = await robustQuery(nodes, queryFn, equalFn, 3, false)

      // if we did not get a result at all wait, log and retry
      if (robustQueryResult === null) {
        if (logFlags.debug) this.mainLogger.debug(`DATASYNC: getRobustGlobalReport results === null wait 10 seconds and try again. nodes:${nodes.length} `)
        if (logFlags.console) console.log(`DATASYNC: getRobustGlobalReport results === null wait 10 seconds and try again. nodes:${nodes.length}  `)
        nestedCountersInstance.countEvent('sync','DATASYNC: getRobustGlobalReport results === null')
        await utils.sleep(10 * 1000) //wait 10 seconds and try again.
        return await this.getRobustGlobalReport()
      }

      result = robustQueryResult.topResult
      winners = robustQueryResult.winningNodes

      // if the result is not robust wait, throw an execption
      if (robustQueryResult.isRobustResult == false) {
        if (logFlags.debug) this.mainLogger.debug('getRobustGlobalReport: robustQuery isRobustResult == false')
        this.statemanager_fatal(`getRobustGlobalReport_nonRobust`, 'getRobustGlobalReport: robustQuery isRobustResult == false')
        nestedCountersInstance.countEvent('sync','DATASYNC: getRobustGlobalReport: robustQuery isRobustResult == false')
        throw new Error('FailAndRestartPartition_globalReport_A')
      }

      // if the reports are not ready then wait, log an retry
      if (result.ready === false) {
        if (logFlags.debug) this.mainLogger.debug(`DATASYNC: getRobustGlobalReport results not ready wait 10 seconds and try again `)
        if (logFlags.console) console.log(`DATASYNC: getRobustGlobalReport results not ready wait 10 seconds and try again `)
        nestedCountersInstance.countEvent('sync','DATASYNC: getRobustGlobalReport results not ready wait 10 seconds and try again')
        await utils.sleep(10 * 1000) //wait 10 seconds and try again.
        return await this.getRobustGlobalReport()
      }
    } catch (ex) {
      // NOTE: no longer expecting an exception from robust query in cases where we do not have enough votes or respones!
      //       but for now if isRobustResult == false then we local code wil throw an exception
      if (logFlags.debug) this.mainLogger.debug('getRobustGlobalReport: robustQuery ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      this.statemanager_fatal(`getRobustGlobalReport_ex`, 'getRobustGlobalReport: robustQuery ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      throw new Error('FailAndRestartPartition_globalReport_B')
    }
    if (!winners || winners.length === 0) {
      if (logFlags.debug) this.mainLogger.debug(`DATASYNC: getRobustGlobalReport no winners, going to throw fail and restart`)
      this.statemanager_fatal(`getRobustGlobalReport_noWin`, `DATASYNC: getRobustGlobalReport no winners, going to throw fail and restart`) // todo: consider if this is just an error
      throw new Error('FailAndRestartPartition_globalReport_noWin')
    }
    if (logFlags.debug) this.mainLogger.debug(`DATASYNC: getRobustGlobalReport found a winner.  results: ${utils.stringifyReduce(result)}`)
    this.dataSourceNodeIndex = 0
    this.dataSourceNode = winners[this.dataSourceNodeIndex] // Todo random index
    this.dataSourceNodeList = winners
    return result as GlobalAccountReportResp
  }



  getDataSourceNode(lowAddress: string, highAddress: string) {

    if (this.stateManager.currentCycleShardData == null) {
      return
    }

    let queryLow
    let queryHigh

    queryLow = lowAddress
    queryHigh = highAddress

    let centerNode = ShardFunctions.getCenterHomeNode(this.stateManager.currentCycleShardData.shardGlobals, this.stateManager.currentCycleShardData.parititionShardDataMap, lowAddress, highAddress)
    if (centerNode == null) {
      if (logFlags.error) this.mainLogger.error(`getDataSourceNode: centerNode not found`)
      return
    }

    let nodes: Shardus.Node[] = ShardFunctions.getNodesByProximity(
      this.stateManager.currentCycleShardData.shardGlobals,
      this.stateManager.currentCycleShardData.activeNodes,
      centerNode.ourNodeIndex,
      this.p2p.id,
      40
    )
    let nodesInProximity = nodes.length
    nodes = nodes.filter(this.removePotentiallyRemovedNodes)
    let filteredNodes1 = nodes.length
    let filteredNodes = []
    for(let node of nodes){

      let nodeShardData = this.stateManager.currentCycleShardData.nodeShardDataMap.get(node.id)
      if(nodeShardData != null){

        if(ShardFunctions.testAddressInRange(queryLow, nodeShardData.consensusPartitions) === false){
          if (logFlags.error) this.mainLogger.error(`node cant fit range: queryLow:${queryLow}  ${utils.stringifyReduce(nodeShardData.consensusPartitions)}  `)
          continue
        }
        if(ShardFunctions.testAddressInRange(queryHigh, nodeShardData.consensusPartitions) === false){
          if (logFlags.error) this.mainLogger.error(`node cant fit range: queryHigh:${queryHigh}  ${utils.stringifyReduce(nodeShardData.consensusPartitions)}  `)
          continue
        }
        filteredNodes.push(node)
      }
    }
    nodes = filteredNodes
    let filteredNodes2 = nodes.length
    if(nodes.length > 0){
      this.dataSourceNode = nodes[Math.floor(Math.random() * nodes.length)]
      //this next line is not an error: comment it out later
      if (logFlags.error) this.mainLogger.error(`data source nodes found: ${nodes.length}  nodesInProximity:${nodesInProximity} filteredNodes1:${filteredNodes1} filteredNodes2:${filteredNodes2} `)
    } else {
      if (logFlags.error) this.mainLogger.error(`no data source nodes found nodesInProximity:${nodesInProximity} filteredNodes1:${filteredNodes1} filteredNodes2:${filteredNodes2} `)
    }
  }

  /**
   * failedAccountsRemain
   */
  failedAccountsRemain(): boolean {
    // clean out account conflicts based on what TXs we we have in the queue that we can repair.
    // also mark tx for scheduled repair..

    // failed counts went way down after fixing liberdus end of things so putting this optimization on hold.

    if (this.accountsWithStateConflict.length === 0 && this.missingAccountData.length === 0) {
      return false
    }
    return true
  }

  /**
   * failandRestart
   */
  async failandRestart() {
    this.mainLogger.info(`DATASYNC: failandRestart`)
    this.logger.playbackLogState('datasyncFail', '', '')
    this.clearSyncData()

    // using set timeout before we resume to prevent infinite stack depth.
    // setTimeout(async () => {
    //   await this.syncStateDataForPartition(this.currentPartition)
    // }, 1000)
    await utils.sleep(1000)

    let anyNonGlobalSyncTrackersLeft = false
    for (let syncTracker of this.syncTrackers) {
      if(syncTracker.isGlobalSyncTracker === false && syncTracker.syncFinished === false){
        anyNonGlobalSyncTrackersLeft = true
      }
    }

    if(this.forceSyncComplete){
      nestedCountersInstance.countEvent('sync', 'forceSyncComplete')
      this.syncStatmentIsComplete()
      this.clearSyncData()
      this.skipSync()

      //make sync trackers clean up
      for (let syncTracker of this.syncTrackers) {
        syncTracker.syncFinished = true
      }
      return
    }


    nestedCountersInstance.countEvent('sync', `fail and restart non globals left:${anyNonGlobalSyncTrackersLeft}`)
    this.syncStatement.failAndRestart++

    //TODO proper restart not useing global var
    await this.syncStateDataForRange2(this.currentRange)
  }

  /**
   * failAndDontRestartSync
   */
  failAndDontRestartSync() {
    this.mainLogger.info(`DATASYNC: failAndDontRestartSync`)
    // need to clear more?
    this.clearSyncData()
    this.syncTrackers = []
  }

  /**
   * tryNextDataSourceNode
   * @param debugString
   */
  tryNextDataSourceNode(debugString): boolean {
    this.dataSourceNodeIndex++
    if (logFlags.error) this.mainLogger.error(`tryNextDataSourceNode ${debugString} try next node: ${this.dataSourceNodeIndex}`)
    if (this.dataSourceNodeIndex >= this.dataSourceNodeList.length) {
      if (logFlags.error) this.mainLogger.error(`tryNextDataSourceNode ${debugString} ran out of nodes ask for data`)
      this.dataSourceNodeIndex = 0
      return false
    }
    // pick new data source node
    this.dataSourceNode = this.dataSourceNodeList[this.dataSourceNodeIndex]
    return true
  }

  /***
   *    ########  ##     ## ##    ## ######## #### ##     ## ########     ######  ##    ## ##    ##  ######  ##     ##    ###    ##    ## ########  ##       ######## ########   ######
   *    ##     ## ##     ## ###   ##    ##     ##  ###   ### ##          ##    ##  ##  ##  ###   ## ##    ## ##     ##   ## ##   ###   ## ##     ## ##       ##       ##     ## ##    ##
   *    ##     ## ##     ## ####  ##    ##     ##  #### #### ##          ##         ####   ####  ## ##       ##     ##  ##   ##  ####  ## ##     ## ##       ##       ##     ## ##
   *    ########  ##     ## ## ## ##    ##     ##  ## ### ## ######       ######     ##    ## ## ## ##       ######### ##     ## ## ## ## ##     ## ##       ######   ########   ######
   *    ##   ##   ##     ## ##  ####    ##     ##  ##     ## ##                ##    ##    ##  #### ##       ##     ## ######### ##  #### ##     ## ##       ##       ##   ##         ##
   *    ##    ##  ##     ## ##   ###    ##     ##  ##     ## ##          ##    ##    ##    ##   ### ##    ## ##     ## ##     ## ##   ### ##     ## ##       ##       ##    ##  ##    ##
   *    ##     ##  #######  ##    ##    ##    #### ##     ## ########     ######     ##    ##    ##  ######  ##     ## ##     ## ##    ## ########  ######## ######## ##     ##  ######
   */

   /**
    * updateRuntimeSyncTrackers
    *
    * called in update shard values to handle sync trackers that have finished and need to restar TXs
    */
  updateRuntimeSyncTrackers() {
    let initalSyncRemaining = 0
    if (this.syncTrackers != null) {
      for (let i = this.syncTrackers.length - 1; i >= 0; i--) {
        let syncTracker = this.syncTrackers[i]

        if(syncTracker.isPartOfInitialSync){
          initalSyncRemaining++
        }

        if (syncTracker.syncFinished === true) {
          if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_trackerRangeClear', ` `, ` ${utils.stringifyReduce(syncTracker.range)} `)

          // allow syncing queue entries to resume!
          for (let queueEntry of syncTracker.queueEntries) {

            //need to decrement this per key
            for(let key of queueEntry.uniqueKeys){
              if(syncTracker.keys[key] === true){
                queueEntry.syncCounter--
              }
            }
            //queueEntry.syncCounter--

            if (queueEntry.syncCounter <= 0) {
              // dont adjust a
              let found = this.stateManager.transactionQueue.getQueueEntry(queueEntry.acceptedTx.txId)
              if (!found) {
                this.logger.playbackLogNote(
                  'shrd_sync_wakeupTX_skip1',
                  `${queueEntry.acceptedTx.txId}`,
                  `not in active queue qId: ${queueEntry.entryID} ts: ${queueEntry.txKeys.timestamp} acc: ${utils.stringifyReduce(queueEntry.txKeys.allKeys)}`
                )
                continue
              }
              // todo other stats to not mess with?
              if (queueEntry.state != 'syncing') {
                this.logger.playbackLogNote(
                  'shrd_sync_wakeupTX_skip2',
                  `${queueEntry.acceptedTx.txId}`,
                  `state!=syncing ${queueEntry.state} qId: ${queueEntry.entryID} ts: ${queueEntry.txKeys.timestamp} acc: ${utils.stringifyReduce(queueEntry.txKeys.allKeys)}`
                )
                continue
              }

              let before = queueEntry.ourNodeInTransactionGroup
              if (queueEntry.ourNodeInTransactionGroup === false) {
                let old = queueEntry.transactionGroup
                queueEntry.transactionGroup = null
                this.stateManager.transactionQueue.queueEntryGetTransactionGroup(queueEntry)
                //@ts-ignore ourNodeInTransactionGroup is updated by queueEntryGetTransactionGroup
                // if(queueEntry.ourNodeInTransactionGroup === true){
                //   queueEntry.conensusGroup = null
                //   this.stateManager.transactionQueue.queueEntryGetConsensusGroup(queueEntry)
                // }

                //Restore the TX group, because we only want to know what nodes were in the group at the time of the TX
                queueEntry.transactionGroup = old
                if (logFlags.playback)
                  this.logger.playbackLogNote(
                    'shrd_sync_wakeupTX_txGroupUpdate',
                    `${queueEntry.acceptedTx.txId}`,
                    `new value: ${queueEntry.ourNodeInTransactionGroup}   qId: ${queueEntry.entryID} ts: ${queueEntry.txKeys.timestamp} acc: ${utils.stringifyReduce(queueEntry.txKeys.allKeys)}`
                  )
              }

              queueEntry.txGroupDebug = `${before} -> ${queueEntry.ourNodeInTransactionGroup}`

              //if(queueEntry.ourNodeInTransactionGroup === true){
              queueEntry.state = 'aging'
              queueEntry.didWakeup = true
              this.stateManager.transactionQueue.updateHomeInformation(queueEntry)
              if (logFlags.playback)
                this.logger.playbackLogNote(
                  'shrd_sync_wakeupTX',
                  `${queueEntry.acceptedTx.txId}`,
                  `before: ${before} inTXGrp: ${queueEntry.ourNodeInTransactionGroup} qId: ${queueEntry.entryID} ts: ${queueEntry.txKeys.timestamp} acc: ${utils.stringifyReduce(
                    queueEntry.txKeys.allKeys
                  )}`
                )
              // } else {
              //   if (logFlags.playback ) this.logger.playbackLogNote('shrd_sync_wakeupTXcancel', `${queueEntry.acceptedTx.id}`, ` qId: ${queueEntry.entryID} ts: ${queueEntry.txKeys.timestamp} acc: ${utils.stringifyReduce(queueEntry.txKeys.allKeys)}`)
              //   queueEntry.state = 'canceled'
              //   queueEntry.didWakeup = true
              // }
            }
          }
          syncTracker.queueEntries = []
          this.syncTrackers.splice(i, 1)
        }
      }
      if (logFlags.playback) this.logger.playbackLogNote('shrd_sync_trackerRangeClearFinished', ` `, `num trackers left: ${this.syncTrackers.length} `)

      if(this.initalSyncRemaining > 0 && initalSyncRemaining === 0){
        this.initalSyncFinished = true
        this.initalSyncRemaining = 0
        if (logFlags.debug) this.mainLogger.debug(`DATASYNC: initalSyncFinished.`)
        nestedCountersInstance.countEvent('sync',`initialSyncFinished ${this.stateManager.currentCycleShardData.cycleNumber}`)
      }
    }
  }

/***
 *     ######  ##    ## ##    ##  ######  ########  ##     ## ##    ## ######## #### ##     ## ######## ######## ########     ###     ######  ##    ## ######## ########   ######
 *    ##    ##  ##  ##  ###   ## ##    ## ##     ## ##     ## ###   ##    ##     ##  ###   ### ##          ##    ##     ##   ## ##   ##    ## ##   ##  ##       ##     ## ##    ##
 *    ##         ####   ####  ## ##       ##     ## ##     ## ####  ##    ##     ##  #### #### ##          ##    ##     ##  ##   ##  ##       ##  ##   ##       ##     ## ##
 *     ######     ##    ## ## ## ##       ########  ##     ## ## ## ##    ##     ##  ## ### ## ######      ##    ########  ##     ## ##       #####    ######   ########   ######
 *          ##    ##    ##  #### ##       ##   ##   ##     ## ##  ####    ##     ##  ##     ## ##          ##    ##   ##   ######### ##       ##  ##   ##       ##   ##         ##
 *    ##    ##    ##    ##   ### ##    ## ##    ##  ##     ## ##   ###    ##     ##  ##     ## ##          ##    ##    ##  ##     ## ##    ## ##   ##  ##       ##    ##  ##    ##
 *     ######     ##    ##    ##  ######  ##     ##  #######  ##    ##    ##    #### ##     ## ########    ##    ##     ## ##     ##  ######  ##    ## ######## ##     ##  ######
 */

  /**
   * syncRuntimeTrackers
   */
  async syncRuntimeTrackers(): Promise<void> {
    // await utils.sleep(8000) // sleep to make sure we are listening to some txs before we sync them // I think we can skip this.

    if (this.runtimeSyncTrackerSyncing === true) {
      return
    }

    try {
      this.runtimeSyncTrackerSyncing = true

      let startedCount = 0
      do {
        // async collection safety:
        //   we work on a copy of the list
        //   we start the loop over again if any work was done.  this allows us to pick up changes that got added in later
        startedCount = 0
        let arrayCopy = this.syncTrackers.slice(0)
        for (let syncTracker of arrayCopy) {
          if (syncTracker.syncStarted === false) {
            // let partition = syncTracker.partition
            if (logFlags.console) console.log(`rtsyncTracker start. time:${Date.now()} data: ${utils.stringifyReduce(syncTracker)}}`)
            if (logFlags.playback) this.logger.playbackLogNote('rt_shrd_sync_trackerRangeStart', ` `, ` ${utils.stringifyReduce(syncTracker.range)} `)

            syncTracker.syncStarted = true
            startedCount++
            await this.syncStateDataForRange2(syncTracker.range)
            syncTracker.syncFinished = true

            if (logFlags.playback) this.logger.playbackLogNote('rt_shrd_sync_trackerRangeEnd', ` `, ` ${utils.stringifyReduce(syncTracker.range)} `)
            this.clearSyncData()
          }
        }
      } while (startedCount > 0)
    } catch (ex) {
      if (logFlags.debug) this.mainLogger.debug('syncRuntimeTrackers: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
      this.statemanager_fatal(`syncRuntimeTrackers_ex`, 'syncRuntimeTrackers: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)

      //clear out sync trackers and let repair handle it if needed.
      let cleared = this.syncTrackers.length
      let kept = 0
      let newTrackers = 0

      let cycle = this.stateManager.currentCycleShardData.cycleNumber
      let lastCycle = cycle - 1

      nestedCountersInstance.countRareEvent('sync', `RETRYSYNC: runtime. lastCycle: ${lastCycle} cycle: ${cycle} ${JSON.stringify({cleared, kept, newTrackers})}`)

      // clear all sync trackers.
      this.syncTrackers = []
      // may need to think more about this.. what if multiple nodes fail sync and then cast bad votes in subsequent updates?

    } finally {
      this.runtimeSyncTrackerSyncing = false
    }
  }

  /***
   *     ######  ##    ## ##    ##  ######  ######## ########     ###     ######  ##    ## ######## ########     ##     ## ######## ##       ########  ######## ########   ######
   *    ##    ##  ##  ##  ###   ## ##    ##    ##    ##     ##   ## ##   ##    ## ##   ##  ##       ##     ##    ##     ## ##       ##       ##     ## ##       ##     ## ##    ##
   *    ##         ####   ####  ## ##          ##    ##     ##  ##   ##  ##       ##  ##   ##       ##     ##    ##     ## ##       ##       ##     ## ##       ##     ## ##
   *     ######     ##    ## ## ## ##          ##    ########  ##     ## ##       #####    ######   ########     ######### ######   ##       ########  ######   ########   ######
   *          ##    ##    ##  #### ##          ##    ##   ##   ######### ##       ##  ##   ##       ##   ##      ##     ## ##       ##       ##        ##       ##   ##         ##
   *    ##    ##    ##    ##   ### ##    ##    ##    ##    ##  ##     ## ##    ## ##   ##  ##       ##    ##     ##     ## ##       ##       ##        ##       ##    ##  ##    ##
   *     ######     ##    ##    ##  ######     ##    ##     ## ##     ##  ######  ##    ## ######## ##     ##    ##     ## ######## ######## ##        ######## ##     ##  ######
   */

  /**
   * createSyncTrackerByRange
   * @param {StateManagerTypes.shardFunctionTypes.BasicAddressRange} range
   * @param {number} cycle
   * @return {SyncTracker}
   */
  createSyncTrackerByRange(range: StateManagerTypes.shardFunctionTypes.BasicAddressRange, cycle: number, initalSync: boolean = false): SyncTracker {
    // let partition = -1
    let index = this.syncTrackerIndex++
    let syncTracker = { range, queueEntries: [], cycle, index, syncStarted: false, syncFinished: false, isGlobalSyncTracker: false, globalAddressMap: {}, isPartOfInitialSync:initalSync, keys:{}  } as SyncTracker // partition,
    syncTracker.syncStarted = false
    syncTracker.syncFinished = false

    this.syncTrackers.push(syncTracker) // we should maintain this order.

    if(initalSync){
      this.initalSyncRemaining++
    }

    return syncTracker
  }

  createSyncTrackerByForGlobals(cycle: number, initalSync: boolean = false): SyncTracker {
    // let partition = -1
    let index = this.syncTrackerIndex++
    let syncTracker = { range: {}, queueEntries: [], cycle, index, syncStarted: false, syncFinished: false, isGlobalSyncTracker: true, globalAddressMap: {}, isPartOfInitialSync:initalSync, keys:{} } as SyncTracker // partition,
    syncTracker.syncStarted = false
    syncTracker.syncFinished = false

    this.syncTrackers.push(syncTracker) // we should maintain this order.

    if(initalSync){
      this.initalSyncRemaining++
    }

    return syncTracker
  }

  getSyncTracker(address: string): SyncTracker | null {
    // return the sync tracker.
    for (let i = 0; i < this.syncTrackers.length; i++) {
      let syncTracker = this.syncTrackers[i]

      // need to see if address is in range. if so return the tracker.
      // if (ShardFunctions.testAddressInRange(address, syncTracker.range)) {
      //if(syncTracker.isGlobalSyncTracker){
      if (syncTracker.range.low <= address && address <= syncTracker.range.high) {
        return syncTracker
      }
      //}else{
      if (syncTracker.isGlobalSyncTracker === true && syncTracker.globalAddressMap[address] === true) {
        return syncTracker
      }
      //}
    }
    return null
  }

  // Check the entire range for a partition to see if any of it is covered by a sync tracker.
  getSyncTrackerForParition(partitionID: number, cycleShardData: CycleShardData): SyncTracker | null {
    if (cycleShardData == null) {
      return null
    }
    let partitionShardData: StateManagerTypes.shardFunctionTypes.ShardInfo = cycleShardData.parititionShardDataMap.get(partitionID)

    let addressLow = partitionShardData.homeRange.low
    let addressHigh = partitionShardData.homeRange.high
    // return the sync tracker.
    for (let i = 0; i < this.syncTrackers.length; i++) {
      let syncTracker = this.syncTrackers[i]
      // if (syncTracker.isGlobalSyncTracker === true && syncTracker.globalAddressMap[address] === true) {
      //   return syncTracker
      // }
      // need to see if address is in range. if so return the tracker.
      if (syncTracker.range.low <= addressLow && addressHigh <= syncTracker.range.high) {
        return syncTracker
      }
    }
    return null
  }

  /***
   *    ##     ## ####  ######   ######
   *    ###   ###  ##  ##    ## ##    ##
   *    #### ####  ##  ##       ##
   *    ## ### ##  ##   ######  ##
   *    ##     ##  ##        ## ##
   *    ##     ##  ##  ##    ## ##    ##
   *    ##     ## ####  ######   ######
   */

  /**
   * syncStatmentIsComplete
   *
   */
  syncStatmentIsComplete() {

    this.syncStatement.totalSyncTime = (Date.now() - Self.p2pSyncStart) / 1000

    // place to hook in and read or send the sync statement
    this.isSyncStatementCompleted = true
    Context.reporter.reportSyncStatement(Self.id, this.syncStatement)
  }

  /**
   * Skips app data sync and sets flags to enable external tx processing.
   * Called by snapshot module after data recovery is complete.
   */
  skipSync() {
    this.dataSyncMainPhaseComplete = true
    this.syncStatement.syncComplete = true

    this.readyforTXs = true
    if (logFlags.debug) this.mainLogger.debug(`DATASYNC: isFirstSeed = true. skipping sync`)

    return
  }

  removePotentiallyRemovedNodes(node){
    return potentiallyRemoved.has(node.id) != true
  }

  // onlyConsensusNodes(node){
  //   return potentiallyRemoved.has(node.id) != true
  // }

}

export default AccountSync
