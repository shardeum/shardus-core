import * as Shardus from '../shardus/shardus-types'
import * as utils from '../utils'
const stringify = require('fast-stable-stringify')

import Profiler, { profilerInstance } from '../utils/profiler'
import { P2PModuleContext as P2P } from '../p2p/Context'
import Storage from '../storage'
import Crypto from '../crypto'
import Logger, {logFlags} from '../logger'
import ShardFunctions from './shardFunctions.js'
import { time } from 'console'
import StateManager from '.'
import { GlobalAccountReportResp } from './state-manager-types'
import { nestedCountersInstance } from '../utils/nestedCounters'

class AccountGlobals {
  app: Shardus.App
  crypto: Crypto
  config: Shardus.ShardusConfiguration
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

  globalAccountSet: Set<string>
  // knownGlobals: { [id: string]: boolean } // will just use the above set now as a simplification
  hasknownGlobals: boolean

  /** Need the ablity to get account copies and use them later when applying a transaction. how to use the right copy or even know when to use this at all? */
  /** Could go by cycle number. if your cycle matches the one in is list use it? */
  /** What if the global account is transformed several times durring that cycle. oof. */
  /** ok best thing to do is to store the account every time it changes for a given period of time. */
  /** how to handle reparing a global account... yikes that is hard. */
  //globalAccountRepairBank: Map<string, Shardus.AccountsCopy[]>

  constructor(
    stateManager: StateManager,

    profiler: Profiler,
    app: Shardus.App,
    logger: Logger,
    storage: Storage,
    p2p: P2P,
    crypto: Crypto,
    config: Shardus.ShardusConfiguration
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

    this.globalAccountSet = new Set()
    //this.globalAccountRepairBank = new Map()
    //this.knownGlobals = {}
    this.hasknownGlobals = false
  }

  setupHandlers() {
    this.p2p.registerInternal('get_globalaccountreport', async (payload: any, respond: (arg0: GlobalAccountReportResp) => any) => {
      profilerInstance.scopedProfileSectionStart('get_globalaccountreport')
      try {
        let result = { combinedHash: '', accounts: [], ready: this.stateManager.appFinishedSyncing } as GlobalAccountReportResp

        let globalAccountKeys = this.globalAccountSet.keys()

        let toQuery: string[] = []

        let responded = false
        console.log('Running get_globalaccountreport', this.stateManager.accountSync.globalAccountsSynced, this.stateManager.appFinishedSyncing)
        console.log('Running get_globalaccountreport result', result)
        // not ready
        if (this.stateManager.accountSync.globalAccountsSynced === false || this.stateManager.appFinishedSyncing === false) {
          result.ready = false
          await respond(result)
          responded = true

          //should just return here, but I want coutners below to help verify the fix! 20210624
          //return
        }

        //TODO: Perf  could do things faster by pulling from cache, but would need extra testing:
        // let notInCache:string[]
        // for(let key of globalAccountKeys){
        //   let report
        //   if(this.globalAccountRepairBank.has(key)){
        //     let accountCopyList = this.globalAccountRepairBank.get(key)
        //     let newestCopy = accountCopyList[accountCopyList.length-1]
        //     report = {id:key, hash:newestCopy.hash, timestamp:newestCopy.timestamp }
        //   } else{
        //     notInCache.push(key)
        //   }
        //   result.accounts.push(report)
        // }
        for (let key of globalAccountKeys) {
          toQuery.push(key)
        }

        // I Think this section can be depricated.  The appFinishedSyncing check above should be enough to bail when it is appropriate
        // const useGlobalAccount = true
        // if (this.p2p.isFirstSeed && useGlobalAccount) {
        //   //TODO: SOON this will mess up dapps that dont use global accounts.  update: maybe add a config to specify if there will be no global accounts for a network. pls discuss fix with group.
        //   if(toQuery.length === 0 && this.stateManager.appFinishedSyncing === false){
        //     nestedCountersInstance.countEvent(`sync`, `HACKFIX - first node needs to wait! ready:${result.ready} responded:${responded}`)
        //     result.ready = false
        //     if(responded === false){
        //       this.statemanager_fatal('get_globalaccountreport -first seed has no globals', `get_globalaccountreport -first seed has no globals. ready:${result.ready} responded:${responded}`)
        //       await respond(result)
        //     }
        //     return
        //   }
        // }

        if(result.ready === false){
          nestedCountersInstance.countEvent(`sync`, `HACKFIX - forgot to return!`)
          return
        }

        let accountData: Shardus.WrappedData[]
        let ourLockID = -1
        try {
          ourLockID = await this.stateManager.fifoLock('accountModification')
          // TODO: if we have more than 900 keys to query in this list must split this into multiple queries!.. ok technically this will not impact liberdus but it could impact
          //       a dapp that uses sqlite
          accountData = await this.app.getAccountDataByList(toQuery)
        } finally {
          this.stateManager.fifoUnlock('accountModification', ourLockID)
        }
        if (accountData != null) {
          for (let wrappedAccount of accountData) {
            // let wrappedAccountInQueueRef = wrappedAccount as Shardus.WrappedDataFromQueue
            // wrappedAccountInQueueRef.seenInQueue = false
            // if (this.lastSeenAccountsMap != null) {
            //   let queueEntry = this.lastSeenAccountsMap[wrappedAccountInQueueRef.accountId]
            //   if (queueEntry != null) {
            //     wrappedAccountInQueueRef.seenInQueue = true
            //   }
            // }
            let report = { id: wrappedAccount.accountId, hash: wrappedAccount.stateId, timestamp: wrappedAccount.timestamp }
            result.accounts.push(report)
          }
        }
        //TODO: SOON. PERF Disiable this in production or performance testing. (we need a global flag to specify if it is a release or debug build, could then implement this, along with turning off debug endpoints)
        this.stateManager.testAccountDataWrapped(accountData)

        result.accounts.sort(utils.sort_id_Asc)
        result.combinedHash = this.crypto.hash(result)
        await respond(result)
      } finally {
        profilerInstance.profileSectionEnd('get_globalaccountreport')
      }
    })
  }



  // sortByTimestamp(a: any, b: any): number {
  //   return utils.sortAscProp(a, b, 'timestamp')
  // }



  /**
   * isGlobalAccount
   * is the account global
   * @param accountID
   */
  isGlobalAccount(accountID: string): boolean {
    // if (this.stateManager.accountSync.globalAccountsSynced === false) {
    //   return this.knownGlobals[accountID] === true
    // }

    return this.globalAccountSet.has(accountID)
  }

  setGlobalAccount(accountID: string) {
    this.globalAccountSet.add(accountID)
  }

  /**
   * getGlobalListEarly
   * sync requires having knowlege of what accounts are global very early in the process.
   * This will get an early global report (note does not have account data, just id,hash,timestamp)
   */
  async getGlobalListEarly() {
    let globalReport: GlobalAccountReportResp = await this.stateManager.accountSync.getRobustGlobalReport()

    //this.knownGlobals = {}
    let temp = []
    for (let report of globalReport.accounts) {
      //this.knownGlobals[report.id] = true

      temp.push(report.id)

      //set this as a known global
      this.globalAccountSet.add(report.id)
    }
    if (logFlags.debug) this.mainLogger.debug(`DATASYNC: getGlobalListEarly: ${utils.stringifyReduce(temp)}`)

    this.hasknownGlobals = true
  }

  getGlobalDebugReport() : {globalAccountSummary:{id:string, state:string, ts:number}[], globalStateHash:string} {
    let globalAccountSummary = []
    for (let globalID in this.globalAccountSet.keys()) {
      let accountHash = this.stateManager.accountCache.getAccountHash(globalID)
      let summaryObj = { id: globalID, state: accountHash.h, ts: accountHash.t }
      globalAccountSummary.push(summaryObj)
    }
    let globalStateHash = this.crypto.hash(globalAccountSummary)
    return {globalAccountSummary, globalStateHash}
  }
}

export default AccountGlobals
