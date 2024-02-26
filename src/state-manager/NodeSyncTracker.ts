import * as Shardus from '../shardus/shardus-types'
import { StateManager as StateManagerTypes } from '@shardus/types'
import * as utils from '../utils'

import {
  SimpleRange,
  GlobalAccountReportResp,
  GetAccountData3Resp,
  QueueEntry,
  GetAccountData3Req,
} from './state-manager-types'
import { nestedCountersInstance } from '../utils/nestedCounters'
import AccountSync from './AccountSync'
import { logFlags } from '../logger'
import { errorToStringFull } from '../utils'
import { P2PModuleContext as P2P, stateManager } from '../p2p/Context'

import DataSourceHelper from './DataSourceHelper'
import { shardusGetTime } from '../network'
import { GetAccountDataByListReq, serializeGetAccountDataByListReq } from '../types/GetAccountDataByListReq'
import {
  deserializeGetAccountDataByListResp,
  GetAccountDataByListResp,
} from '../types/GetAccountDataByListResp'
import { InternalRouteEnum } from '../types/enum/InternalRouteEnum'
import { AppObjEnum } from '../shardus/shardus-types'
import { GetAccountDataReqSerializable, serializeGetAccountDataReq } from '../types/GetAccountDataReq'
import { deserializeGetAccountDataResp, GetAccountDataRespSerializable } from '../types/GetAccountDataResp'

// Not sure where to put this interface yet. I guess maybe to @shardus/types? or to state-manager-types?
// Keeping it here for now. can move it later.
export interface SyncTrackerInterface {
  // accountSync: AccountSync
  // p2p: P2P
  syncStarted: boolean
  syncFinished: boolean
  range: StateManagerTypes.shardFunctionTypes.BasicAddressRange
  // cycle: number
  // index: number
  queueEntries: QueueEntry[]
  isGlobalSyncTracker: boolean
  globalAddressMap: { [address: string]: boolean }
  isPartOfInitialSync: boolean
  keys: { [address: string]: boolean }
  // dataSourceHelper: DataSourceHelper
  // currentRange: SimpleRange
  // addressRange: SimpleRange
  // combinedAccountData: Shardus.WrappedData[]
  // accountsWithStateConflict: Shardus.WrappedData[]
  // failedAccounts: string[]
  // missingAccountData: string[]
  // mapAccountData: { [accountID: string]: Shardus.WrappedData }
  // combinedAccountStateData: Shardus.StateTableObject[]
  // partitionStartTimeStamp: number
  // restartCount: number

  // reset(): void
  initByRange(
    accountSync: AccountSync,
    p2p: P2P,
    index: number,
    range: StateManagerTypes.shardFunctionTypes.BasicAddressRange,
    cycle: number,
    initalSync?: boolean
  ): void

  initGlobal(accountSync: AccountSync, p2p: P2P, index: number, cycle: number, initalSync?: boolean): void
  syncStateDataForRange2(): Promise<void>
  syncStateDataGlobals(): Promise<void>
  // syncAccountData2?: (lowAddress: string, highAddress: string) => Promise<number>
  // processAccountDataNoStateTable2?: () => Promise<number>
  // tryRetry?: (message: string) => Promise<boolean>
}

export default class NodeSyncTracker implements SyncTrackerInterface {
  accountSync: AccountSync //parent sync manager
  p2p: P2P

  syncStarted: boolean
  syncFinished: boolean
  range: StateManagerTypes.shardFunctionTypes.BasicAddressRange
  cycle: number
  index: number
  queueEntries: QueueEntry[]

  isGlobalSyncTracker: boolean
  globalAddressMap: { [address: string]: boolean } //this appears to be unused?
  isPartOfInitialSync: boolean

  keys: { [address: string]: boolean }

  dataSourceHelper: DataSourceHelper

  //moved from accountSync
  currentRange: SimpleRange
  addressRange: SimpleRange

  combinedAccountData: Shardus.WrappedData[]
  accountsWithStateConflict: Shardus.WrappedData[]

  failedAccounts: string[]
  missingAccountData: string[]

  mapAccountData: { [accountID: string]: Shardus.WrappedData }

  combinedAccountStateData: Shardus.StateTableObject[]

  partitionStartTimeStamp: number

  restartCount: number

  reset(): void {
    this.addressRange = null

    this.mapAccountData = {}

    this.accountsWithStateConflict = []
    this.combinedAccountData = []
    this.failedAccounts = []

    this.syncStarted = false
    this.syncFinished = false

    this.restartCount = 0
  }

  initByRange(
    accountSync: AccountSync,
    p2p: P2P,
    index: number,
    range: StateManagerTypes.shardFunctionTypes.BasicAddressRange,
    cycle: number,
    initalSync = false
  ): void {
    // let syncTracker = { range, queueEntries: [], cycle, index, syncStarted: false, syncFinished: false,
    //isGlobalSyncTracker: false, globalAddressMap: {}, isPartOfInitialSync:initalSync, keys:{}  } as SyncTracker // partition,
    this.reset()
    this.accountSync = accountSync
    this.p2p = p2p
    this.range = range
    this.queueEntries = []
    this.cycle = cycle
    this.index = index
    this.isGlobalSyncTracker = false
    this.globalAddressMap = {}
    this.isPartOfInitialSync = initalSync
    this.keys = {}

    this.dataSourceHelper = new DataSourceHelper(this.accountSync.stateManager)
  }

  initGlobal(accountSync: AccountSync, p2p: P2P, index: number, cycle: number, initalSync = false): void {
    // let syncTracker = { range: {}, queueEntries: [], cycle, index, syncStarted: false, syncFinished: false,
    //isGlobalSyncTracker: true, globalAddressMap: {}, isPartOfInitialSync:initalSync, keys:{} } as SyncTracker // partition,
    this.reset()
    this.accountSync = accountSync
    this.p2p = p2p
    this.range = undefined //was {} before..
    this.queueEntries = []
    this.cycle = cycle
    this.index = index
    this.isGlobalSyncTracker = true
    this.globalAddressMap = {}
    this.isPartOfInitialSync = initalSync
    this.keys = {}

    this.dataSourceHelper = new DataSourceHelper(this.accountSync.stateManager)
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

  async syncStateDataForRange2(): Promise<void> {
    let retry = true
    while (retry) {
      retry = false

      try {
        if (this.accountSync.debugFail3) {
          nestedCountersInstance.countEvent('sync', `syncStateDataForRange2: debugFail3`)
          await utils.sleep(3000)
          //should cause apop
          throw new Error('debugFail3 syncStateDataForRange2')
        }

        let partition = 'notUsed'
        this.currentRange = this.range
        this.addressRange = this.range // this.partitionToAddressRange(partition)

        this.partitionStartTimeStamp = shardusGetTime()

        const lowAddress = this.addressRange.low
        const highAddress = this.addressRange.high
        partition = `${utils.stringifyReduce(lowAddress)} - ${utils.stringifyReduce(highAddress)}`

        /* prettier-ignore */ nestedCountersInstance.countEvent('sync', `sync partition: ${partition} start: ${this.accountSync.stateManager.currentCycleShardData.cycleNumber}`)

        //this.accountSync.readyforTXs = true //Do not open the floodgates of queuing stuffs.

        const accountsSaved = await this.syncAccountData2(lowAddress, highAddress)
        /* prettier-ignore */ if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC: partition: ${partition}, syncAccountData2 done.`)

        /* prettier-ignore */ nestedCountersInstance.countEvent( 'sync', `sync partition: ${partition} end: ${this.accountSync.stateManager.currentCycleShardData.cycleNumber} accountsSynced:${accountsSaved} failedHashes:${this.failedAccounts.length}` )
        this.failedAccounts = [] //clear failed hashes.  We dont try to fix them for now.  let the patcher handle it.  could bring back old code if we change mind
      } catch (error) {
        if (error.message.includes('reset-sync-ranges')) {
          /* prettier-ignore */ this.accountSync.statemanager_fatal( `syncStateDataForRange_reset-sync-ranges`, 'DATASYNC: reset-sync-ranges: ' + errorToStringFull(error) )
          //buble up:
          throw new Error('reset-sync-ranges')
        } else if (error.message.includes('FailAndRestartPartition')) {
          /* prettier-ignore */ if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC: Error Failed at: ${error.stack}`)
          /* prettier-ignore */ this.accountSync.statemanager_fatal( `syncStateDataForRange_ex_failandrestart`, 'DATASYNC: FailAndRestartPartition: ' + errorToStringFull(error) )

          retry = await this.tryRetry('syncStateDataForRange 1')
        } else {
          /* prettier-ignore */ this.accountSync.statemanager_fatal( `syncStateDataForRange_ex`, 'syncStateDataForPartition failed: ' + errorToStringFull(error) )
          /* prettier-ignore */ if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC: unexpected error. restaring sync:` + errorToStringFull(error))

          retry = await this.tryRetry('syncStateDataForRange 2')
        }
      }
    }
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
  async syncStateDataGlobals(): Promise<void> {
    let retry = true
    /* prettier-ignore */ nestedCountersInstance.countEvent(`sync`, `syncStateDataGlobals-start`)
    while (retry) {
      retry = false

      try {
        const partition = 'globals!'

        let remainingAccountsToSync = []
        this.partitionStartTimeStamp = shardusGetTime()

        if (this.accountSync.debugFail3) {
          nestedCountersInstance.countEvent('sync', `syncStateDataGlobals: debugFail3`)
          await utils.sleep(3000)
          //should cause apop
          throw new Error('debugFail3 syncStateDataGlobals')
        }

        /* prettier-ignore */ if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC: syncStateDataGlobals partition: ${partition} `)

        //this.accountSync.readyforTXs = true //Do not open the floodgates of queuing stuffs.

        //Get globals list and hash.
        const globalReport: GlobalAccountReportResp = await this.accountSync.getRobustGlobalReport(
          'syncTrackerGlobal'
        )

        //TODO should convert to a larger list of valid nodes
        this.dataSourceHelper.initWithList(this.accountSync.lastWinningGlobalReportNodes)

        let hasAllGlobalData = false

        if (globalReport.accounts.length === 0) {
          /* prettier-ignore */ if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC:  syncStateDataGlobals no global accounts `)
          this.accountSync.setGlobalSyncFinished()
          return // no global accounts
        }
        /* prettier-ignore */ if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC:  syncStateDataGlobals globalReport: ${utils.stringifyReduce(globalReport)} `)

        let accountReportsByID: { [id: string]: { id: string; hash: string; timestamp: number } } = {}
        for (const report of globalReport.accounts) {
          remainingAccountsToSync.push(report.id)
          accountReportsByID[report.id] = report
        }
        let accountData: Shardus.WrappedData[] = []
        const accountDataById: { [id: string]: Shardus.WrappedData } = {}
        let globalReport2: GlobalAccountReportResp = { ready: false, combinedHash: '', accounts: [] }
        let maxTries = 20

        if (this.accountSync.dataSourceTest === true) {
          if (this.dataSourceHelper.tryNextDataSourceNode('syncAccountData1') == false) {
            throw new Error('out of account nodes to ask: dataSourceTest')
          }
          while (this.accountSync.debugFail4) {
            await utils.sleep(1000)
            if (this.dataSourceHelper.tryNextDataSourceNode('syncAccountData1 debugFail4') == false) {
              throw new Error('out of account nodes to ask: dataSourceTest debugFail4')
            }
          }
        }

        //This normally should complete in one pass, but we allow 20 retries.
        //It can fail for a few reasons:
        //  -the node asked for data fails to respond, or doesn't give us any/all accounts needed
        //  -the global accounts we got back
        //
        while (hasAllGlobalData === false) {
          maxTries--
          if (maxTries <= 0) {
            /* prettier-ignore */ if (logFlags.error) this.accountSync.mainLogger.error(`DATASYNC: syncStateDataGlobals max tries excceded `)
            return
          }
          /* prettier-ignore */ if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC: syncStateDataGlobals hasAllGlobalData === false `)

          // Node Precheck!
          if (
            this.accountSync.stateManager.isNodeValidForInternalMessage(
              this.dataSourceHelper.dataSourceNode.id,
              'syncStateDataGlobals',
              true,
              true
            ) === false
          ) {
            if (this.dataSourceHelper.tryNextDataSourceNode('syncStateDataGlobals1') == false) {
              throw new Error('out of account nodes to ask: syncStateDataGlobals1')
            }
            continue
          }

          //TODO, long term. need to support cases where we could have 100k+ global accounts, and be able to make
          //paged requests.
          //This is a current non issue though.

          //Get accounts.
          const message = { accountIds: remainingAccountsToSync }
          let result
          if (stateManager.config.p2p.useBinarySerializedEndpoints) {
            result = await this.p2p.askBinary<GetAccountDataByListReq, GetAccountDataByListResp>(
              this.dataSourceHelper.dataSourceNode,
              InternalRouteEnum.binary_get_account_data_by_list,
              message,
              serializeGetAccountDataByListReq,
              deserializeGetAccountDataByListResp,
              {}
            )
          } else {
            result = await this.p2p.ask(
              this.dataSourceHelper.dataSourceNode,
              'get_account_data_by_list',
              message
            )
          }

          if (result == null) {
            /* prettier-ignore */ if (logFlags.verbose) if (logFlags.error) this.accountSync.mainLogger.error('ASK FAIL syncStateTableData result == null')
            if (this.dataSourceHelper.tryNextDataSourceNode('syncStateDataGlobals2') == false) {
              throw new Error('out of account nodes to ask: syncStateDataGlobals2')
            }
            continue
          }
          if (result.accountData == null) {
            /* prettier-ignore */ if (logFlags.verbose) if (logFlags.error) this.accountSync.mainLogger.error('ASK FAIL syncStateTableData result.accountData == null')
            if (this.dataSourceHelper.tryNextDataSourceNode('syncStateDataGlobals3') == false) {
              throw new Error('out of account nodes to ask: syncStateDataGlobals3')
            }
            continue
          }

          accountData = accountData.concat(result.accountData)

          //Get globals list and hash (if changes then update said accounts and repeath)
          //diff the list and update remainingAccountsToSync
          // add any new accounts to globalAccounts
          /* prettier-ignore */ if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC: syncStateDataGlobals get_account_data_by_list ${utils.stringifyReduce(result)} `)

          globalReport2 = await this.accountSync.getRobustGlobalReport('syncTrackerGlobal2')

          this.dataSourceHelper.initWithList(this.accountSync.lastWinningGlobalReportNodes)

          const accountReportsByID2: { [id: string]: { id: string; hash: string; timestamp: number } } = {}
          for (const report of globalReport2.accounts) {
            accountReportsByID2[report.id] = report
          }

          hasAllGlobalData = true
          remainingAccountsToSync = []
          for (const account of accountData) {
            accountDataById[account.accountId] = account
            //newer copies will overwrite older ones in this map
          }
          //check the full report for any missing data
          for (const report of globalReport2.accounts) {
            /* prettier-ignore */ if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC: syncStateDataGlobals loop globalReport2.accounts `)
            const data = accountDataById[report.id]
            if (data == null) {
              //we dont have the data
              hasAllGlobalData = false
              remainingAccountsToSync.push(report.id)
              /* prettier-ignore */ if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC: syncStateDataGlobals remainingAccountsToSync data===null ${utils.makeShortHash(report.id)} `)
            } else if (data.stateId !== report.hash) {
              //we have the data but he hash is wrong
              hasAllGlobalData = false
              remainingAccountsToSync.push(report.id)
              /* prettier-ignore */ if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC: syncStateDataGlobals remainingAccountsToSync data.stateId !== report.hash ${utils.makeShortHash(report.id)} `)
            }
          }
          //set this report to the last report and continue.
          accountReportsByID = accountReportsByID2
        }

        const dataToSet = []

        const goodAccounts: Shardus.WrappedData[] = []

        //Write the data! and set global memory data!.  set accounts copy data too.
        for (const report of globalReport2.accounts) {
          /* prettier-ignore */ if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC: syncStateDataGlobals loop globalReport2.accounts 2`)
          const accountData = accountDataById[report.id]
          if (accountData != null) {
            dataToSet.push(accountData)
            goodAccounts.push(accountData)
          }
        }

        const failedHashes = await this.accountSync.stateManager.checkAndSetAccountData(
          dataToSet,
          'syncStateDataGlobals',
          true
        )

        this.accountSync.syncStatement.numGlobalAccounts += dataToSet.length

        if (logFlags.console) console.log('DBG goodAccounts', goodAccounts)

        await this.accountSync.stateManager.writeCombinedAccountDataToBackups(goodAccounts, failedHashes)

        if (failedHashes && failedHashes.length > 0) {
          throw new Error('setting global data falied')
        }

        /* prettier-ignore */ nestedCountersInstance.countEvent(`sync`, `syncStateDataGlobals complete accounts:${dataToSet.length}`)

        /* prettier-ignore */ if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC: syncStateDataGlobals complete synced ${dataToSet.length} accounts `)
      } catch (error) {
        if (error.message.includes('FailAndRestartPartition')) {
          /* prettier-ignore */ if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC: syncStateDataGlobals Error Failed at: ${error.stack}`)
          /* prettier-ignore */ this.accountSync.statemanager_fatal( `syncStateDataGlobals_ex_failandrestart`, 'DATASYNC: syncStateDataGlobals FailAndRestartPartition: ' + errorToStringFull(error) )

          retry = await this.tryRetry('syncStateDataGlobals 1 ')
        } else {
          /* prettier-ignore */ this.accountSync.statemanager_fatal( `syncStateDataGlobals_ex`, 'syncStateDataGlobals failed: ' + errorToStringFull(error) )
          /* prettier-ignore */ if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC: unexpected error. restaring sync:` + errorToStringFull(error))

          retry = await this.tryRetry('syncStateDataGlobals 2')
        }
      }
    }

    /* prettier-ignore */ if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC:  syncStateDataGlobals complete ${this.accountSync.syncStatement.numGlobalAccounts}`)
    this.accountSync.setGlobalSyncFinished()
  }

  async syncAccountData2(lowAddress: string, highAddress: string): Promise<number> {
    // Sync the Account data
    //   Use the /get_account_data API to get the data from the Account Table using any of the nodes that had a matching hash
    if (logFlags.console) console.log(`syncAccountData3` + '   time:' + shardusGetTime())

    if (this.accountSync.config.stateManager == null) {
      throw new Error('this.config.stateManager == null')
    }
    let totalAccountsSaved = 0

    const queryLow = lowAddress
    const queryHigh = highAddress

    let moreDataRemaining = true

    this.combinedAccountData = []
    let loopCount = 0

    let startTime = 0
    let lowTimeQuery = startTime

    //this.dataSourceHelper.dataSourceNode = null
    //this.dataSourceHelper.getDataSourceNode(lowAddress, highAddress)
    this.dataSourceHelper.initByRange(lowAddress, highAddress)

    if (this.dataSourceHelper.dataSourceNode == null) {
      /* prettier-ignore */ if (logFlags.error) this.accountSync.mainLogger.error(`syncAccountData: dataSourceNode == null ${lowAddress} - ${highAddress}`)
      //if we see this then getDataSourceNode failed.
      // this is most likely because the ranges selected when we started sync are now invalid and too wide to be filled.

      //throwing this specific error text will bubble us up to the main sync loop and cause re-init of all the non global sync ranges/trackers
      throw new Error('reset-sync-ranges syncAccountData2: dataSourceNode == null')
    }

    // This flag is kind of tricky.  It tells us that the loop can go one more time after bumping up the min timestamp to check
    // If we still don't get account data then we will quit.
    // This is needed to solve a case where there are more than 2x account sync max accounts in the same timestamp
    let stopIfNextLoopHasNoResults = false

    let offset = 0
    let accountOffset = ''

    let askRetriesLeft = 20

    if (this.accountSync.dataSourceTest === true) {
      if (this.dataSourceHelper.tryNextDataSourceNode('syncAccountData1') == false) {
        throw new Error('out of account nodes to ask: dataSourceTest')
      }

      while (this.accountSync.debugFail4) {
        await utils.sleep(1000)
        if (this.dataSourceHelper.tryNextDataSourceNode('syncAccountData1 debugFail4') == false) {
          throw new Error('out of account nodes to ask: dataSourceTest debugFail4')
        }
      }
    }

    //number of times we can reset the list of nodes we ask from when they timeout
    //only available when ther is a small number of nodes.
    //we clear this if we get a good response from any node, so to fail we have to
    //get this many loop fails without any good responses
    let restartListRetriesLeft = 5
    let totalRestartList = 0

    // this loop is required since after the first query we may have to adjust the address range and re-request to get the next N data entries.
    while (moreDataRemaining) {
      let moreAskTime = 0
      // Node Precheck!
      if (
        this.accountSync.stateManager.isNodeValidForInternalMessage(
          this.dataSourceHelper.dataSourceNode.id,
          'syncAccountData',
          true,
          true
        ) === false
      ) {
        if (this.dataSourceHelper.tryNextDataSourceNode('syncAccountData1') == false) {
          if (restartListRetriesLeft <= 0) {
            /* prettier-ignore */ nestedCountersInstance.countEvent('sync', `out of account nodes to ask: syncAccountData1 totalRestartList: ${totalRestartList}`)
            throw new Error(`out of account nodes to ask: syncAccountData1 + restartList`)
          }

          if (this.dataSourceHelper.tryRestartList('syncAccountData1') === true) {
            //since we are restarting, give the node we are asking a break
            await utils.sleep(2000)
            //give even more timeout time.
            moreAskTime = 5000
            restartListRetriesLeft--
            totalRestartList++
          } else {
            throw new Error('out of account nodes to ask: syncAccountData1')
          }
        }
        continue
      }

      // max records artificially low to make testing coverage better.  todo refactor: make it a config or calculate based on data size
      const message = {
        accountStart: queryLow,
        accountEnd: queryHigh,
        tsStart: startTime,
        maxRecords: this.accountSync.config.stateManager.accountBucketSize,
        offset,
        accountOffset,
      }

      let r: GetAccountData3Resp | boolean
      try {
        if (stateManager.config.p2p.useBinarySerializedEndpoints) {
          const rBin = await this.p2p.askBinary<
            GetAccountDataReqSerializable,
            GetAccountDataRespSerializable
          >(
            this.dataSourceHelper.dataSourceNode,
            InternalRouteEnum.binary_get_account_data,
            message,
            serializeGetAccountDataReq,
            deserializeGetAccountDataResp,
            {},
            '',
            false,
            5000 + moreAskTime
          )
          if (((rBin.errors && rBin.errors.length === 0) || !rBin.errors) && rBin.data) {
            r = rBin as GetAccountData3Resp
          }
        } else {
          r = await this.p2p.ask(
            this.dataSourceHelper.dataSourceNode,
            'get_account_data3',
            message,
            false,
            '',
            5000 + moreAskTime
          ) // need the repeatable form... possibly one that calls apply to allow for datasets larger than memory
        }
      } catch (ex) {
        /* prettier-ignore */ this.accountSync.statemanager_fatal( `syncAccountData2`, `syncAccountData2 retries:${askRetriesLeft} ask: ` + errorToStringFull(ex) )
        //wait 5 sec
        await utils.sleep(5000)
        //max retries
        if (askRetriesLeft > 0) {
          askRetriesLeft--
          continue
        } else {
          throw new Error('out of account sync retries')
        }
      }

      // TSConversion need to consider better error handling here!
      const result: GetAccountData3Resp = r as GetAccountData3Resp

      if (result == null) {
        /* prettier-ignore */ if (logFlags.verbose) if (logFlags.error) this.accountSync.mainLogger.error(`ASK FAIL syncAccountData result == null node:${this.dataSourceHelper.dataSourceNode.id}`)
        if (this.dataSourceHelper.tryNextDataSourceNode('syncAccountData2') == false) {
          throw new Error('out of account nodes to ask: syncAccountData2')
        }
        continue
      }

      restartListRetriesLeft = 5

      if (result.data == null) {
        /* prettier-ignore */ if (logFlags.verbose) if (logFlags.error) this.accountSync.mainLogger.error(`ASK FAIL syncAccountData result.data == null node:${this.dataSourceHelper.dataSourceNode.id}`)
        if (this.dataSourceHelper.tryNextDataSourceNode('syncAccountData3') == false) {
          throw new Error('out of account nodes to ask: syncAccountData3')
        }
        continue
      }
      // accountData is in the form [{accountId, stateId, data}] for n accounts.
      const accountData = result.data.wrappedAccounts
      const lastUpdateNeeded = result.data.lastUpdateNeeded

      const lastLowQuery = lowTimeQuery

      // get the timestamp of the last account data received so we can use it as the low timestamp for our next query
      if (accountData.length > 0) {
        const lastAccount = accountData[accountData.length - 1]
        if (lastAccount.timestamp > lowTimeQuery) {
          lowTimeQuery = lastAccount.timestamp
          startTime = lowTimeQuery
        }
      }

      let sameAsStartTS = 0
      let sameAsLastTS = 0
      let lastLoopTS = -1
      //need to track some counters to help with offset calculations
      for (const account of accountData) {
        if (account.timestamp === lastLowQuery) {
          sameAsStartTS++
        }
        if (account.timestamp === lastLoopTS) {
          sameAsLastTS++
        } else {
          sameAsLastTS = 0
          lastLoopTS = account.timestamp
        }
      }

      // If this is a repeated query, clear out any dupes from the new list we just got.
      // There could be many rows that use the stame timestamp so we will search and remove them
      let dataDuplicated = true
      if (loopCount > 0) {
        while (accountData.length > 0 && dataDuplicated) {
          const stateData = accountData[0]
          dataDuplicated = false

          //todo get rid of this in next verision
          for (let i = this.combinedAccountData.length - 1; i >= 0; i--) {
            // eslint-disable-next-line security/detect-object-injection
            const existingStateData = this.combinedAccountData[i]
            if (
              existingStateData.timestamp === stateData.timestamp &&
              existingStateData.accountId === stateData.accountId
            ) {
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
      if (lastLowQuery === lowTimeQuery) {
        //update offset, so we can get next page of data
        //offset+= (result.data.wrappedAccounts.length + result.data.wrappedAccounts2.length)
        offset += sameAsLastTS //conservative offset!
      } else {
        //clear offset
        offset = 0
      }
      if (accountData.length < message.maxRecords) {
        //bump clock up because we didn't get a full data return
        startTime++
        //dont need offset because we should already have all the records
        offset = 0
      }

      //clear account offset for next pass
      accountOffset = ''
      // if we would use an offset, then set an account offset
      if (this.accountSync.config.stateManager.syncWithAccountOffset === true) {
        if (offset > 0) {
          accountOffset = accountData[accountData.length - 1].accountId
        }
      }

      // if we have any accounts in wrappedAccounts2
      const accountData2 = result.data.wrappedAccounts2
      if (accountData2.length > 0) {
        while (accountData.length > 0 && dataDuplicated) {
          const stateData = accountData2[0]
          dataDuplicated = false
          for (let i = this.combinedAccountData.length - 1; i >= 0; i--) {
            // eslint-disable-next-line security/detect-object-injection
            const existingStateData = this.combinedAccountData[i]
            if (
              existingStateData.timestamp === stateData.timestamp &&
              existingStateData.accountId === stateData.accountId
            ) {
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
        if (lastUpdateNeeded) {
          //we are done
          moreDataRemaining = false
        } else {
          if (stopIfNextLoopHasNoResults === true) {
            //we are done
            moreDataRemaining = false
          } else {
            //bump start time and loop once more!
            //If we don't get anymore accounts on that loopl then we will quit for sure
            //If we do get more accounts then stopIfNextLoopHasNoResults will reset in a branch below
            startTime++
            loopCount++
            stopIfNextLoopHasNoResults = true
          }
        }

        /* prettier-ignore */ if (logFlags.debug) this.accountSync.mainLogger.debug( `DATASYNC: syncAccountData3 got ${accountData.length} more records.  last update: ${lastUpdateNeeded} extra records: ${result.data.wrappedAccounts2.length} tsStart: ${lastLowQuery} highestTS1: ${result.data.highestTs} delta:${result.data.delta} offset:${offset} sameAsStartTS:${sameAsStartTS}` )
        if (accountData.length > 0) {
          this.combinedAccountData = this.combinedAccountData.concat(accountData)
        }
        if (accountData2.length > 0) {
          this.combinedAccountData = this.combinedAccountData.concat(accountData2)
        }
      } else {
        //we got accounts this time so reset this flag to false
        stopIfNextLoopHasNoResults = false
        /* prettier-ignore */ if (logFlags.debug) this.accountSync.mainLogger.debug( `DATASYNC: syncAccountData3b got ${accountData.length} more records.  last update: ${lastUpdateNeeded} extra records: ${result.data.wrappedAccounts2.length} tsStart: ${lastLowQuery} highestTS1: ${result.data.highestTs} delta:${result.data.delta} offset:${offset} sameAsStartTS:${sameAsStartTS}` )
        this.combinedAccountData = this.combinedAccountData.concat(accountData)
        loopCount++
        // await utils.sleep(500)
      }

      //process combinedAccountData right away and then clear it
      if (this.combinedAccountData.length > 0) {
        const accountToSave = this.combinedAccountData.length
        const accountsSaved = await this.processAccountDataNoStateTable2()
        totalAccountsSaved += accountsSaved
        /* prettier-ignore */ if (logFlags.debug) this.accountSync.mainLogger.debug( `DATASYNC: syncAccountData3 accountToSave: ${accountToSave} accountsSaved: ${accountsSaved}  offset:${offset} sameAsStartTS:${sameAsStartTS}` )
        //clear data
        this.combinedAccountData = []
      }
      await utils.sleep(200)
    }

    return totalAccountsSaved
  }

  async processAccountDataNoStateTable2(): Promise<number> {
    this.missingAccountData = []
    this.mapAccountData = {}
    // create a fast lookup map for the accounts we have.  Perf.  will need to review if this fits into memory.  May need a novel structure.
    let account: Shardus.WrappedData
    for (let i = 0; i < this.combinedAccountData.length; i++) {
      // eslint-disable-next-line security/detect-object-injection
      account = this.combinedAccountData[i]
      this.mapAccountData[account.accountId] = account
    }

    const accountKeys = Object.keys(this.mapAccountData)
    const uniqueAccounts = accountKeys.length
    const initialCombinedAccountLength = this.combinedAccountData.length
    if (uniqueAccounts < initialCombinedAccountLength) {
      // keep only the newest copies of each account:
      // we need this if using a time based datasync
      this.combinedAccountData = []
      for (const accountID of accountKeys) {
        // eslint-disable-next-line security/detect-object-injection
        this.combinedAccountData.push(this.mapAccountData[accountID])
      }
    }

    const missingTXs = 0
    const handledButOk = 0
    const otherMissingCase = 0
    const futureStateTableEntry = 0

    /* prettier-ignore */ if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC: processAccountData unique accounts: ${uniqueAccounts}  initial combined len: ${initialCombinedAccountLength}`)

    this.accountsWithStateConflict = []
    const goodAccounts: Shardus.WrappedData[] = []
    const noSyncData = 0
    const noMatches = 0
    const outOfDateNoTxs = 0
    const unhandledCase = 0
    const fix1Worked = 0
    for (const account of this.combinedAccountData) {
      goodAccounts.push(account)
    }

    /* prettier-ignore */ if (logFlags.debug) this.accountSync.mainLogger.debug( `DATASYNC: processAccountData saving ${goodAccounts.length} of ${this.combinedAccountData.length} records to db.  noSyncData: ${noSyncData} noMatches: ${noMatches} missingTXs: ${missingTXs} handledButOk: ${handledButOk} otherMissingCase: ${otherMissingCase} outOfDateNoTxs: ${outOfDateNoTxs} futureStateTableEntry:${futureStateTableEntry} unhandledCase:${unhandledCase} fix1Worked:${fix1Worked}` )
    // failedHashes is a list of accounts that failed to match the hash reported by the server
    const failedHashes = await this.accountSync.stateManager.checkAndSetAccountData(
      goodAccounts,
      'syncNonGlobals:processAccountDataNoStateTable',
      true
    ) // repeatable form may need to call this in batches

    this.accountSync.syncStatement.numAccounts += goodAccounts.length

    if (failedHashes.length > 1000) {
      /* prettier-ignore */ if (logFlags.error) this.accountSync.mainLogger.error(`DATASYNC: processAccountData failed hashes over 1000:  ${failedHashes.length} restarting sync process`)
      // recordPotentialBadnode is not implemented yet but we have it as a placeholder
      this.accountSync.stateManager.recordPotentialBadnode()
      throw new Error('FailAndRestartPartition_processAccountData_A')
    }
    if (failedHashes.length > 0) {
      /* prettier-ignore */ if (logFlags.error) this.accountSync.mainLogger.error(`DATASYNC: processAccountData failed hashes:  ${failedHashes.length} will have to download them again`)
      // recordPotentialBadnode is not implemented yet but we have it as a placeholder
      this.accountSync.stateManager.recordPotentialBadnode()
      this.failedAccounts = this.failedAccounts.concat(failedHashes)
    }

    const accountsSaved = await this.accountSync.stateManager.writeCombinedAccountDataToBackups(
      goodAccounts,
      failedHashes
    )

    nestedCountersInstance.countEvent('sync', `accounts written`, accountsSaved)

    this.combinedAccountData = [] // we can clear this now.

    return accountsSaved
  }

  async tryRetry(message: string): Promise<boolean> {
    this.accountSync.mainLogger.info(`DATASYNC: tryRetry`)
    this.accountSync.logger.playbackLogState('datasyncFail', '', '')

    this.restartCount++

    if (this.restartCount > this.accountSync.config.stateManager.maxTrackerRestarts) {
      /* prettier-ignore */ if (logFlags.error) this.accountSync.mainLogger.error(`DATASYNC: tryRetry: max tries excceded  ${this.restartCount} ${message} `)
      nestedCountersInstance.countEvent('sync', `tryRetry Out of tries ${message}`)
      //reset-sync-ranges is code that gets special exception handling.
      //todo: replace this with something that does not rely on string operations
      throw new Error('reset-sync-ranges tryRetry out of tries')
    }

    await utils.sleep(1000)

    if (this.accountSync.forceSyncComplete) {
      nestedCountersInstance.countEvent('sync', 'forceSyncComplete')
      this.accountSync.syncStatmentIsComplete()
      this.accountSync.clearSyncData()
      this.accountSync.skipSync()
      //make sync trackers clean up
      for (const syncTracker of this.accountSync.syncTrackers) {
        syncTracker.syncFinished = true
      }

      /* prettier-ignore */ if (logFlags.error) this.accountSync.mainLogger.error(`DATASYNC: tryRetry: forceSyncComplete ${this.restartCount} ${message} `)

      /* prettier-ignore */ nestedCountersInstance.countEvent('sync', `tryRetry: forceSyncComplete. ${this.restartCount} ${message}`)
      return false
    }

    /* prettier-ignore */ if (logFlags.error) this.accountSync.mainLogger.error(`DATASYNC: tryRetry: ${this.restartCount} ${message} `)
    nestedCountersInstance.countEvent('sync', `tryRetry ${this.restartCount} ${message}`)
    this.accountSync.syncStatement.failAndRestart++

    return true
  }
}
