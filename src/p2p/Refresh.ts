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

import { Logger } from 'log4js'
import { binaryLowest, propComparator } from '../utils'
import * as Archivers from './Archivers'
import * as Comms from './Comms'
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

/** ROUTES */

const gossipRoute: Types.GossipHandler = payload => {}

const routes = {
  internal: {},
  gossip: {
    gossip: gossipRoute,
  },
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

  // Register routes
  for (const [name, handler] of Object.entries(routes.internal)) {
    Comms.registerInternal(name, handler)
  }
  for (const [name, handler] of Object.entries(routes.gossip)) {
    Comms.registerGossipHandler(name, handler)
  }
}

export function reset() {}

export function getTxs(): Txs {
  return
}

export function dropInvalidTxs(txs: Txs): Txs {
  return
}

/*
Given the txs and prev cycle record mutate the referenced record
*/
export function updateRecord(
  txs: Txs,
  record: CycleCreator.CycleRecord,
  prev: CycleCreator.CycleRecord
) {
  record.refreshedArchivers = refreshArchivers()
  record.refreshedConsensors = refreshConsensors()

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
  // Find the index of the node with the oldest counterRefreshed
  const oldest = binaryLowest(
    NodeList.byJoinOrder,
    propComparator('counterRefreshed')
  )
  if (oldest < 0) return []

  // Pick the oldest + some nodes to be refreshed
  const refreshCount = Math.floor(Math.sqrt(NodeList.activeByIdOrder.length))
  const nodesToRefresh: NodeList.Node[] = []
  let i = oldest
  while (nodesToRefresh.length < refreshCount) {
    const node = NodeList.byJoinOrder[i]
    // Don't include syncing nodes
    if (node.status === Types.NodeStatus.ACTIVE) {
      /**
       * [NOTE] We could update the counterRefreshed value here before putting
       * it into the cycle record, but we would have to make a copy of the node
       * entry to avoid mutating our node list. So instead, we update the
       * counterRefreshed value on the parsing side.
       */
      nodesToRefresh.push(node)
    }
    // Loop around if you hit the end of the array
    i = (i + 1) % NodeList.byJoinOrder.length
  }

  // Sort by node id before returning
  return nodesToRefresh.sort(propComparator('id'))
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
