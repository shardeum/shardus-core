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

import deepmerge from 'deepmerge'
import { Logger } from 'log4js'
import { propComparator, propComparator2 } from '../utils'
import * as Archivers from './Archivers'
import { logger } from './Context'
import * as CycleCreator from './CycleCreator'
import * as CycleParser from './CycleParser'
import * as NodeList from './NodeList'
import * as Types from './Types'

/** TYPES */

export interface Txs {}

export interface Record {
  refreshedArchivers: Archivers.JoinedArchiver[]
  refreshedConsensors: NodeList.Node[]
}

/** STATE */

let p2pLogger: Logger

/** FUNCTIONS */

/** CycleCreator Functions */

export function init() {
  // Init logger
  p2pLogger = logger.getLogger('p2p')

  // Init state
  reset()
}

export function reset() {}

export function getTxs(): Txs {
  return {}
}

export function dropInvalidTxs(txs: Txs): Txs {
  return txs
}

/*
Given the txs and prev cycle record mutate the referenced record
*/
export function updateRecord(
  txs: Txs,
  record: CycleCreator.CycleRecord,
  prev: CycleCreator.CycleRecord
) {
  record.refreshedArchivers = refreshArchivers() // This returns a copy of the objects
  record.refreshedConsensors = refreshConsensors() // This returns a copy of the objects

  info(`
    refreshedArchivers: ${JSON.stringify(record.refreshedArchivers)}
    refreshedConsensors: ${JSON.stringify(record.refreshedConsensors)}
  `)
}

export function parseRecord(
  record: CycleCreator.CycleRecord
): CycleParser.Change {
  // If Archivers.archivers doesn't have a refreshedArchiver, put it in
  for (const refreshed of record.refreshedArchivers) {
    if (Archivers.archivers.has(refreshed.publicKey) === false) {
      Archivers.archivers.set(refreshed.publicKey, refreshed)
    }
  }

  /**
   * A refreshedConsensor results in either an added or update, depending on
   * whether or not we have the refreshedConsensor in our node list or not.
   */
  const added: CycleParser.Change['added'] = []
  const updated: CycleParser.Change['updated'] = []
  for (const refreshed of record.refreshedConsensors) {
    const node = NodeList.nodes.get(refreshed.id)
    if (node) {
      // If it's in our node list, we update its counterRefreshed
      // (IMPORTANT: update counterRefreshed only if its greater than ours)
      if (record.counter > node.counterRefreshed) {
        updated.push({ id: refreshed.id, counterRefreshed: record.counter })
      }
    } else {
      // If it's not in our node list, we add it...
      added.push(refreshed)
      // and immediately update its status to ACTIVE
      // (IMPORTANT: update counterRefreshed to the records counter)
      updated.push({
        id: refreshed.id,
        status: Types.NodeStatus.ACTIVE,
        counterRefreshed: record.counter,
      })
    }
  }

  return {
    added,
    removed: [],
    updated,
  }
}

export function queueRequest(request) {}

export function sendRequests() {}

/** Module Functions */

function refreshArchivers() {
  // [TODO] Come up with a better policy for this
  const refreshedArchivers = [...Archivers.archivers.values()]
  return refreshedArchivers.sort(propComparator('publicKey'))
}

function refreshConsensors() {
  /**
   * [NOTE] We could update the counterRefreshed value here before putting
   * it into the cycle record, but we would have to make a copy of the node
   * entry to avoid mutating our node list. So instead, we update the
   * counterRefreshed value on the parsing side.
   */

  // [IMPORTANT] We need to put a copy into the cycle record, so that
  // the cycle chain is not mutated when we make changes to the node entry

  const refreshCount = getRefreshCount(NodeList.activeByIdOrder.length)

  // Return copies of the nodes with the oldest counterRefreshed
  const nodesToRefresh = [...NodeList.activeByIdOrder]
    .sort(propComparator2('counterRefreshed', 'id'))
    .splice(0, refreshCount)
    .map(node => deepmerge({}, node))

  return nodesToRefresh
}

export function getRefreshCount(active: number) {
  return Math.floor(Math.sqrt(active))
}

export function cyclesToKeep(active) {
  return getRefreshCount(active) * 2 + 5
}

export function cyclesToGet(active) {
  return Math.floor(getRefreshCount(active) * 1.5) + 2
}

function info(...msg) {
  const entry = `Refresh: ${msg.join(' ')}`
  p2pLogger.info(entry)
}

function warn(...msg) {
  const entry = `Refresh: ${msg.join(' ')}`
  p2pLogger.warn(entry)
}

function error(...msg) {
  const entry = `Refresh: ${msg.join(' ')}`
  p2pLogger.error(entry)
}
