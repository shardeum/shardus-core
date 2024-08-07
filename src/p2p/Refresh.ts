/**
 * This module is reponsible for refreshing cycle chain entries for consensors
 * and archivers that are not rotating and would be "forgotten" by the network.
 * In a network that has low amount of rotation or no rotation, a syncing node
 * would have to read the cycle chain all the way back to where the oldest node
 * in the network joined. If there is no rotation, this would mean reading back
 * to the begining of the cycle chain. To avoid this we refresh the join info
 * for the consensor or archiver. Thus the syncing node has to read back much
 * less to sync the cycle chain.
 */

import deepmerge from 'deepmerge';
import { Logger } from 'log4js';
import { P2P } from '@shardus/types';
import { propComparator2, reversed, validateTypes } from '../utils';
import * as Archivers from './Archivers';
import { logger } from './Context';
import { cycles, newest } from './CycleChain';
import * as NodeList from './NodeList';
import { totalNodeCount } from './Sync';
import * as Context from './Context';

/** STATE */

let p2pLogger: Logger;

/** FUNCTIONS */

/** CycleCreator Functions */

export function init() {
  // Init logger
  p2pLogger = logger.getLogger('p2p');

  // Init state
  reset();
}

export function reset() {}

export function getTxs(): P2P.RefreshTypes.Txs {
  return {};
}

export function validateRecordTypes(rec: P2P.RefreshTypes.Record): string {
  let err = validateTypes(rec, { refreshedArchivers: 'a', refreshedConsensors: 'a' });
  if (err) return err;
  for (const item of rec.refreshedArchivers) {
    err = validateTypes(item, { publicKey: 's', ip: 's', port: 'n', curvePk: 's' });
    if (err) return 'in refreshedArchivers array ' + err;
  }
  for (const item of rec.refreshedConsensors) {
    err = validateTypes(item, {
      activeTimestamp: 'n',
      address: 's',
      externalIp: 's',
      externalPort: 'n',
      internalIp: 's',
      internalPort: 'n',
      joinRequestTimestamp: 'n',
      publicKey: 's',
      cycleJoined: 's',
      counterRefreshed: 'n',
      id: 's',
      curvePublicKey: 's',
      status: 's',
    });
    if (err) return 'in joinedConsensors array ' + err;
  }
  return '';
}

export function dropInvalidTxs(txs: P2P.RefreshTypes.Txs): P2P.RefreshTypes.Txs {
  return txs;
}

/*
Given the txs and prev cycle record mutate the referenced record
*/
export function updateRecord(
  txs: P2P.RefreshTypes.Txs,
  record: P2P.CycleCreatorTypes.CycleRecord,
  prev: P2P.CycleCreatorTypes.CycleRecord
): void {
  // sync v2 does not require refreshing nodes, but these fields cannot be left
  // null/undefined
  if (Context.config.p2p.useSyncProtocolV2) {
    record.refreshedArchivers = [];
    record.refreshedConsensors = [];
  } else {
    record.refreshedArchivers = Archivers.getRefreshedArchivers(record); // This returns a copy of the objects
    record.refreshedConsensors = refreshConsensors(); // This returns a copy of the objects
  }
}

export function parseRecord(record: P2P.CycleCreatorTypes.CycleRecord): P2P.CycleParserTypes.Change {
  const added: P2P.CycleParserTypes.Change['added'] = [];
  const updated: P2P.CycleParserTypes.Change['updated'] = [];

  // don't continue if sync v2 is enabled
  if (!Context.config.p2p.useSyncProtocolV2) {
    // If Archivers.archivers doesn't have a refreshedArchiver, put it in
    for (const refreshed of record.refreshedArchivers) {
      if (Archivers.archivers.has(refreshed.publicKey) === false) {
        Archivers.archivers.set(refreshed.publicKey, refreshed);
      }
    }

    /**
     * A refreshedConsensor results in either an added or update, depending on
     * whether or not we have the refreshedConsensor in our node list or not.
     */
    for (const refreshed of record.refreshedConsensors) {
      const node = NodeList.nodes.get(refreshed.id);
      if (node) {
        // If it's in our node list, we update its counterRefreshed
        // (IMPORTANT: update counterRefreshed only if its greater than ours)
        if (record.counter > node.counterRefreshed) {
          updated.push({ id: refreshed.id, counterRefreshed: record.counter });
        }
      } else {
        // If it's not in our node list, we add it...
        added.push(refreshed);
        // and immediately update its status to ACTIVE
        // (IMPORTANT: update counterRefreshed to the records counter)
        updated.push({
          id: refreshed.id,
          status: P2P.P2PTypes.NodeStatus.ACTIVE,
          counterRefreshed: record.counter,
        });
      }
    }
  }

  return {
    added,
    removed: [],
    updated,
  };
}

export function queueRequest(request) {}

export function sendRequests() {}

function refreshConsensors() {
  /**
   * [NOTE] We could update the counterRefreshed value here before putting
   * it into the cycle record, but we would have to make a copy of the node
   * entry to avoid mutating our node list. So instead, we update the
   * counterRefreshed value on the parsing side.
   */

  // [IMPORTANT] We need to put a copy into the cycle record, so that
  // the cycle chain is not mutated when we make changes to the node entry

  const refreshCount = getRefreshCount();

  // Return copies of the nodes with the oldest counterRefreshed
  const nodesToRefresh = [...NodeList.activeByIdOrder]
    .sort(propComparator2('counterRefreshed', 'id'))
    .splice(0, refreshCount)
    .map((node) => deepmerge({}, node));

  return nodesToRefresh;
}

export function getRefreshCount() {
  // This is a function of the active node count
  return Math.floor(Math.sqrt(NodeList.activeByIdOrder.length));
}

export function cyclesToKeep() {
  /**
   * Walk through the cycle chain backwards to calculate how many records we
   * need to build the current node list
   */
  //  const squasher = new CycleParser.ChangeSquasher()
  let count = 1;
  let seen = new Map();
  let removed = [];
  let refuted = [];
  for (const record of reversed(cycles)) {
    /*
    squasher.addChange(CycleParser.parse(record))
    if (
      squasher.final.updated.length >= activeNodeCount(newest) &&
      squasher.final.added.length >= totalNodeCount(newest)
    ) {
      break
    }
*/
    if (record.refuted.length > 0) {
      refuted = [...refuted, ...record.refuted];
    }
    if (newest.counter !== record.counter) {
      if (record.lost.length > 0) {
        removed = [...removed, ...record.lost.filter((id) => !refuted.includes(id))];
      }
      if (record.lostSyncing.length > 0) {
        removed = [...removed, ...record.lostSyncing.filter((id) => !refuted.includes(id))];
      }
    }
    if (record.apoptosized.length > 0) {
      removed = [...removed, ...record.apoptosized];
    }
    if (record.removed.length > 0) {
      removed = [...removed, ...record.removed];
    }
    for (const n of record.refreshedConsensors) {
      if (!removed.includes(n.id) && !seen.has(n.id)) seen.set(n.id, 1);
    }
    for (const n of record.joinedConsensors) {
      if (!removed.includes(n.id) && !seen.has(n.id)) seen.set(n.id, 1);
    }
    if (seen.size >= totalNodeCount(newest)) break;
    count++;
  }
  info('cycles to keep is ' + count);
  //  showNodeCount(newest)
  // Keep a few more than that, just to be safe
  count = count * Context.config.p2p.extraCyclesToKeepMultiplier;
  return count + Context.config.p2p.extraCyclesToKeep;
}

function info(...msg) {
  const entry = `Refresh: ${msg.join(' ')}`;
  p2pLogger.info(entry);
}

function warn(...msg) {
  const entry = `Refresh: ${msg.join(' ')}`;
  p2pLogger.warn(entry);
}

function error(...msg) {
  const entry = `Refresh: ${msg.join(' ')}`;
  p2pLogger.error(entry);
}
