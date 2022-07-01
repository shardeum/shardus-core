import * as Shardus from '../shardus/shardus-types'
import { StateManager as StateManagerTypes } from '@shardus/types'
import * as utils from '../utils'
const stringify = require('fast-stable-stringify')

import Profiler, { cUninitializedSize, profilerInstance } from '../utils/profiler'

//import { SimpleRange } from "./state-manager-types"
import {
  SimpleRange,
  AccountStateHashReq,
  AccountStateHashResp,
  GetAccountStateReq,
  GetAccountData3Req,
  GetAccountDataByRangeSmart,
  GlobalAccountReportResp,
  GetAccountData3Resp,
  CycleShardData,
  QueueEntry,
} from './state-manager-types'
import { nestedCountersInstance } from '../utils/nestedCounters'
import AccountSync from './AccountSync'
import { logFlags } from '../logger'
import { errorToStringFull } from '../utils'
import * as Comms from '../p2p/Comms'

import DataSourceHelper from './DataSourceHelper'

export default class SyncTracker {
  accountSync: AccountSync //parent sync manager

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

  reset() {
    this.addressRange = null

    this.mapAccountData = {}

    this.accountsWithStateConflict = []
    this.combinedAccountData = []
    this.failedAccounts = []

    this.syncStarted = false
    this.syncFinished = false

    this.restartCount = 0
  }

  initByRange(accountSync: AccountSync, index: number, range: StateManagerTypes.shardFunctionTypes.BasicAddressRange, cycle: number, initalSync: boolean = false) {
    // let syncTracker = { range, queueEntries: [], cycle, index, syncStarted: false, syncFinished: false,
    //isGlobalSyncTracker: false, globalAddressMap: {}, isPartOfInitialSync:initalSync, keys:{}  } as SyncTracker // partition,
    this.reset()
    this.accountSync = accountSync
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

  initGlobal(accountSync: AccountSync, index: number, cycle: number, initalSync: boolean = false) {
    // let syncTracker = { range: {}, queueEntries: [], cycle, index, syncStarted: false, syncFinished: false,
    //isGlobalSyncTracker: true, globalAddressMap: {}, isPartOfInitialSync:initalSync, keys:{} } as SyncTracker // partition,
    this.reset()
    this.accountSync = accountSync
    this.range = undefined //was {} before..
    this.queueEntries = []
    this.cycle = cycle
    this.index = index
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

  async syncStateDataForRange2() {
    let retry = true
    while (retry) {
      retry = false

      try {
        let partition = 'notUsed'
        this.currentRange = this.range
        this.addressRange = this.range // this.partitionToAddressRange(partition)

        this.partitionStartTimeStamp = Date.now()

        let lowAddress = this.addressRange.low
        let highAddress = this.addressRange.high
        partition = `${utils.stringifyReduce(lowAddress)} - ${utils.stringifyReduce(highAddress)}`

        nestedCountersInstance.countEvent('sync', `sync partition: ${partition} start: ${this.accountSync.stateManager.currentCycleShardData.cycleNumber}`)

        //this.accountSync.readyforTXs = true //Do not open the floodgates of queuing stuffs.

        let accountsSaved = await this.syncAccountData2(lowAddress, highAddress)
        if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC: partition: ${partition}, syncAccountData2 done.`)

        nestedCountersInstance.countEvent(
          'sync',
          `sync partition: ${partition} end: ${this.accountSync.stateManager.currentCycleShardData.cycleNumber} accountsSynced:${accountsSaved} failedHashes:${this.failedAccounts.length}`
        )
        this.failedAccounts = [] //clear failed hashes.  We dont try to fix them for now.  let the patcher handle it.  could bring back old code if we change mind
      } catch (error) {
        if (error.message.includes('reset-sync-ranges')) {
          this.accountSync.statemanager_fatal(`syncStateDataForRange_reset-sync-ranges`, 'DATASYNC: reset-sync-ranges: ' + errorToStringFull(error))
          //buble up:
          throw new Error('reset-sync-ranges')
        } else if (error.message.includes('FailAndRestartPartition')) {
          if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC: Error Failed at: ${error.stack}`)
          this.accountSync.statemanager_fatal(`syncStateDataForRange_ex_failandrestart`, 'DATASYNC: FailAndRestartPartition: ' + errorToStringFull(error))

          retry = await this.tryRetry('syncStateDataForRange 1')
        } else {
          this.accountSync.statemanager_fatal(`syncStateDataForRange_ex`, 'syncStateDataForPartition failed: ' + errorToStringFull(error))
          if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC: unexpected error. restaring sync:` + errorToStringFull(error))

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
  async syncStateDataGlobals() {
    let retry = true
    while (retry) {
      retry = false

      try {
        let partition = 'globals!'

        let globalAccounts = []
        let remainingAccountsToSync = []
        this.partitionStartTimeStamp = Date.now()

        if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC: syncStateDataGlobals partition: ${partition} `)

        //this.accountSync.readyforTXs = true //Do not open the floodgates of queuing stuffs.

        //Get globals list and hash.

        let globalReport: GlobalAccountReportResp = await this.accountSync.getRobustGlobalReport()

        //TODO should convert to a larger list of valid nodes
        this.dataSourceHelper.initWithList(this.accountSync.lastWinningGlobalReportNodes)

        let hasAllGlobalData = false

        if (globalReport.accounts.length === 0) {
          if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC:  syncStateDataGlobals no global accounts `)
          this.accountSync.setGlobalSyncFinished()
          return // no global accounts
        }
        if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC:  syncStateDataGlobals globalReport: ${utils.stringifyReduce(globalReport)} `)

        let accountReportsByID: { [id: string]: { id: string; hash: string; timestamp: number } } = {}
        for (let report of globalReport.accounts) {
          remainingAccountsToSync.push(report.id)

          accountReportsByID[report.id] = report
        }
        let accountData: Shardus.WrappedData[] = []
        let accountDataById: { [id: string]: Shardus.WrappedData } = {}
        let globalReport2: GlobalAccountReportResp = { ready: false, combinedHash: '', accounts: [] }
        let maxTries = 20

        //This normally should complete in one pass, but we allow 20 retries.
        //It can fail for a few reasons:
        //  -the node asked for data fails to respond, or doesn't give us any/all accounts needed
        //  -the global accounts we got back
        //
        while (hasAllGlobalData === false) {
          maxTries--
          if (maxTries <= 0) {
            if (logFlags.error) this.accountSync.mainLogger.error(`DATASYNC: syncStateDataGlobals max tries excceded `)
            return
          }
          if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC: syncStateDataGlobals hasAllGlobalData === false `)

          // Node Precheck!
          if (this.accountSync.stateManager.isNodeValidForInternalMessage(this.dataSourceHelper.dataSourceNode.id, 'syncStateDataGlobals', true, true) === false) {
            if (this.dataSourceHelper.tryNextDataSourceNode('syncStateDataGlobals1') == false) {
              break
            }
            continue
          }

          //TODO, long term. need to support cases where we could have 100k+ global accounts, and be able to make
          //paged requests.
          //This is a current non issue though.

          //Get accounts.
          let message = { accountIds: remainingAccountsToSync }
          let result = await Comms.ask(this.dataSourceHelper.dataSourceNode, 'get_account_data_by_list', message)

          if (result == null) {
            if (logFlags.verbose) if (logFlags.error) this.accountSync.mainLogger.error('ASK FAIL syncStateTableData result == null')
            if (this.dataSourceHelper.tryNextDataSourceNode('syncStateDataGlobals2') == false) {
              break
            }
            continue
          }
          if (result.accountData == null) {
            if (logFlags.verbose) if (logFlags.error) this.accountSync.mainLogger.error('ASK FAIL syncStateTableData result.accountData == null')
            if (this.dataSourceHelper.tryNextDataSourceNode('syncStateDataGlobals3') == false) {
              break
            }
            continue
          }

          accountData = accountData.concat(result.accountData)

          //Get globals list and hash (if changes then update said accounts and repeath)
          //diff the list and update remainingAccountsToSync
          // add any new accounts to globalAccounts
          if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC: syncStateDataGlobals get_account_data_by_list ${utils.stringifyReduce(result)} `)

          globalReport2 = await this.accountSync.getRobustGlobalReport()

          this.dataSourceHelper.initWithList(this.accountSync.lastWinningGlobalReportNodes)

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
            if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC: syncStateDataGlobals loop globalReport2.accounts `)
            let data = accountDataById[report.id]
            if (data == null) {
              //we dont have the data
              hasAllGlobalData = false
              remainingAccountsToSync.push(report.id)
              if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC: syncStateDataGlobals remainingAccountsToSync data===null ${utils.makeShortHash(report.id)} `)
            } else if (data.stateId !== report.hash) {
              //we have the data but he hash is wrong
              hasAllGlobalData = false
              remainingAccountsToSync.push(report.id)
              if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC: syncStateDataGlobals remainingAccountsToSync data.stateId !== report.hash ${utils.makeShortHash(report.id)} `)
            }
          }
          //set this report to the last report and continue.
          accountReportsByID = accountReportsByID2
        }

        let dataToSet = []
        let cycleNumber = this.accountSync.stateManager.currentCycleShardData.cycleNumber // Math.max(1, this.accountSync.stateManager.currentCycleShardData.cycleNumber-1 ) //kinda hacky?

        let goodAccounts: Shardus.WrappedData[] = []

        //Write the data! and set global memory data!.  set accounts copy data too.
        for (let report of globalReport2.accounts) {
          if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC: syncStateDataGlobals loop globalReport2.accounts 2`)
          let accountData = accountDataById[report.id]
          if (accountData != null) {
            dataToSet.push(accountData)
            goodAccounts.push(accountData)
          }
        }

        let failedHashes = await this.accountSync.stateManager.checkAndSetAccountData(dataToSet, 'syncStateDataGlobals', true)

        this.accountSync.syncStatement.numGlobalAccounts += dataToSet.length

        if (logFlags.console) console.log('DBG goodAccounts', goodAccounts)

        await this.accountSync.stateManager.writeCombinedAccountDataToBackups(goodAccounts, failedHashes)

        if (failedHashes && failedHashes.length > 0) {
          throw new Error('setting global data falied')
        }
        if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC: syncStateDataGlobals complete synced ${dataToSet.length} accounts `)
      } catch (error) {
        if (error.message.includes('FailAndRestartPartition')) {
          if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC: syncStateDataGlobals Error Failed at: ${error.stack}`)
          this.accountSync.statemanager_fatal(`syncStateDataGlobals_ex_failandrestart`, 'DATASYNC: syncStateDataGlobals FailAndRestartPartition: ' + errorToStringFull(error))

          retry = await this.tryRetry('syncStateDataGlobals 1 ')
        } else {
          this.accountSync.statemanager_fatal(`syncStateDataGlobals_ex`, 'syncStateDataGlobals failed: ' + errorToStringFull(error))
          if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC: unexpected error. restaring sync:` + errorToStringFull(error))

          retry = await this.tryRetry('syncStateDataGlobals 2')
        }
      }
    }

    if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC:  syncStateDataGlobals complete ${this.accountSync.syncStatement.numGlobalAccounts}`)
    this.accountSync.setGlobalSyncFinished()
  }

  async syncAccountData2(lowAddress: string, highAddress: string): Promise<number> {
    // Sync the Account data
    //   Use the /get_account_data API to get the data from the Account Table using any of the nodes that had a matching hash
    if (logFlags.console) console.log(`syncAccountData3` + '   time:' + Date.now())

    if (this.accountSync.config.stateManager == null) {
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

    //this.dataSourceHelper.dataSourceNode = null
    //this.dataSourceHelper.getDataSourceNode(lowAddress, highAddress)
    this.dataSourceHelper.initByRange(lowAddress, highAddress)

    if (this.dataSourceHelper.dataSourceNode == null) {
      if (logFlags.error) this.accountSync.mainLogger.error(`syncAccountData: dataSourceNode == null ${lowAddress} - ${highAddress}`)
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

    let askRetriesLeft = 20

    // this loop is required since after the first query we may have to adjust the address range and re-request to get the next N data entries.
    while (moreDataRemaining) {
      // Node Precheck!
      if (this.accountSync.stateManager.isNodeValidForInternalMessage(this.dataSourceHelper.dataSourceNode.id, 'syncAccountData', true, true) === false) {
        if (this.dataSourceHelper.tryNextDataSourceNode('syncAccountData1') == false) {
          break
        }
        continue
      }

      // max records artificially low to make testing coverage better.  todo refactor: make it a config or calculate based on data size
      let message = { accountStart: queryLow, accountEnd: queryHigh, tsStart: startTime, maxRecords: this.accountSync.config.stateManager.accountBucketSize, offset }
      let r: GetAccountData3Resp | boolean
      try {
        r = await Comms.ask(this.dataSourceHelper.dataSourceNode, 'get_account_data3', message) // need the repeatable form... possibly one that calls apply to allow for datasets larger than memory
      } catch (ex) {
        this.accountSync.statemanager_fatal(`syncAccountData2`, `syncAccountData2 retries:${askRetriesLeft} ask: ` + errorToStringFull(ex))
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
      let result: GetAccountData3Resp = r as GetAccountData3Resp

      if (result == null) {
        if (logFlags.verbose) if (logFlags.error) this.accountSync.mainLogger.error(`ASK FAIL syncAccountData result == null node:${this.dataSourceHelper.dataSourceNode.id}`)
        if (this.dataSourceHelper.tryNextDataSourceNode('syncAccountData2') == false) {
          break
        }
        continue
      }
      if (result.data == null) {
        if (logFlags.verbose) if (logFlags.error) this.accountSync.mainLogger.error(`ASK FAIL syncAccountData result.data == null node:${this.dataSourceHelper.dataSourceNode.id}`)
        if (this.dataSourceHelper.tryNextDataSourceNode('syncAccountData3') == false) {
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
      for (let account of accountData) {
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

        if (logFlags.debug)
          this.accountSync.mainLogger.debug(
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
          this.accountSync.mainLogger.debug(
            `DATASYNC: syncAccountData3b got ${accountData.length} more records.  last update: ${lastUpdateNeeded} extra records: ${result.data.wrappedAccounts2.length} tsStart: ${lastLowQuery} highestTS1: ${result.data.highestTs} delta:${result.data.delta} offset:${offset} sameAsStartTS:${sameAsStartTS}`
          )
        this.combinedAccountData = this.combinedAccountData.concat(accountData)
        loopCount++
        // await utils.sleep(500)
      }

      //process combinedAccountData right away and then clear it
      if (this.combinedAccountData.length > 0) {
        let accountToSave = this.combinedAccountData.length
        let accountsSaved = await this.processAccountDataNoStateTable2()
        totalAccountsSaved += accountsSaved
        if (logFlags.debug)
          this.accountSync.mainLogger.debug(`DATASYNC: syncAccountData3 accountToSave: ${accountToSave} accountsSaved: ${accountsSaved}  offset:${offset} sameAsStartTS:${sameAsStartTS}`)
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

    let missingTXs = 0
    let handledButOk = 0
    let otherMissingCase = 0
    let futureStateTableEntry = 0

    if (logFlags.debug) this.accountSync.mainLogger.debug(`DATASYNC: processAccountData unique accounts: ${uniqueAccounts}  initial combined len: ${initialCombinedAccountLength}`)

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
      this.accountSync.mainLogger.debug(
        `DATASYNC: processAccountData saving ${goodAccounts.length} of ${this.combinedAccountData.length} records to db.  noSyncData: ${noSyncData} noMatches: ${noMatches} missingTXs: ${missingTXs} handledButOk: ${handledButOk} otherMissingCase: ${otherMissingCase} outOfDateNoTxs: ${outOfDateNoTxs} futureStateTableEntry:${futureStateTableEntry} unhandledCase:${unhandledCase} fix1Worked:${fix1Worked}`
      )
    // failedHashes is a list of accounts that failed to match the hash reported by the server
    let failedHashes = await this.accountSync.stateManager.checkAndSetAccountData(goodAccounts, 'syncNonGlobals:processAccountDataNoStateTable', true) // repeatable form may need to call this in batches

    this.accountSync.syncStatement.numAccounts += goodAccounts.length

    if (failedHashes.length > 1000) {
      if (logFlags.error) this.accountSync.mainLogger.error(`DATASYNC: processAccountData failed hashes over 1000:  ${failedHashes.length} restarting sync process`)
      // recordPotentialBadnode is not implemented yet but we have it as a placeholder
      this.accountSync.stateManager.recordPotentialBadnode()
      throw new Error('FailAndRestartPartition_processAccountData_A')
    }
    if (failedHashes.length > 0) {
      if (logFlags.error) this.accountSync.mainLogger.error(`DATASYNC: processAccountData failed hashes:  ${failedHashes.length} will have to download them again`)
      // recordPotentialBadnode is not implemented yet but we have it as a placeholder
      this.accountSync.stateManager.recordPotentialBadnode()
      this.failedAccounts = this.failedAccounts.concat(failedHashes)
    }

    let accountsSaved = await this.accountSync.stateManager.writeCombinedAccountDataToBackups(goodAccounts, failedHashes)

    nestedCountersInstance.countEvent('sync', `accounts written`, accountsSaved)

    this.combinedAccountData = [] // we can clear this now.

    return accountsSaved
  }

  async tryRetry(message: string): Promise<boolean> {
    this.accountSync.mainLogger.info(`DATASYNC: tryRetry`)
    this.accountSync.logger.playbackLogState('datasyncFail', '', '')

    this.restartCount++

    if (this.restartCount > this.accountSync.config.stateManager.maxTrackerRestarts) {
      if (logFlags.error) this.accountSync.mainLogger.error(`DATASYNC: tryRetry: max tries excceded  ${this.restartCount} ${message} `)
      nestedCountersInstance.countEvent('sync', `tryRetry Out of tries ${message}`)
      throw new Error('tryRetry out of tries')
    }

    await utils.sleep(1000)

    if (this.accountSync.forceSyncComplete) {
      nestedCountersInstance.countEvent('sync', 'forceSyncComplete')
      this.accountSync.syncStatmentIsComplete()
      this.accountSync.clearSyncData()
      this.accountSync.skipSync()
      //make sync trackers clean up
      for (let syncTracker of this.accountSync.syncTrackers) {
        syncTracker.syncFinished = true
      }

      if (logFlags.error) this.accountSync.mainLogger.error(`DATASYNC: tryRetry: forceSyncComplete ${this.restartCount} ${message} `)

      nestedCountersInstance.countEvent('sync', `tryRetry: forceSyncComplete. ${this.restartCount} ${message}`)
      return false
    }

    if (logFlags.error) this.accountSync.mainLogger.error(`DATASYNC: tryRetry: ${this.restartCount} ${message} `)
    nestedCountersInstance.countEvent('sync', `tryRetry ${this.restartCount} ${message}`)
    this.accountSync.syncStatement.failAndRestart++

    return true
  }
}
