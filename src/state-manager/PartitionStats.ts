import * as Shardus from '../shardus/shardus-types'
import * as utils from '../utils'
import { safeStringify } from '@shardus/types/build/src/utils/functions/stringify'

import Profiler from '../utils/profiler'
import Crypto from '../crypto'
import Logger, { logFlags } from '../logger'
import AccountCache from './AccountCache'
import StateManager from '.'
import { AccountHashCache, QueueEntry, CycleShardData } from './state-manager-types'
import { StateManager as StateManagerTypes } from '@shardus/types'
import * as Context from '../p2p/Context'
import * as Wrapper from '../p2p/Wrapper'
import { isDebugModeMiddleware } from '../network/debugMiddleware'
import Log4js from 'log4js'
import { Response } from 'express-serve-static-core'

type RawAccountData = { data: { data: { balance: string } } | { balance: string } } | { balance: string }
type Line = { raw: string; file: { owner: string } }

/**
 * PartitionStats is a system that allows the dapp to build custom anonymous tallies of accounts and committed TXs.
 * This code manages opaque blobs and then uploads them once a cycle as part of a report.
 * This can ultimately allow for a sort of map reduce that helps and explorer server figure out things like
 * total account balance, or number of accounts, etc.
 *
 * Other state manager modules need to call a few functions to make this work:
 * -When a new account is seen for the first time (create or synced or other?) it calls statsDataSummaryInit()
 * -When an account is updated it calls statsDataSummaryUpdate() and passes in the last and current copy of the account
 * -When a TX is committed statsTxSummaryUpdate() is called
 *
 * These call results in calls to the dapp.  This code creates and maintains opaqueBlobs.  This code should not understand
 * what is in the blob, it just has to hand the correct blob to the dapp for updating.  The dapp does not have to worry about complex
 * address math to figure out what opaqueBlob should be used!
 *
 * Once per cycle buildStatsReport() is called to generate a summary for any stats data that this node has consensus coverage over.
 *
 * --------------Everything else is just debug support, or support accessors.
 *
 * A few other notes.
 * -TX stats are bucketed per cycle per stat partition and the tally starts freash each cycle
 * -DATA(account) stats bucketed by stat partition only.  The update operations go through a queue
 *  that is synchronized to only commit the stats as a cycle is "ready" i.e. old enough that nodes can be in sync.
 *
 * Debug notes:
 *   -there is are some debug endpoints but they will only work with smaller numbers of nodes.
 *    get-stats-report-all
 *
 *   -shardus-scan tool can do stats analysis if you pass in the folder your instances are in.  ex:
 *    node .\statsReport.js C:\shardus\gitlab\liberdus-server5\instances
 *
 *   it is almost impossible to trace failures without turning invasiveDebugInfo on. (but never check it in as true!)
 *    invasiveDebugInfo allows stats report to have enough clue to determine which accounts or
 *    TXs are missing, and which nodes voted on which opaqueBlobs.
 *
 */
class PartitionStats {
  app: Shardus.App
  crypto: Crypto
  config: Shardus.StrictServerConfiguration
  profiler: Profiler

  logger: Logger

  stateManager: StateManager

  mainLogger: Log4js.Logger
  fatalLogger: Log4js.Logger
  shardLogger: Log4js.Logger
  statsLogger: Log4js.Logger

  summaryBlobByPartition: Map<number, StateManagerTypes.StateManagerTypes.SummaryBlob>
  summaryPartitionCount: number
  txSummaryBlobCollections: StateManagerTypes.StateManagerTypes.SummaryBlobCollection[]
  extensiveRangeChecking: boolean // non required range checks that can show additional errors (should not impact flow control)

  accountCache: AccountCache

  invasiveDebugInfo: boolean //inject some data into opaque blobs to improve our debugging (Never use in production)

  statsProcessCounter: number //counter used to help log analys since there is now a queue and delay effect goin on with stats.
  maxCyclesToStoreBlob: number

  statemanager_fatal: (key: string, log: string) => void

  /** buildStatsReport uses the work queue to build stats reports at the correct times.  do not add items to work queue if stats are disabled */
  workQueue: { cycle: number; fn: (...args: unknown[]) => unknown; args: unknown[] }[]

  constructor(
    stateManager: StateManager,
    profiler: Profiler,
    app: Shardus.App,
    logger: Logger,
    crypto: Crypto,
    config: Shardus.StrictServerConfiguration,
    accountCache: AccountCache
  ) {
    if (stateManager == null) return //for debug testing.

    this.crypto = crypto
    this.app = app
    this.logger = logger
    this.config = config
    this.profiler = profiler

    this.mainLogger = logger.getLogger('main')
    this.fatalLogger = logger.getLogger('fatal')
    this.shardLogger = logger.getLogger('shardDump')
    this.statsLogger = logger.getLogger('statsDump')
    this.statemanager_fatal = stateManager.statemanager_fatal
    this.stateManager = stateManager
    this.accountCache = accountCache

    //Init Summary Blobs
    this.summaryPartitionCount = 4096 //32 //TODO my next branch will address this.  Needs to be 4096! (and some other support)

    this.extensiveRangeChecking = true //leaving true for now may go away with next update

    this.summaryBlobByPartition = new Map()
    this.txSummaryBlobCollections = []

    this.invasiveDebugInfo = false //SET THIS TO TRUE FOR INVASIVE DEBUG INFO (dont check it in as true)...todo add config

    this.statsProcessCounter = 0

    this.workQueue = []

    this.maxCyclesToStoreBlob = 10

    this.initSummaryBlobs()
  }

  /***
   *    ######## ##    ## ########  ########   #######  #### ##    ## ########  ######
   *    ##       ###   ## ##     ## ##     ## ##     ##  ##  ###   ##    ##    ##    ##
   *    ##       ####  ## ##     ## ##     ## ##     ##  ##  ####  ##    ##    ##
   *    ######   ## ## ## ##     ## ########  ##     ##  ##  ## ## ##    ##     ######
   *    ##       ##  #### ##     ## ##        ##     ##  ##  ##  ####    ##          ##
   *    ##       ##   ### ##     ## ##        ##     ##  ##  ##   ###    ##    ##    ##
   *    ######## ##    ## ########  ##         #######  #### ##    ##    ##     ######
   */

  setupHandlers(): void {
    /**
     *
     *
     * Usage: http://<NODE_IP>:<NODE_EXT_PORT>/get-stats-dum?cycle=x
     */
    Context.network.registerExternalGet('get-stats-dump', isDebugModeMiddleware, (req, res) => {
      let cycle = this.stateManager.currentCycleShardData.cycleNumber - 2

      if (req.query.cycle != null) {
        cycle = Number(req.query.cycle)
      }

      let cycleShardValues = null
      if (this.stateManager.shardValuesByCycle.has(cycle)) {
        cycleShardValues = this.stateManager.shardValuesByCycle.get(cycle)
      }

      const blob = this.dumpLogsForCycle(cycle, false, cycleShardValues)

      res.write(safeStringify(blob) + '\n')
      res.end()
    })

    /**
     *
     *
     * Usage: http://<NODE_IP>:<NODE_EXT_PORT>/get-stats-report-all?raw=<true/fale>
     */
    Context.network.registerExternalGet('get-stats-report-all', isDebugModeMiddleware, async (req, res) => {
      try {
        const raw = req.query.raw

        const cycleNumber = this.stateManager.currentCycleShardData.cycleNumber - 2
        //wow, why does Context.p2p not work..
        res.write(`building shard report c:${cycleNumber} \n`)
        const activeNodes = Wrapper.p2p.state.getNodes()
        const lines = []
        if (activeNodes) {
          for (const node of activeNodes.values()) {
            const getResp = await this.logger._internalHackGetWithResp(
              `${node.externalIp}:${node.externalPort}/get-stats-dump?cycle=${cycleNumber}`
            )
            if (getResp.body != null && getResp.body != '') {
              lines.push({ raw: getResp.body, file: { owner: `${node.externalIp}:${node.externalPort}` } })
            }
          }
          //raw dump or compute?
          if (raw === 'true') {
            res.write(JSON.stringify(lines))
          } else {
            {
              const {
                allPassed,
                allPassedMetric2,
                singleVotePartitions,
                multiVotePartitions,
                badPartitions,
                totalTx,
              } = this.processTxStatsDump(res, this.txStatsTallyFunction, lines)
              res.write(
                `TX statsReport${cycleNumber}  : ${allPassed} pass2: ${allPassedMetric2}  single:${singleVotePartitions} multi:${multiVotePartitions} badPartitions:${badPartitions} totalTx:${totalTx}\n`
              )
            }
            {
              const {
                allPassed,
                allPassedMetric2,
                singleVotePartitions,
                multiVotePartitions,
                badPartitions,
              } = this.processDataStatsDump(res, this.dataStatsTallyFunction, lines)
              res.write(
                `DATA statsReport${cycleNumber}  : ${allPassed} pass2: ${allPassedMetric2}  single:${singleVotePartitions} multi:${multiVotePartitions} badPartitions:${badPartitions}\n`
              )
            }
          }
        }
        //res.write(`this node in sync:${this.failedLastTrieSync} \n`)
      } catch (e) {
        res.write(`${e}\n`)
      }
      res.end()
    })
  }

  /***
   *    #### ##    ## #### ########       ###    ##    ## ########        ###     ######   ######  ########  ######   ######
   *     ##  ###   ##  ##     ##         ## ##   ###   ## ##     ##      ## ##   ##    ## ##    ## ##       ##    ## ##    ##
   *     ##  ####  ##  ##     ##        ##   ##  ####  ## ##     ##     ##   ##  ##       ##       ##       ##       ##
   *     ##  ## ## ##  ##     ##       ##     ## ## ## ## ##     ##    ##     ## ##       ##       ######    ######   ######
   *     ##  ##  ####  ##     ##       ######### ##  #### ##     ##    ######### ##       ##       ##             ##       ##
   *     ##  ##   ###  ##     ##       ##     ## ##   ### ##     ##    ##     ## ##    ## ##    ## ##       ##    ## ##    ##
   *    #### ##    ## ####    ##       ##     ## ##    ## ########     ##     ##  ######   ######  ########  ######   ######
   */

  /**
   * get a new data summary blob
   * note that opaqueBlob is what we eventually show to the dapp.
   * This code should not understand opaqueBlob *other than some debug only hacks hardcoded for liberdus
   * @param partition
   */
  getNewSummaryBlob(partition: number): StateManagerTypes.StateManagerTypes.SummaryBlob {
    return { counter: 0, latestCycle: 0, errorNull: 0, partition, opaqueBlob: {} }
  }

  /**
   * init the data stats blobs
   */
  initSummaryBlobs(): void {
    // sparse blobs!
    // for (let i = 0; i < this.summaryPartitionCount; i++) {
    //   this.summaryBlobByPartition.set(i, this.getNewSummaryBlob(i))
    // }
  }

  /**
   * Init the TX summary blobs
   * @param cycleNumber
   */
  initTXSummaryBlobsForCycle(cycleNumber: number): StateManagerTypes.StateManagerTypes.SummaryBlobCollection {
    const summaryBlobCollection = { cycle: cycleNumber, blobsByPartition: new Map() }
    for (let i = 0; i < this.summaryPartitionCount; i++) {
      summaryBlobCollection.blobsByPartition.set(i, this.getNewSummaryBlob(i))
    }
    this.txSummaryBlobCollections.push(summaryBlobCollection)
    if (this.txSummaryBlobCollections.length > this.maxCyclesToStoreBlob) {
      this.txSummaryBlobCollections = this.txSummaryBlobCollections.slice(
        this.txSummaryBlobCollections.length - this.maxCyclesToStoreBlob
      )
      /* prettier-ignore */ if (logFlags.verbose) this.mainLogger.debug('Pruned txSumamryBlobCollections', this.txSummaryBlobCollections.length)
    }
    return summaryBlobCollection
  }

  /**
   * gets the TX summary blob partition for the given cycle.  (should be the TX's cycleToRecordOn).
   * @param cycle
   */
  getOrCreateTXSummaryBlobCollectionByCycle(
    cycle: number
  ): StateManagerTypes.StateManagerTypes.SummaryBlobCollection {
    let summaryBlobCollectionToUse = null
    if (cycle < 0) {
      return null
    }
    for (let i = this.txSummaryBlobCollections.length - 1; i >= 0; i--) {
      // index is a number and never out of bounds
      // eslint-disable-next-line security/detect-object-injection
      const summaryBlobCollection = this.txSummaryBlobCollections[i]
      if (summaryBlobCollection.cycle === cycle) {
        summaryBlobCollectionToUse = summaryBlobCollection
        break
      }
    }
    if (summaryBlobCollectionToUse === null) {
      summaryBlobCollectionToUse = this.initTXSummaryBlobsForCycle(cycle)
    }
    return summaryBlobCollectionToUse
  }

  // requires exactly 4096 partitions.
  getSummaryBlobPartition(address: string): number {
    const threebyteHex = address.slice(0, 3)
    const summaryPartition = Number.parseInt(threebyteHex, 16)

    return summaryPartition
  }

  /**
   * Get the correct summary blob that matches this address.
   * Address must be in the account space. (i.e. AccountIDs)
   * Never pass a TX id into this (we use the first sorted writable account key for a TX)
   * @param address
   */
  getSummaryBlob(address: string): StateManagerTypes.StateManagerTypes.SummaryBlob {
    const partition = this.getSummaryBlobPartition(address)

    //lazy create summary blob.  TODO way to clean long unused/uncoveraged blobs? (could help with memory in a minor way)
    if (this.summaryBlobByPartition.has(partition) === false) {
      this.summaryBlobByPartition.set(partition, this.getNewSummaryBlob(partition))
    }

    const blob: StateManagerTypes.StateManagerTypes.SummaryBlob = this.summaryBlobByPartition.get(partition)
    return blob
  }

  //todo , I think this is redundant and removable now.
  hasAccountBeenSeenByStats(accountId: string): boolean {
    return this.accountCache.hasAccount(accountId)
  }

  /**
   * Figures out what snapshot partitions are fully covered by our consensus partitions.
   * Note these partitions are not in the same address space!.
   * There is one consenus partition per node in the network.  (each node covers them in a radius)
   * Snapshot partitions are currently a fixed count so that we don't have to recompute all of the summaries each cycle when the
   * network topology changes
   * @param cycleShardData
   * //the return value is a bit obtuse. should decide if a list or map output is better, or are they both needed.
   */
  // getConsensusSnapshotPartitions(cycleShardData: CycleShardData): { list: number[]; map: Map<number, boolean> } {
  //   //figure out which summary partitions are fully covered by
  //   let result = { list: [], map: new Map() }
  //   for (let i = 0; i < this.summaryPartitionCount; i++) {
  //     // 2^32  4294967296 or 0xFFFFFFFF + 1
  //     let addressLowNum = (i / this.summaryPartitionCount) * (0xffffffff + 1)
  //     let addressHighNum = ((i + 1) / this.summaryPartitionCount) * (0xffffffff + 1) - 1
  //     let inRangeLow = ShardFunctions.testAddressNumberInRange(addressLowNum, cycleShardData.nodeShardData.consensusPartitions)
  //     let inRangeHigh = false
  //     if (inRangeLow) {
  //       inRangeHigh = ShardFunctions.testAddressNumberInRange(addressHighNum, cycleShardData.nodeShardData.consensusPartitions)
  //     }
  //     if (inRangeLow && inRangeHigh) {
  //       result.list.push(i)
  //       result.map.set(i, true)
  //     }
  //   }
  //   return result
  // }

  /**
   *
   * @param cycleShardData
   */
  getConsensusSnapshotPartitions(cycleShardData: CycleShardData): {
    list: number[]
    map: Map<number, boolean>
  } {
    //figure out which summary partitions are fully covered by
    const result = { list: [], map: new Map() }

    const consensusStartPartition = cycleShardData.nodeShardData.consensusStartPartition
    const consensusEndPartition = cycleShardData.nodeShardData.consensusEndPartition

    const outOfRange = this.stateManager.accountPatcher.getNonParitionRanges(
      cycleShardData,
      consensusStartPartition,
      consensusEndPartition,
      3
    )

    if (outOfRange.length === 0) {
      return result
    }
    let lowN: number, highN: number, lowN2: number, highN2: number
    let twoRanges = false

    //note we dialate the ranges by 1. the partitions are already dialated by one but that is not enough.
    // this might sometimes result on us not covering a stat partition we could have, but the alternative is another 60 lines of code similar
    // to getNonParitionRanges
    if (outOfRange.length >= 1) {
      lowN = Number.parseInt(outOfRange[0].low.slice(0, 3), 16) - 1
      highN = Number.parseInt(outOfRange[0].high.slice(0, 3), 16) + 1
    }
    if (outOfRange.length >= 2) {
      lowN2 = Number.parseInt(outOfRange[1].low.slice(0, 3), 16) - 1
      highN2 = Number.parseInt(outOfRange[1].high.slice(0, 3), 16) + 1
      twoRanges = true
    }

    for (let i = 0; i < this.summaryPartitionCount; i++) {
      if (i <= highN && i >= lowN) {
        continue //out of range 1
      }
      if (twoRanges && i <= highN2 && i >= lowN2) {
        continue //out of range 2
      }

      //else it is covered
      result.list.push(i)
      result.map.set(i, true)
    }

    return result
  }

  /***
   *    #### ##    ## #### ########       ########     ###    ########    ###           ######  ########    ###    ########  ######
   *     ##  ###   ##  ##     ##          ##     ##   ## ##      ##      ## ##         ##    ##    ##      ## ##      ##    ##    ##
   *     ##  ####  ##  ##     ##          ##     ##  ##   ##     ##     ##   ##        ##          ##     ##   ##     ##    ##
   *     ##  ## ## ##  ##     ##          ##     ## ##     ##    ##    ##     ##        ######     ##    ##     ##    ##     ######
   *     ##  ##  ####  ##     ##          ##     ## #########    ##    #########             ##    ##    #########    ##          ##
   *     ##  ##   ###  ##     ##          ##     ## ##     ##    ##    ##     ##       ##    ##    ##    ##     ##    ##    ##    ##
   *    #### ##    ## ####    ##          ########  ##     ##    ##    ##     ##        ######     ##    ##     ##    ##     ######
   */

  /**
   * If we have never seen this account before then call init on it.
   * This will queue an opertation that will lead to calling
   *    this.app.dataSummaryInit()
   * so that the dapp can define how to tally a newly seen account
   * @param cycle
   * @param accountId
   * @param accountDataRaw
   * @param debugMsg
   */
  statsDataSummaryInit(cycle: number, accountId: string, accountDataRaw: unknown, debugMsg: string): void {
    const opCounter = this.statsProcessCounter++
    if (this.invasiveDebugInfo)
      this.mainLogger.debug(
        `statData enter:statsDataSummaryInit op:${opCounter} c:${cycle} ${debugMsg} accForBin:${utils.makeShortHash(
          accountId
        )}  inputs:${JSON.stringify({ accountDataRaw })}`
      )

    const blob: StateManagerTypes.StateManagerTypes.SummaryBlob = this.getSummaryBlob(accountId)
    blob.counter++

    if (this.accountCache.hasAccount(accountId)) {
      return
    }
    const accountInfo = this.app.getTimestampAndHashFromAccount(accountDataRaw)
    this.accountCache.updateAccountHash(accountId, accountInfo.hash, accountInfo.timestamp, cycle)

    if (accountDataRaw == null) {
      blob.errorNull++
      if (logFlags.error) this.mainLogger.error(`statsDataSummaryInit errorNull`)
      return
    }

    if (this.stateManager.feature_generateStats === true) {
      this.workQueue.push({
        cycle,
        fn: this.internalDoInit,
        args: [cycle, blob, accountDataRaw, accountId, opCounter],
      })
    }
  }

  /**
   * The internal function that calls into the app.
   * this has to go into a queue so that it can be caled only when the call
   * is for a valid cycle# (i.e. old enough cycle that we can have consistent results)
   * @param cycle
   * @param blob
   * @param accountDataRaw
   * @param accountId
   * @param opCounter
   */
  private internalDoInit(
    cycle: number,
    blob: StateManagerTypes.StateManagerTypes.SummaryBlob,
    accountDataRaw: RawAccountData,
    accountId: string,
    opCounter: number
  ): void {
    if (cycle > blob.latestCycle) {
      blob.latestCycle = cycle
    }

    this.app.dataSummaryInit(blob.opaqueBlob, accountDataRaw)

    if (this.invasiveDebugInfo)
      this.mainLogger.debug(
        `statData:statsDataSummaryInit op:${opCounter} c:${cycle} accForBin:${utils.makeShortHash(
          accountId
        )} ${this.debugAccountData(accountDataRaw)}`
      )
    if (this.invasiveDebugInfo) this.addDebugToBlob(blob, accountId)
  }

  /***
   *    ##     ## ########  ########     ###    ######## ########       ########     ###    ########    ###           ######  ########    ###    ########  ######
   *    ##     ## ##     ## ##     ##   ## ##      ##    ##             ##     ##   ## ##      ##      ## ##         ##    ##    ##      ## ##      ##    ##    ##
   *    ##     ## ##     ## ##     ##  ##   ##     ##    ##             ##     ##  ##   ##     ##     ##   ##        ##          ##     ##   ##     ##    ##
   *    ##     ## ########  ##     ## ##     ##    ##    ######         ##     ## ##     ##    ##    ##     ##        ######     ##    ##     ##    ##     ######
   *    ##     ## ##        ##     ## #########    ##    ##             ##     ## #########    ##    #########             ##    ##    #########    ##          ##
   *    ##     ## ##        ##     ## ##     ##    ##    ##             ##     ## ##     ##    ##    ##     ##       ##    ##    ##    ##     ##    ##    ##    ##
   *     #######  ##        ########  ##     ##    ##    ########       ########  ##     ##    ##    ##     ##        ######     ##    ##     ##    ##     ######
   */

  /**
   *
   * This will queue an opertation that will lead to calling
   *    this.app.dataSummaryUpdate()
   * so that the dapp can define how to tally an updated account.
   * and old copy and current copy of the account are passed in.
   *    WARNING. current limitation can not guarantee if there are intermediate states
   *    between these two accounts.  Need to write user facing docs on this.
   *
   * @param cycle
   * @param accountDataBefore
   * @param accountDataAfter
   * @param debugMsg
   */
  statsDataSummaryUpdate(
    cycle: number,
    accountDataBefore: unknown,
    accountDataAfter: Shardus.WrappedData,
    debugMsg: string
  ): void {
    const opCounter = this.statsProcessCounter++
    if (this.invasiveDebugInfo)
      this.mainLogger.debug(
        `statData enter:statsDataSummaryUpdate op:${opCounter} c:${cycle} ${debugMsg}  accForBin:${utils.makeShortHash(
          accountDataAfter.accountId
        )}   inputs:${JSON.stringify({
          accountDataBefore,
          accountDataAfter,
        })}`
      )

    const blob: StateManagerTypes.StateManagerTypes.SummaryBlob = this.getSummaryBlob(
      accountDataAfter.accountId
    )
    blob.counter++
    if (accountDataAfter.data == null) {
      blob.errorNull += 100000000
      if (logFlags.error) this.mainLogger.error(`statsDataSummaryUpdate errorNull 1`)
      return
    }
    if (accountDataBefore == null) {
      blob.errorNull += 10000000000
      if (logFlags.error) this.mainLogger.error(`statsDataSummaryUpdate errorNull 2`)
      return
    }

    const accountId = accountDataAfter.accountId
    const timestamp = accountDataAfter.timestamp //  this.app.getAccountTimestamp(accountId)
    const hash = accountDataAfter.stateId //this.app.getStateId(accountId)

    if (this.accountCache.hasAccount(accountId)) {
      const accountMemData: AccountHashCache = this.accountCache.getAccountHash(accountId)
      if (accountMemData.t > timestamp) {
        /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`statsDataSummaryUpdate: good error?: 2: dont update stats with older data skipping update ${utils.makeShortHash(accountId)}  ${debugMsg}  ${accountMemData.t} > ${timestamp}  afterHash:${utils.makeShortHash(accountDataAfter.stateId)}`)
        return
      }
    } else {
      //this path doesnt matter much now because of checkAndSetAccountData() being used in different ways.
      // if (logFlags.verbose) this.mainLogger.error(`statsDataSummaryUpdate: did not find seen account: 2`)
    }
    this.accountCache.updateAccountHash(accountId, hash, timestamp, cycle)

    if (this.stateManager.feature_generateStats === true) {
      this.workQueue.push({
        cycle,
        fn: this.internalDoUpdate,
        args: [cycle, blob, accountDataBefore, accountDataAfter, opCounter],
      })
    }
    //this.internalDoUpdate(cycle, blob, accountDataBefore, accountDataAfter, opCounter)
  }

  /**
   * does the queued work of calling dataSummaryUpdate()
   * @param cycle
   * @param blob
   * @param accountDataBefore
   * @param accountDataAfter
   * @param opCounter
   */
  private internalDoUpdate(
    cycle: number,
    blob: StateManagerTypes.StateManagerTypes.SummaryBlob,
    accountDataBefore: unknown,
    accountDataAfter: Shardus.WrappedData,
    opCounter: number
  ): void {
    if (cycle > blob.latestCycle) {
      blob.latestCycle = cycle
    }
    this.app.dataSummaryUpdate(blob.opaqueBlob, accountDataBefore, accountDataAfter.data)
    if (this.invasiveDebugInfo)
      this.mainLogger.debug(
        `statData:statsDataSummaryUpdate op:${opCounter} c:${cycle} accForBin:${utils.makeShortHash(
          accountDataAfter.accountId
        )}   ${this.debugAccountData(accountDataAfter.data as RawAccountData)} - ${this.debugAccountData(
          accountDataBefore as RawAccountData
        )}`
      )
    if (this.invasiveDebugInfo) this.addDebugToBlob(blob, accountDataAfter.accountId)
  }

  /***
   *    ##     ## ########  ########     ###    ######## ########       ######## ##     ##        ######  ########    ###    ########  ######
   *    ##     ## ##     ## ##     ##   ## ##      ##    ##                ##     ##   ##        ##    ##    ##      ## ##      ##    ##    ##
   *    ##     ## ##     ## ##     ##  ##   ##     ##    ##                ##      ## ##         ##          ##     ##   ##     ##    ##
   *    ##     ## ########  ##     ## ##     ##    ##    ######            ##       ###           ######     ##    ##     ##    ##     ######
   *    ##     ## ##        ##     ## #########    ##    ##                ##      ## ##               ##    ##    #########    ##          ##
   *    ##     ## ##        ##     ## ##     ##    ##    ##                ##     ##   ##        ##    ##    ##    ##     ##    ##    ##    ##
   *     #######  ##        ########  ##     ##    ##    ########          ##    ##     ##        ######     ##    ##     ##    ##     ######
   */

  /**
   * Call this to update the TX stats.
   * note, this does not have to get queued because it is a per cycle calculation by default
   *  (bucketed by stat partition and by cycle)
   * @param cycle
   * @param queueEntry
   */
  statsTxSummaryUpdate(cycle: number, queueEntry: QueueEntry): void {
    let accountToUseForTXStatBinning = null
    //this list of uniqueWritableKeys is not sorted and deterministic
    for (const key of queueEntry.uniqueWritableKeys) {
      accountToUseForTXStatBinning = key
      break // just use the first for now.. could do something fance
    }
    if (accountToUseForTXStatBinning == null) {
      if (this.invasiveDebugInfo)
        this.mainLogger.debug(
          `statsTxSummaryUpdate skip(no local writable key) c:${cycle} ${queueEntry.logID}`
        )
      return
    }

    const partition = this.getSummaryBlobPartition(accountToUseForTXStatBinning) //very important to not use: queueEntry.acceptedTx.ids
    const summaryBlobCollection = this.getOrCreateTXSummaryBlobCollectionByCycle(queueEntry.cycleToRecordOn)

    if (summaryBlobCollection != null) {
      const blob: StateManagerTypes.StateManagerTypes.SummaryBlob =
        summaryBlobCollection.blobsByPartition.get(partition)
      if (cycle > blob.latestCycle) {
        blob.latestCycle = cycle //todo condider if we can remove this.  getOrCreateTXSummaryBlobCollectionByCycle should give us the correct blob
      }
      this.app.txSummaryUpdate(blob.opaqueBlob, queueEntry.acceptedTx.data, null) //todo: we need to remove the wrapped state parameter from this (currently passed as null)
      blob.counter++

      //todo be sure to turn off this setting when not debugging.
      if (this.invasiveDebugInfo) {
        if (blob.opaqueBlob.dbg == null) {
          blob.opaqueBlob.dbg = []
        }
        blob.opaqueBlob.dbg.push(queueEntry.logID) //queueEntry.acceptedTx.id.slice(0,6))
        blob.opaqueBlob.dbg.sort()
      }

      if (this.invasiveDebugInfo)
        this.mainLogger.debug(
          `statsTxSummaryUpdate updated c:${cycle} tx: ${queueEntry.logID} accForBin:${utils.makeShortHash(
            accountToUseForTXStatBinning
          )}`
        )
    } else {
      if (logFlags.error || this.invasiveDebugInfo)
        this.mainLogger.error(
          `statsTxSummaryUpdate no collection for c:${cycle}  tx: ${
            queueEntry.logID
          } accForBin:${utils.makeShortHash(accountToUseForTXStatBinning)}`
        )
    }
  }

  /***
   *    ########  ##     ## #### ##       ########        ########  ######## ########   #######  ########  ########
   *    ##     ## ##     ##  ##  ##       ##     ##       ##     ## ##       ##     ## ##     ## ##     ##    ##
   *    ##     ## ##     ##  ##  ##       ##     ##       ##     ## ##       ##     ## ##     ## ##     ##    ##
   *    ########  ##     ##  ##  ##       ##     ##       ########  ######   ########  ##     ## ########     ##
   *    ##     ## ##     ##  ##  ##       ##     ##       ##   ##   ##       ##        ##     ## ##   ##      ##
   *    ##     ## ##     ##  ##  ##       ##     ##       ##    ##  ##       ##        ##     ## ##    ##     ##
   *    ########   #######  #### ######## ########        ##     ## ######## ##         #######  ##     ##    ##
   */

  /**
   * Build the statsDump report that is used sent to the archive server.
   * Will only include covered stats partitions.
   * @param cycleShardData
   * @param excludeEmpty
   */
  buildStatsReport(
    cycleShardData: CycleShardData,
    excludeEmpty = true
  ): StateManagerTypes.StateManagerTypes.StatsClump {
    const cycle = cycleShardData.cycleNumber
    const nextQueue = []

    //Execute our work queue for any items that are for this cycle or older
    for (const item of this.workQueue) {
      if (item.cycle <= cycle) {
        item.fn.apply(this, item.args)
      } else {
        nextQueue.push(item)
      }
    }
    //update new work queue with items that were newer than this cycle
    this.workQueue = nextQueue

    //start building the statsDump
    const statsDump: StateManagerTypes.StateManagerTypes.StatsClump = {
      error: false,
      cycle,
      dataStats: [],
      txStats: [],
      covered: [],
      coveredParititionCount: 0,
      skippedParitionCount: 0,
    }

    let coveredParitionCount = 0
    let skippedParitionCount = 0
    if (cycleShardData == null) {
      if (logFlags.error) this.mainLogger.error(`getCoveredStatsPartitions missing cycleShardData`)
      statsDump.error = true
      return statsDump
    }

    let covered: { list: number[]; map: Map<number, boolean> } = null

    covered = this.getConsensusSnapshotPartitions(cycleShardData)
    statsDump.covered = covered.list

    //get out a sparse collection data blobs
    for (const key of this.summaryBlobByPartition.keys()) {
      const summaryBlob = this.summaryBlobByPartition.get(key)

      if (covered.map.has(key) === false) {
        skippedParitionCount++
        continue
      }
      if (excludeEmpty === false || summaryBlob.counter > 0) {
        const cloneSummaryBlob = JSON.parse(JSON.stringify(summaryBlob))
        statsDump.dataStats.push(cloneSummaryBlob)
      }
      coveredParitionCount++
      continue
    }

    const summaryBlobCollection = this.getOrCreateTXSummaryBlobCollectionByCycle(cycle)
    if (summaryBlobCollection != null) {
      for (const key of summaryBlobCollection.blobsByPartition.keys()) {
        const summaryBlob = summaryBlobCollection.blobsByPartition.get(key)

        if (covered.map.has(key) === false) {
          continue
        }
        if (excludeEmpty === false || summaryBlob.counter > 0) {
          statsDump.txStats.push(summaryBlob)
        }
      }
    }
    statsDump.coveredParititionCount = coveredParitionCount
    statsDump.skippedParitionCount = skippedParitionCount
    return statsDump
  }

  /***
   *    ########  ######## ########  ##     ##  ######       ######  ##     ## ########  ########   #######  ########  ########
   *    ##     ## ##       ##     ## ##     ## ##    ##     ##    ## ##     ## ##     ## ##     ## ##     ## ##     ##    ##
   *    ##     ## ##       ##     ## ##     ## ##           ##       ##     ## ##     ## ##     ## ##     ## ##     ##    ##
   *    ##     ## ######   ########  ##     ## ##   ####     ######  ##     ## ########  ########  ##     ## ########     ##
   *    ##     ## ##       ##     ## ##     ## ##    ##           ## ##     ## ##        ##        ##     ## ##   ##      ##
   *    ##     ## ##       ##     ## ##     ## ##    ##     ##    ## ##     ## ##        ##        ##     ## ##    ##     ##
   *    ########  ######## ########   #######   ######       ######   #######  ##        ##         #######  ##     ##    ##
   */

  /**
   * Builds a debug object with stata information for logging or runtime debugging with endpoints.
   * @param cycle
   * @param writeTofile
   * @param cycleShardData
   */
  dumpLogsForCycle(
    cycle: number,
    writeTofile = true,
    cycleShardData: CycleShardData = null
  ): {
    cycle: number
    dataStats: any[]
    txStats: any[]
    covered: any[]
    cycleDebugNotes: Record<string, never>
  } {
    const statsDump = { cycle, dataStats: [], txStats: [], covered: [], cycleDebugNotes: {} }

    statsDump.cycleDebugNotes = this.stateManager.cycleDebugNotes

    let covered = null
    if (cycleShardData != null) {
      covered = this.getConsensusSnapshotPartitions(cycleShardData)
      statsDump.covered = covered.list
    }

    //get out a sparse collection data blobs
    for (const key of this.summaryBlobByPartition.keys()) {
      const summaryBlob = this.summaryBlobByPartition.get(key)
      if (summaryBlob.counter > 0) {
        statsDump.dataStats.push(summaryBlob)
      }
    }

    const summaryBlobCollection = this.getOrCreateTXSummaryBlobCollectionByCycle(cycle)
    if (summaryBlobCollection != null) {
      for (const key of summaryBlobCollection.blobsByPartition.keys()) {
        const summaryBlob = summaryBlobCollection.blobsByPartition.get(key)
        if (summaryBlob.counter > 0) {
          statsDump.txStats.push(summaryBlob)
        }
      }
    }

    if (writeTofile) {
      /*if(logFlags.debug)*/ this.statsLogger.debug(
        `logs for cycle ${cycle}: ` + utils.stringifyReduce(statsDump)
      )
    }

    return statsDump
  }

  /***
   *    ########  ########   #######   ######  ########  ######   ######  ########     ###    ########    ###     ######  ########    ###    ########  ######  ########  ##     ## ##     ## ########
   *    ##     ## ##     ## ##     ## ##    ## ##       ##    ## ##    ## ##     ##   ## ##      ##      ## ##   ##    ##    ##      ## ##      ##    ##    ## ##     ## ##     ## ###   ### ##     ##
   *    ##     ## ##     ## ##     ## ##       ##       ##       ##       ##     ##  ##   ##     ##     ##   ##  ##          ##     ##   ##     ##    ##       ##     ## ##     ## #### #### ##     ##
   *    ########  ########  ##     ## ##       ######    ######   ######  ##     ## ##     ##    ##    ##     ##  ######     ##    ##     ##    ##     ######  ##     ## ##     ## ## ### ## ########
   *    ##        ##   ##   ##     ## ##       ##             ##       ## ##     ## #########    ##    #########       ##    ##    #########    ##          ## ##     ## ##     ## ##     ## ##
   *    ##        ##    ##  ##     ## ##    ## ##       ##    ## ##    ## ##     ## ##     ##    ##    ##     ## ##    ##    ##    ##     ##    ##    ##    ## ##     ## ##     ## ##     ## ##
   *    ##        ##     ##  #######   ######  ########  ######   ######  ########  ##     ##    ##    ##     ##  ######     ##    ##     ##    ##     ######  ########   #######  ##     ## ##
   */
  processDataStatsDump(
    stream: Response<unknown, Record<string, unknown>, number>,
    tallyFunction: { (opaqueBlob: unknown): unknown; (arg0: unknown): unknown },
    lines: Line[]
  ): {
    allPassed: boolean
    allPassedMetric2: boolean
    singleVotePartitions: number
    multiVotePartitions: number
    badPartitions: any[]
    dataByParition: Map<any, any>
  } {
    const dataByParition = new Map()

    let newestCycle = -1
    const statsBlobs = []
    for (const line of lines) {
      const index = line.raw.indexOf('{"covered')
      if (index >= 0) {
        const statsStr = line.raw.slice(index)
        //this.generalLog(string)
        let statsObj: { cycle: number; owner: string }
        try {
          statsObj = JSON.parse(statsStr)
        } catch (err) {
          if (logFlags.error) this.mainLogger.error(`Fail to parse statsObj: ${statsStr}`, err)
          continue
        }

        if (newestCycle > 0 && statsObj.cycle != newestCycle) {
          stream.write(
            `wrong cycle for node: ${line.file.owner} reportCycle:${newestCycle} thisNode:${statsObj.cycle} \n`
          )
          continue
        }
        statsBlobs.push(statsObj)

        if (statsObj.cycle > newestCycle) {
          newestCycle = statsObj.cycle
        }
        // this isn't quite working right without scanning the whole playback log
        statsObj.owner = line.file.owner // line.raw.slice(0, index)
      }
    }

    for (const statsObj of statsBlobs) {
      const coveredMap = new Map()
      for (const partition of statsObj.covered) {
        coveredMap.set(partition, true)
      }

      if (statsObj.cycle === newestCycle) {
        for (const dataStatsObj of statsObj.dataStats) {
          const partition = dataStatsObj.partition
          if (coveredMap.has(partition) === false) {
            continue
          }
          let dataTally: {
            data: object[]
            dataStrings: Record<string, number>
            differentVotes: number
            voters: number
            bestVote: unknown
            tallyList: unknown[]
            partition?: unknown
          }
          if (dataByParition.has(partition) === false) {
            dataTally = {
              partition,
              data: [],
              dataStrings: {},
              differentVotes: 0,
              voters: 0,
              bestVote: 0,
              tallyList: [],
            }
            dataByParition.set(partition, dataTally)
          }

          const dataString = safeStringify(dataStatsObj.opaqueBlob)
          dataTally = dataByParition.get(partition)

          dataTally.data.push(dataStatsObj)
          // `dataString` is only ever used to index a map of numbers, so this
          // is probably safe
          /* eslint-disable security/detect-object-injection */
          if (dataTally.dataStrings[dataString] == null) {
            dataTally.dataStrings[dataString] = 0
            dataTally.differentVotes++
          }
          dataTally.voters++
          dataTally.dataStrings[dataString]++
          const votes = dataTally.dataStrings[dataString]
          if (votes > dataTally.bestVote) {
            dataTally.bestVote = votes
          }
          if (tallyFunction != null) {
            dataTally.tallyList.push(tallyFunction(dataStatsObj.opaqueBlob))
          }
          /* eslint-enable security/detect-object-injection */
        }
      }
    }
    let allPassed = true
    let allPassedMetric2 = true
    let singleVotePartitions = 0
    let multiVotePartitions = 0
    const badPartitions = []
    for (const dataTally of dataByParition.values()) {
      if (dataTally.differentVotes === 1) {
        singleVotePartitions++
      }
      if (dataTally.differentVotes > 1) {
        multiVotePartitions++
        allPassed = false
        badPartitions.push(dataTally.partition)

        if (dataTally.bestVote < Math.ceil(dataTally.voters / 3)) {
          allPassedMetric2 = false
        }
      }
    }

    // need to only count stuff from the newestCycle.

    return {
      allPassed,
      allPassedMetric2,
      singleVotePartitions,
      multiVotePartitions,
      badPartitions,
      dataByParition,
    }
  }

  /***
   *    ########  ########   #######   ######  ########  ######   ######  ######## ##     ##  ######  ########    ###    ########  ######  ########  ##     ## ##     ## ########
   *    ##     ## ##     ## ##     ## ##    ## ##       ##    ## ##    ##    ##     ##   ##  ##    ##    ##      ## ##      ##    ##    ## ##     ## ##     ## ###   ### ##     ##
   *    ##     ## ##     ## ##     ## ##       ##       ##       ##          ##      ## ##   ##          ##     ##   ##     ##    ##       ##     ## ##     ## #### #### ##     ##
   *    ########  ########  ##     ## ##       ######    ######   ######     ##       ###     ######     ##    ##     ##    ##     ######  ##     ## ##     ## ## ### ## ########
   *    ##        ##   ##   ##     ## ##       ##             ##       ##    ##      ## ##         ##    ##    #########    ##          ## ##     ## ##     ## ##     ## ##
   *    ##        ##    ##  ##     ## ##    ## ##       ##    ## ##    ##    ##     ##   ##  ##    ##    ##    ##     ##    ##    ##    ## ##     ## ##     ## ##     ## ##
   *    ##        ##     ##  #######   ######  ########  ######   ######     ##    ##     ##  ######     ##    ##     ##    ##     ######  ########   #######  ##     ## ##
   */
  processTxStatsDump(
    stream: Response<unknown, Record<string, unknown>, number>,
    tallyFunction: { (opaqueBlob: { totalTx?: number }): number; (arg0: unknown): unknown },
    lines: Line[]
  ): {
    allPassed: boolean
    allPassedMetric2: boolean
    singleVotePartitions: number
    multiVotePartitions: number
    badPartitions: unknown[]
    totalTx: number
  } {
    // let stream = fs.createWriteStream(path, {
    //   flags: 'w'
    // })
    const dataByParition = new Map()

    let newestCycle = -1
    const statsBlobs = []
    for (const line of lines) {
      const index = line.raw.indexOf('{"covered')
      if (index >= 0) {
        const statsStr = line.raw.slice(index)
        //this.generalLog(string)
        let statsObj: { cycle: number; owner: string }
        try {
          statsObj = JSON.parse(statsStr)
        } catch (err) {
          if (logFlags.error) this.mainLogger.error(`Fail to parse statsObj: ${statsStr}`, err)
          continue
        }
        if (newestCycle > 0 && statsObj.cycle != newestCycle) {
          stream.write(
            `wrong cycle for node: ${line.file.owner} reportCycle:${newestCycle} thisNode:${statsObj.cycle} \n`
          )
          continue
        }
        statsBlobs.push(statsObj)

        if (statsObj.cycle > newestCycle) {
          newestCycle = statsObj.cycle
        }
        // this isn't quite working right without scanning the whole playback log
        statsObj.owner = line.file.owner // line.raw.slice(0, index)
      }
    }
    const txCountMap = new Map()
    for (const statsObj of statsBlobs) {
      if (!txCountMap.has(statsObj.owner)) {
        txCountMap.set(statsObj.owner, [])
      }
      const coveredMap = new Map()
      for (const partition of statsObj.covered) {
        coveredMap.set(partition, true)
      }
      const dataTallyListForThisOwner = []
      for (const txStatsObj of statsObj.txStats) {
        const partition = txStatsObj.partition
        if (coveredMap.has(partition) === false) {
          continue
        }
        let dataTally: {
          data: unknown[]
          dataStrings: Record<string, number>
          differentVotes: number
          voters: number
          bestVote: number
          bestVoteValue: number
          tallyList: unknown[]
          partition?: number
        }
        if (dataByParition.has(partition) === false) {
          dataTally = {
            partition,
            data: [],
            dataStrings: {},
            differentVotes: 0,
            voters: 0,
            bestVote: 0,
            bestVoteValue: null,
            tallyList: [],
          }
          dataByParition.set(partition, dataTally)
        }

        const dataString = safeStringify(txStatsObj.opaqueBlob)
        dataTally = dataByParition.get(partition)

        dataTally.data.push(txStatsObj)
        // `dataString` is only ever used to index a map of numbers, so this
        // is probably safe
        /* eslint-disable security/detect-object-injection */
        if (dataTally.dataStrings[dataString] == null) {
          dataTally.dataStrings[dataString] = 0
          dataTally.differentVotes++
        }
        dataTally.voters++
        dataTally.dataStrings[dataString]++
        const votes = dataTally.dataStrings[dataString]
        if (votes > dataTally.bestVote) {
          dataTally.bestVote = votes
          dataTally.bestVoteValue = txStatsObj.opaqueBlob
        }
        /* eslint-enable security/detect-object-injection */
        if (tallyFunction != null) {
          dataTally.tallyList.push(tallyFunction(txStatsObj.opaqueBlob))
          if (dataTally.differentVotes > 1) {
            // console.log(`Cycle: ${statsObj.cycle} dataTally: partition: ${dataTally.partition}. DifferentVotes: ${dataTally.differentVotes}`)
            // console.log(dataTally.dataStrings)
          }
          dataTallyListForThisOwner.push(dataTally)
          // console.log('dataTally.tallyList', dataTally.tallyList)
          // console.log('dataTally', dataTally)
        }
      }
      let totalTx = 0
      for (const dataTally of dataTallyListForThisOwner) {
        if (dataTally.bestVoteValue) {
          totalTx += dataTally.bestVoteValue.totalTx
        }
      }
      // console.log(`TOTAL TX COUNT for CYCLE ${statsObj.cycle} ${statsObj.owner}`, txCountMap.get(statsObj.owner) + totalTx)
      txCountMap.set(statsObj.owner, txCountMap.get(statsObj.owner) + totalTx)
    }

    let allPassed = true
    let allPassedMetric2 = true
    let singleVotePartitions = 0
    let multiVotePartitions = 0
    const badPartitions = []
    let sum = 0
    for (const dataTally of dataByParition.values()) {
      sum += dataTally.bestVoteValue.totalTx || 0
      if (dataTally.differentVotes === 1) {
        singleVotePartitions++
      }
      if (dataTally.differentVotes > 1) {
        multiVotePartitions++
        allPassed = false
        badPartitions.push(dataTally.partition)

        if (dataTally.bestVote < Math.ceil(dataTally.voters / 3)) {
          allPassedMetric2 = false
        }
      }
    }

    //print non zero issues
    for (const statsObj of statsBlobs) {
      if (statsObj.cycleDebugNotes != null) {
        for (const [, value] of Object.entries(statsObj.cycleDebugNotes)) {
          const valueNum = value as number
          if (valueNum >= 1) {
            stream.write(`${statsObj.owner} : ${JSON.stringify(statsObj.cycleDebugNotes)}`)
            break
          }
        }
      }
    }

    //stream.write(`Total tx count\n`, sum)
    return {
      allPassed,
      allPassedMetric2,
      singleVotePartitions,
      multiVotePartitions,
      badPartitions,
      totalTx: sum,
    }
  }

  dataStatsTallyFunction(opaqueBlob: { totalBalance?: number }): number {
    if (opaqueBlob.totalBalance == null) {
      return 0
    }
    return opaqueBlob.totalBalance
  }
  txStatsTallyFunction(opaqueBlob: { totalTx?: number }): number {
    if (opaqueBlob.totalTx == null) {
      return 0
    }
    return opaqueBlob.totalTx
  }

  //NOTE THIS IS NOT GENERAL PURPOSE... only works in some cases. only for debug
  //this code should not know about balance.
  debugAccountData(accountData: RawAccountData): string {
    if (
      'data' in accountData &&
      'data' in accountData.data &&
      'balance' in accountData.data.data &&
      accountData?.data?.data?.balance
    ) {
      return accountData.data.data.balance
    }
    if ('data' in accountData && 'balance' in accountData.data && accountData.data.balance) {
      return accountData.data.balance
    }
    if (typeof accountData === 'object' && 'balance' in accountData) {
      return accountData.balance
    }

    return 'X'
  }

  //debug helper for invasiveDebugInfo
  addDebugToBlob(blob: StateManagerTypes.StateManagerTypes.SummaryBlob, accountID: string): void {
    //todo be sure to turn off this setting when not debugging.
    if (this.invasiveDebugInfo) {
      if (blob.opaqueBlob.dbgData == null) {
        blob.opaqueBlob.dbgData = []
      }
      //add unique.. this would be faster with a set, but dont want to have to post process sort the set later!
      const shortID = utils.makeShortHash(accountID)
      if (blob.opaqueBlob.dbgData.indexOf(shortID) === -1) {
        blob.opaqueBlob.dbgData.push(shortID)
        blob.opaqueBlob.dbgData.sort()
      }
    }
  }
}

export default PartitionStats
