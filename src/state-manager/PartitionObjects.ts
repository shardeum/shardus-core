import { Logger as Log4jsLogger } from 'log4js';
import StateManager from '.';
import Crypto from '../crypto';
import Logger, { logFlags } from '../logger';
import { P2PModuleContext as P2P } from '../p2p/Context';
import * as Shardus from '../shardus/shardus-types';
import Storage from '../storage';
import * as utils from '../utils';
import Profiler from '../utils/profiler';
import ShardFunctions from './shardFunctions';
import {
  PartitionCycleReport,
  PartitionObject,
  PartitionResult,
  TempTxRecord,
  TxTallyList,
} from './state-manager-types';

class PartitionObjects {
  app: Shardus.App;
  crypto: Crypto;
  config: Shardus.StrictServerConfiguration;
  profiler: Profiler;

  logger: Logger;
  p2p: P2P;
  storage: Storage;
  stateManager: StateManager;

  mainLogger: Log4jsLogger;
  fatalLogger: Log4jsLogger;
  shardLogger: Log4jsLogger;
  statsLogger: Log4jsLogger;
  statemanager_fatal: (key: string, log: string) => void;

  nextCycleReportToSend: PartitionCycleReport;

  lastCycleReported: number;
  partitionReportDirty: boolean;

  /** partition objects by cycle.  index by cycle counter key to get an array */
  partitionObjectsByCycle: { [cycleKey: string]: PartitionObject[] };
  /** our partition Results by cycle.  index by cycle counter key to get an array */
  ourPartitionResultsByCycle: { [cycleKey: string]: PartitionResult[] };
  /** partition objects by cycle by hash.   */
  recentPartitionObjectsByCycleByHash: { [cycleKey: string]: { [hash: string]: PartitionObject } };
  /** temporary store for TXs that we put in a partition object after a cycle is complete. an array that holds any TXs (i.e. from different cycles), code will filter out what it needs @see TempTxRecord */
  tempTXRecords: TempTxRecord[];
  /** TxTallyList data indexed by cycle key and partition key. @see TxTallyList */
  txByCycleByPartition: { [cycleKey: string]: { [partitionKey: string]: TxTallyList } };
  /** Stores the partition responses that other nodes push to us.  Index by cycle key, then index by partition id */
  allPartitionResponsesByCycleByPartition: {
    [cycleKey: string]: { [partitionKey: string]: PartitionResult[] };
  };

  resetAndApplyPerPartition: boolean;

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
    this.crypto = crypto;
    this.app = app;
    this.logger = logger;
    this.config = config;
    this.profiler = profiler;
    this.p2p = p2p;
    this.storage = storage;
    this.stateManager = stateManager;

    this.mainLogger = logger.getLogger('main');
    this.fatalLogger = logger.getLogger('fatal');
    this.shardLogger = logger.getLogger('shardDump');
    this.statsLogger = logger.getLogger('statsDump');
    this.statemanager_fatal = stateManager.statemanager_fatal;

    this.nextCycleReportToSend = null;

    this.lastCycleReported = -1;

    this.partitionReportDirty = false;

    this.partitionObjectsByCycle = {};
    this.ourPartitionResultsByCycle = {};
    this.recentPartitionObjectsByCycleByHash = {};
    this.tempTXRecords = [];
    this.txByCycleByPartition = {};
    this.allPartitionResponsesByCycleByPartition = {};

    // the original way this was setup was to reset and apply repair results one partition at a time.
    // this could create issue if we have a TX spanning multiple partitions that are locally owned.
    this.resetAndApplyPerPartition = false;
  }

  /***
   *    ########     ###    ########  ######## #### ######## ####  #######  ##    ## ########  ######## ########   #######  ########  ########  ######
   *    ##     ##   ## ##   ##     ##    ##     ##     ##     ##  ##     ## ###   ## ##     ## ##       ##     ## ##     ## ##     ##    ##    ##    ##
   *    ##     ##  ##   ##  ##     ##    ##     ##     ##     ##  ##     ## ####  ## ##     ## ##       ##     ## ##     ## ##     ##    ##    ##
   *    ########  ##     ## ########     ##     ##     ##     ##  ##     ## ## ## ## ########  ######   ########  ##     ## ########     ##     ######
   *    ##        ######### ##   ##      ##     ##     ##     ##  ##     ## ##  #### ##   ##   ##       ##        ##     ## ##   ##      ##          ##
   *    ##        ##     ## ##    ##     ##     ##     ##     ##  ##     ## ##   ### ##    ##  ##       ##        ##     ## ##    ##     ##    ##    ##
   *    ##        ##     ## ##     ##    ##    ####    ##    ####  #######  ##    ## ##     ## ######## ##         #######  ##     ##    ##     ######
   */

  /**
   * getPartitionReport used by reporting (monitor server) to query if there is a partition report ready
   * @param {boolean} consensusOnly
   * @param {boolean} smallHashes
   * @returns {any}
   */
  getPartitionReport(consensusOnly: boolean, smallHashes: boolean): PartitionCycleReport {
    let response: PartitionCycleReport = {}; // {res:[], cycleNumber:-1}
    if (this.nextCycleReportToSend != null) {
      const shardValues = this.stateManager.shardValuesByCycle.get(this.nextCycleReportToSend.cycleNumber);
      const consensusStartPartition = shardValues.nodeShardData.consensusStartPartition;
      const consensusEndPartition = shardValues.nodeShardData.consensusEndPartition;

      response = { res: [], cycleNumber: this.nextCycleReportToSend.cycleNumber };
      if (
        this.lastCycleReported < this.nextCycleReportToSend.cycleNumber ||
        this.partitionReportDirty === true
      ) {
        // consensusOnly hashes
        if (smallHashes === true) {
          for (const r of this.nextCycleReportToSend.res) {
            r.h = utils.makeShortHash(r.h);
          }
        }
        for (const r of this.nextCycleReportToSend.res) {
          if (consensusOnly) {
            //check if partition is in our range!
            if (
              ShardFunctions.partitionInWrappingRange(r.i, consensusStartPartition, consensusEndPartition)
            ) {
              response.res.push(r);
            }
          } else {
            response.res.push(r);
          }
        }
        // Partition_hash: partitionHash, Partition_id:
        //response = this.nextCycleReportToSend
        this.lastCycleReported = this.nextCycleReportToSend.cycleNumber; // update reported cycle
        this.nextCycleReportToSend = null; // clear it because we sent it
        this.partitionReportDirty = false; // not dirty anymore

        /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug('getPartitionReport: ' + `insync: ${this.stateManager.stateIsGood} ` + utils.stringifyReduce(response))
      }
    }
    return response;
  }

  /***
   *    ######## ##    ## ########        ########   #######  #### ##    ## ########  ######
   *    ##       ###   ## ##     ##       ##     ## ##     ##  ##  ###   ##    ##    ##    ##
   *    ##       ####  ## ##     ##       ##     ## ##     ##  ##  ####  ##    ##    ##
   *    ######   ## ## ## ##     ##       ########  ##     ##  ##  ## ## ##    ##     ######
   *    ##       ##  #### ##     ##       ##        ##     ##  ##  ##  ####    ##          ##
   *    ##       ##   ### ##     ##       ##        ##     ##  ##  ##   ###    ##    ##    ##
   *    ######## ##    ## ########        ##         #######  #### ##    ##    ##     ######
   */

  // eslint-disable-next-line
  setupHandlers() {}
}

export default PartitionObjects;
