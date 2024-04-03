import * as Shardus from '../shardus/shardus-types'
import * as utils from '../utils'
import Profiler, { cUninitializedSize } from '../utils/profiler'
import { P2PModuleContext as P2P } from '../p2p/Context'
import Storage from '../storage'
import Crypto from '../crypto'
import Logger, { logFlags } from '../logger'
import StateManager from '.'
import { GlobalAccountReportResp } from './state-manager-types'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { Logger as Log4jsLogger } from 'log4js'
import { Route } from '@shardus/types/build/src/p2p/P2PTypes'
import { InternalBinaryHandler } from '../types/Handler'
import { InternalRouteEnum } from '../types/enum/InternalRouteEnum'
import { TypeIdentifierEnum } from '../types/enum/TypeIdentifierEnum'
import {
  GlobalAccountReportRespSerializable,
  serializeGlobalAccountReportResp,
} from '../types/GlobalAccountReportResp'
import { RequestErrorEnum } from '../types/enum/RequestErrorEnum'
import { getStreamWithTypeCheck, requestErrorHandler } from '../types/Helpers'

class AccountGlobals {
  app: Shardus.App
  crypto: Crypto
  config: Shardus.StrictServerConfiguration
  profiler: Profiler

  logger: Logger
  p2p: P2P
  storage: Storage
  stateManager: StateManager

  mainLogger: Log4jsLogger
  fatalLogger: Log4jsLogger
  shardLogger: Log4jsLogger
  statsLogger: Log4jsLogger
  statemanager_fatal: (key: string, log: string) => void

  globalAccountSet: Set<string>
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

    this.globalAccountSet = new Set()
    this.hasknownGlobals = false
  }

  setupHandlers(): void {
    this.p2p.registerInternal(
      'get_globalaccountreport',
      async (
        _payload: unknown,
        respond: (arg0: GlobalAccountReportResp | { error: string }) => Promise<number>,
        _sender: unknown,
        _tracker: string,
        msgSize: number
      ) => {
        this.profiler.scopedProfileSectionStart('get_globalaccountreport', false, msgSize)
        let responseSize = cUninitializedSize
        try {
          const result = {
            combinedHash: '',
            accounts: [],
            ready: this.stateManager.appFinishedSyncing,
          } as GlobalAccountReportResp

          const globalAccountKeys = this.globalAccountSet.keys()

          const toQuery: string[] = []

          console.log(
            'Running get_globalaccountreport',
            this.stateManager.accountSync.globalAccountsSynced,
            this.stateManager.appFinishedSyncing
          )
          console.log('Running get_globalaccountreport result', result)
          // not ready
          if (
            this.stateManager.accountSync.globalAccountsSynced === false ||
            this.stateManager.appFinishedSyncing === false
          ) {
            result.ready = false
            await respond(result)
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
          for (const key of globalAccountKeys) {
            toQuery.push(key)
          }

          if (result.ready === false) {
            nestedCountersInstance.countEvent(`sync`, `HACKFIX - forgot to return!`)
            await respond({ error: 'Result not ready' })
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
            for (const wrappedAccount of accountData) {
              const report = {
                id: wrappedAccount.accountId,
                hash: wrappedAccount.stateId,
                timestamp: wrappedAccount.timestamp,
              }
              result.accounts.push(report)
            }
          }
          //TODO: SOON. PERF Disiable this in production or performance testing. (we need a global flag to specify if it is a release or debug build, could then implement this, along with turning off debug endpoints)
          this.stateManager.testAccountDataWrapped(accountData)

          result.accounts.sort(utils.sort_id_Asc)
          result.combinedHash = this.crypto.hash(result)
          responseSize = await respond(result)
        } finally {
          this.profiler.scopedProfileSectionEnd('get_globalaccountreport', responseSize)
        }
      }
    )

    const globalAccountReportBinaryHandler: Route<InternalBinaryHandler<Buffer>> = {
      name: InternalRouteEnum.binary_get_globalaccountreport,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      handler: async (payload, respond, header, sign) => {
        const route = InternalRouteEnum.binary_get_globalaccountreport
        nestedCountersInstance.countEvent('internal', route)
        this.profiler.scopedProfileSectionStart(route)

        const errorHandler = (
          errorType: RequestErrorEnum,
          opts?: { customErrorLog?: string; customCounterSuffix?: string }
        ): void => requestErrorHandler(route, errorType, header, opts)
        try {
          const requestStream = getStreamWithTypeCheck(payload, TypeIdentifierEnum.cGlobalAccountReportReq)
          if (!requestStream) {
            errorHandler(RequestErrorEnum.InvalidRequest)
            return respond({ error: 'Invalid request' }, serializeGlobalAccountReportResp)
          }

          const result: GlobalAccountReportRespSerializable = {
            combinedHash: '',
            accounts: [],
            ready: this.stateManager.appFinishedSyncing,
          }

          const globalAccountKeys = this.globalAccountSet.keys()

          const toQuery: string[] = []

          /* prettier-ignore */ if (logFlags.debug) console.log(`Running ${route}`, this.stateManager.accountSync.globalAccountsSynced, this.stateManager.appFinishedSyncing)
          /* prettier-ignore */ if (logFlags.debug) console.log(`Running ${route} result`, result)
          //not ready
          if (
            this.stateManager.accountSync.globalAccountsSynced === false ||
            this.stateManager.appFinishedSyncing === false
          ) {
            result.ready = false
            respond(result, serializeGlobalAccountReportResp)
            return
          }

          for (const key of globalAccountKeys) {
            toQuery.push(key)
          }

          if (result.ready === false) {
            nestedCountersInstance.countEvent(`sync`, `HACKFIX - forgot to return!`)
            const error = { error: 'Result not ready' } as GlobalAccountReportRespSerializable
            respond(error, serializeGlobalAccountReportResp)
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
            for (const wrappedAccount of accountData) {
              const report = {
                id: wrappedAccount.accountId,
                hash: wrappedAccount.stateId,
                timestamp: wrappedAccount.timestamp,
              }
              result.accounts.push(report)
            }
          }

          //TODO: SOON. PERF Disiable this in production or performance testing. (we need a global flag to specify if it is a release or debug build, could then implement this, along with turning off debug endpoints)
          this.stateManager.testAccountDataWrapped(accountData)

          result.accounts.sort(utils.sort_id_Asc)
          result.combinedHash = this.crypto.hash(result)
          respond(result, serializeGlobalAccountReportResp)
        } catch (e) {
          nestedCountersInstance.countEvent('internal', `${route}-exception`)
          this.mainLogger.error(`${route}: Exception executing request: ${utils.errorToStringFull(e)}`)
          return respond({ error: 'Internal error' }, serializeGlobalAccountReportResp)
        } finally {
          this.profiler.scopedProfileSectionEnd(route)
        }
      },
    }
    this.p2p.registerInternalBinary(
      globalAccountReportBinaryHandler.name,
      globalAccountReportBinaryHandler.handler
    )
  }

  /**
   * isGlobalAccount
   * is the account global
   * @param accountID
   */
  isGlobalAccount(accountID: string): boolean {
    return this.globalAccountSet.has(accountID)
  }

  setGlobalAccount(accountID: string): void {
    this.globalAccountSet.add(accountID)
  }

  /**
   * getGlobalListEarly
   * sync requires having knowlege of what accounts are global very early in the process.
   * This will get an early global report (note does not have account data, just id,hash,timestamp)
   */
  async getGlobalListEarly(syncFromArchiver: boolean = false): Promise<void> {
    let retriesLeft = 10

    //This will try up to 10 times to get the global list
    //if that fails we will throw an error that shoul cause an apop
    while (this.hasknownGlobals === false) {
      if (retriesLeft === 0) {
        /* prettier-ignore */ nestedCountersInstance.countEvent('sync', 'DATASYNC: getGlobalListEarly: failed to get global list after 10 retries')
        this.fatalLogger.fatal(`DATASYNC: getGlobalListEarly: failed to get global list after 10 retries`)
        throw new Error(`DATASYNC: getGlobalListEarly: failed to get global list after 10 retries`)
      }
      try {
        const globalReport: GlobalAccountReportResp =
          await this.stateManager.accountSync.getRobustGlobalReport('getGlobalListEarly', syncFromArchiver)
        const temp = []
        for (const report of globalReport.accounts) {
          temp.push(report.id)

          //set this as a known global
          this.globalAccountSet.add(report.id)
        }
        /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`DATASYNC: getGlobalListEarly: ${utils.stringifyReduce(temp)}`)
        this.hasknownGlobals = true
      } catch (err) {
        /* prettier-ignore */ nestedCountersInstance.countEvent('sync', 'DATASYNC: getRobustGlobalReport results === null')
        await utils.sleep(10000)
      } finally {
        retriesLeft--
      }
    }

    /* prettier-ignore */ nestedCountersInstance.countEvent('sync', `DATASYNC: getGlobalListEarly success:${this.hasknownGlobals}`)
  }

  getGlobalDebugReport(): {
    globalAccountSummary: { id: string; state: string; ts: number }[]
    globalStateHash: string
  } {
    const globalAccountSummary = []
    for (const globalID in this.globalAccountSet.keys()) {
      const accountHash = this.stateManager.accountCache.getAccountHash(globalID)
      const summaryObj = { id: globalID, state: accountHash.h, ts: accountHash.t }
      globalAccountSummary.push(summaryObj)
    }
    const globalStateHash = this.crypto.hash(globalAccountSummary)
    return { globalAccountSummary, globalStateHash }
  }
}

export default AccountGlobals
