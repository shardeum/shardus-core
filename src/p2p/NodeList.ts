import { hexstring, stringify } from '@shardus/crypto-utils'
import { P2P } from '@shardus/types'
import { Logger } from 'log4js'
import { isDebugModeMiddleware, isDebugModeMiddlewareLow } from '../network/debugMiddleware'
import { ShardusEvent } from '../shardus/shardus-types'
import { binarySearch, getTime, insertSorted, propComparator, propComparator2 } from '../utils'
import * as Comms from './Comms'
import { config, crypto, logger, network } from './Context'
import * as CycleChain from './CycleChain'
import * as Join from './Join'
import { emitter, id } from './Self'
import rfdc from 'rfdc'
import { logFlags } from '../logger'
import { nestedCountersInstance } from '..'
import { shardusGetTime } from '../network'
import { safeStringify } from '../utils'
import { getStandbyNodesInfoMap, standbyNodesInfo } from "./Join/v2";
import { getDesiredCount } from "./CycleAutoScale";

const clone = rfdc()

/** STATE */

let p2pLogger: Logger

export let nodes: Map<P2P.NodeListTypes.Node['id'], P2P.NodeListTypes.Node> // In order of joinRequestTimestamp [OLD, ..., NEW]
export let byPubKey: Map<P2P.NodeListTypes.Node['publicKey'], P2P.NodeListTypes.Node>
export let byIpPort: Map<string, P2P.NodeListTypes.Node>
export let byJoinOrder: P2P.NodeListTypes.Node[] // In order of joinRequestTimestamp [OLD, ..., NEW]
export let byIdOrder: P2P.NodeListTypes.Node[]
export let othersByIdOrder: P2P.NodeListTypes.Node[] // used by sendGossipIn
export let activeByIdOrder: P2P.NodeListTypes.Node[]
export let activeIdToPartition: Map<string, number>
export let syncingByIdOrder: P2P.NodeListTypes.Node[]
export let readyByTimeAndIdOrder: P2P.NodeListTypes.Node[]
export let activeOthersByIdOrder: P2P.NodeListTypes.Node[]
export let potentiallyRemoved: Set<P2P.NodeListTypes.Node['id']>
export let selectedById: Map<P2P.NodeListTypes.Node['id'], number>

const VERBOSE = false // Use to dump complete NodeList and CycleChain data

reset('init')

/** FUNCTIONS */

export function init() {
  p2pLogger = logger.getLogger('p2p')
  network.registerExternalGet('network-stats', (req, res) => {
    try {
      // todo: reject if request is not coming from node operator dashboard
      const networkStats = {
        active: activeByIdOrder.length,
        syncing: syncingByIdOrder.length,
        ready: readyByTimeAndIdOrder.length,
        standby: getStandbyNodesInfoMap().size,
        desired: getDesiredCount(),
      }
      return res.send(safeStringify(networkStats))
    } catch (e) {
      console.log(`Error getting load: ${e.message}`)
    }
  })
  network.registerExternalGet('age-index', isDebugModeMiddlewareLow, (req, res) => {
    try {
      return res.send(safeStringify(getAgeIndex()))
    } catch (e) {
      console.log(`Error getting age index: ${e.message}`)
    }
  })
}

export function reset(caller: string) {
  //this counter intance may not exist yet
  nestedCountersInstance?.countEvent('p2p', `NodeList reset: ${caller} ${shardusGetTime()}`)

  nodes = new Map()
  byPubKey = new Map()
  byIpPort = new Map()
  byJoinOrder = []
  byIdOrder = []
  othersByIdOrder = []
  activeByIdOrder = []
  activeIdToPartition = new Map()
  syncingByIdOrder = []
  readyByTimeAndIdOrder = []
  activeOthersByIdOrder = []
  potentiallyRemoved = new Set()
  selectedById = new Map()
}

export function addNode(node: P2P.NodeListTypes.Node, caller: string) {
  if (node == null) {
    //warn(`NodeList.addNode: tried to add null node ${caller}`)
    nestedCountersInstance.countEvent('p2p', `addNode rejecting null node from: ${caller}`)
    return
  }

  // Don't add duplicates
  if (nodes.has(node.id)) {
    warn(`NodeList.addNode: tried to add duplicate ${node.externalPort}: ${stringify(node)}\n` + `${caller}`)

    return
  }

  nodes.set(node.id, node)
  byPubKey.set(node.publicKey, node)
  byIpPort.set(ipPort(node.internalIp, node.internalPort), node)

  // Insert sorted by syncingTimestamp into byJoinOrder
  // in the past this used joinRequestTimestamp, but joinRequestTimestamp now is the time when a node is put into
  // the standbylist
  // this will contain nodes that are selected, syncing, ready, and active
  insertSorted(byJoinOrder, node, propComparator2('syncingTimestamp', 'id'))

  // Insert sorted by id into byIdOrder
  insertSorted(byIdOrder, node, propComparator('id'))

  // Dont insert yourself into othersbyIdOrder
  if (node.id !== id) {
    insertSorted(othersByIdOrder, node, propComparator('id'))
  }

  // If selected, insert into selectedByIdOrder
  if (node.status === P2P.P2PTypes.NodeStatus.SELECTED) {
    selectedById.set(node.id, node.counterRefreshed)
  }

  // If syncing, insert sorted by id into syncingByIdOrder
  if (node.status === P2P.P2PTypes.NodeStatus.SYNCING) {
    insertSorted(syncingByIdOrder, node, propComparator('id'))
  }

  // If node is READY status, insert sorted by readyTimestamp and id to tiebreak into readyByTimeAndIdOrder
  if (node.status === P2P.P2PTypes.NodeStatus.READY) {
    insertSorted(readyByTimeAndIdOrder, node, propComparator2('readyTimestamp', 'id'))
  }  

  // If active, insert sorted by id into activeByIdOrder
  if (node.status === P2P.P2PTypes.NodeStatus.ACTIVE) {
    insertSorted(activeByIdOrder, node, propComparator('id'))
    for (let i = 0; i < activeByIdOrder.length; i++) {
      activeIdToPartition.set(activeByIdOrder[i].id, i)
    }    

    // Dont insert yourself into activeOthersByIdOrder
    if (node.id !== id) {
      insertSorted(activeOthersByIdOrder, node, propComparator('id'))
    }

    // remove active node from syncing list
    removeSyncingNode(node.id)
    removeReadyNode(node.id)
  }
}
export function addNodes(newNodes: P2P.NodeListTypes.Node[], caller: string) {
  for (const node of newNodes) {
    addNode(node, caller)
  }
}

export function removeSelectedNode(id: string) {
  selectedById.delete(id)
}

export function removeSyncingNode(id: string) {
  const idx = binarySearch(syncingByIdOrder, { id }, propComparator('id'))
  /* prettier-ignore */ if (logFlags.verbose) console.log('Removing syncing node', id, idx)
  if (idx >= 0) syncingByIdOrder.splice(idx, 1)
}

export function removeReadyNode(id: string) {
  let idx = -1
  for (let i = 0; i < readyByTimeAndIdOrder.length; i++) {
    if (readyByTimeAndIdOrder[i].id === id) {
      idx = i
      break
    }
  }
  /* prettier-ignore */ if (logFlags.p2pNonFatal && logFlags.console) console.log('Removing ready node', id, idx)
  if (idx >= 0) readyByTimeAndIdOrder.splice(idx, 1)
}

export function removeNode(
  id: string,
  raiseEvents: boolean,
  cycle: P2P.CycleCreatorTypes.CycleRecord | null
) {
  let idx: number

  // Omar added this so we don't crash if a node gets remove more than once
  if (!nodes.has(id)) {
    console.log('Tried to delete a node that is not in the nodes list.', id)
    console.trace()
    return
  }

  // Remove from arrays
  idx = binarySearch(activeOthersByIdOrder, { id }, propComparator('id'))
  if (idx >= 0) activeOthersByIdOrder.splice(idx, 1)

  idx = binarySearch(activeByIdOrder, { id }, propComparator('id'))
  if (idx >= 0) {
    activeByIdOrder.splice(idx, 1)
    activeIdToPartition.delete(id)
  }

  idx = binarySearch(othersByIdOrder, { id }, propComparator('id'))
  if (idx >= 0) othersByIdOrder.splice(idx, 1)

  idx = binarySearch(byIdOrder, { id }, propComparator('id'))
  if (idx >= 0) byIdOrder.splice(idx, 1)

  idx = binarySearch(syncingByIdOrder, { id }, propComparator('id'))
  if (idx >= 0) syncingByIdOrder.splice(idx, 1)

  if (config.p2p.hardenNewSyncingProtocol) {
    removeReadyNode(id)
  } else {
    idx = binarySearch(readyByTimeAndIdOrder, { id }, propComparator('id'))
    if (idx >= 0) readyByTimeAndIdOrder.splice(idx, 1)
  }

  const syncingTimestamp = nodes.get(id).syncingTimestamp
  idx = binarySearch(byJoinOrder, { syncingTimestamp, id }, propComparator2('syncingTimestamp', 'id'))
  if (idx >= 0) {
    byJoinOrder.splice(idx, 1)
  }

  // Remove from maps
  const node = nodes.get(id)
  byIpPort.delete(ipPort(node.internalIp, node.internalPort))
  byPubKey.delete(node.publicKey)
  nodes.delete(id)
  selectedById.delete(id)
  //readyByTimeAndIdOrder = readyByTimeAndIdOrder.filter((node) => node.id !== id)

  Comms.evictCachedSockets([node])

  if (raiseEvents) {
    // check if this node is marked as "lost" prev cycle

    if (isNodeLeftNetworkEarly(node)) {
      const emitParams: Omit<ShardusEvent, 'type'> = {
        nodeId: node.id,
        reason: 'Node left early',
        time: cycle.start,
        publicKey: node.publicKey,
        cycleNumber: cycle.counter,
      }
      emitter.emit('node-left-early', emitParams)
    } else {
      const emitParams: Omit<ShardusEvent, 'type'> = {
        nodeId: node.id,
        reason: 'Node deactivated',
        time: cycle.start,
        publicKey: node.publicKey,
        cycleNumber: cycle.counter,
      }
      emitter.emit('node-deactivated', emitParams)
    }
  }
}

export function emitSyncTimeoutEvent(node: P2P.NodeListTypes.Node, cycle: P2P.CycleCreatorTypes.CycleRecord) {
  const emitParams: Omit<ShardusEvent, 'type'> = {
    nodeId: node.id,
    reason: 'Node sync timeout',
    time: cycle.start,
    publicKey: node.publicKey,
    cycleNumber: cycle.counter,
  }
  emitter.emit('node-sync-timeout', emitParams)
}

export function removeNodes(
  ids: string[],
  raiseEvents: boolean,
  cycle: P2P.CycleCreatorTypes.CycleRecord | null
) {
  for (const id of ids) removeNode(id, raiseEvents, cycle)
}

export function updateNode(
  update: P2P.NodeListTypes.Update,
  raiseEvents: boolean,
  cycle: P2P.CycleCreatorTypes.CycleRecord | null
) {
  const node = nodes.get(update.id)
  if (node) {
    // Update node properties
    for (const key of Object.keys(update)) {
      node[key] = update[key]
      // add node to syncing list if its status is changed to syncing
      if (update[key] === P2P.P2PTypes.NodeStatus.SYNCING) {
        insertSorted(syncingByIdOrder, node, propComparator('id'))
        removeSelectedNode(node.id)
      }
      if (update[key] === P2P.P2PTypes.NodeStatus.READY) {
        insertSorted(readyByTimeAndIdOrder, node, propComparator2('readyTimestamp', 'id'))
        if (config.p2p.hardenNewSyncingProtocol) {
          if (selectedById.has(node.id)) removeSelectedNode(node.id) // in case we missed the sync-started gossip
        }
        removeSyncingNode(node.id)
      }
    }
    //test if this node is in the active list already.  if it is not, then we can add it
    let idx = binarySearch(activeByIdOrder, { id: node.id }, propComparator('id'))
    if (idx < 0) {
      // Add the node to active arrays, if needed
      if (update.status === P2P.P2PTypes.NodeStatus.ACTIVE) {
        insertSorted(activeByIdOrder, node, propComparator('id'))
        for (let i = 0; i < activeByIdOrder.length; i++) {
          activeIdToPartition.set(activeByIdOrder[i].id, i)
        }
        // Don't add yourself to activeOthersByIdOrder
        if (node.id !== id) {
          insertSorted(activeOthersByIdOrder, node, propComparator('id'))
        }
        // remove active node from ready list
        /* prettier-ignore */ if (logFlags.verbose) console.log('updateNode: removing active node from ready list')
        removeReadyNode(node.id)

        if (raiseEvents) {
          const emitParams: Omit<ShardusEvent, 'type'> = {
            nodeId: node.id,
            reason: 'Node activated',
            time: cycle.start,
            publicKey: node.publicKey,
            cycleNumber: cycle.counter,
          }
          emitter.emit('node-activated', emitParams)
        }
      }
    }
  }
}

export function updateNodes(
  updates: P2P.NodeListTypes.Update[],
  raiseEvents: boolean,
  cycle: P2P.CycleCreatorTypes.CycleRecord | null
) {
  for (const update of updates) updateNode(update, raiseEvents, cycle)
}

export function isNodeLeftNetworkEarly(node: P2P.NodeListTypes.Node) {
  return CycleChain.newest && CycleChain.newest.lost.includes(node.id)
}
export function isNodeRefuted(node: P2P.NodeListTypes.Node) {
  return CycleChain.newest && CycleChain.newest.refuted.includes(node.id)
}
export function createNode(joined: P2P.JoinTypes.JoinedConsensor) {
  const node: P2P.NodeListTypes.Node = {
    ...joined,
    curvePublicKey: crypto.convertPublicKeyToCurve(joined.publicKey),
    status: P2P.P2PTypes.NodeStatus.SELECTED,
  }

  return node
}

export function ipPort(ip: string, port: number) {
  return ip + ':' + port
}

function idTrim(id: string) {
  return id.substr(0, 4)
}

export function getDebug() {
  let output = `
    NODES:
      hash:                  ${crypto.hash(byJoinOrder).slice(0, 5)}
      byJoinOrder:           [${byJoinOrder
        .map((node) => `${node.externalIp}:${node.externalPort}-${node.counterRefreshed}`)
        .join()}]
      byIdOrder:             [${byIdOrder
        .map((node) => `${node.externalIp}:${node.externalPort}` + '-x' + idTrim(node.id))
        .join()}]
      othersByIdOrder:       [${othersByIdOrder.map((node) => `${node.externalIp}:${node.externalPort}`)}]
      activeByIdOrder:       [${activeByIdOrder.map((node) => `${node.externalIp}:${node.externalPort}`)}]
      activeOthersByIdOrder: [${activeOthersByIdOrder.map(
        (node) => `${node.externalIp}:${node.externalPort}`
      )}]
      `
  if (VERBOSE)
    output += `
    NODELIST:   ${stringify(byJoinOrder)}
    CYCLECHAIN: ${stringify(CycleChain.cycles)}
  `
  return output
}

/**
 * The index starts at 1, not 0.  1 is the youngest node, idx === total is the oldest node.
 * @returns {idx: number, total: number} - idx is the index of the node in the list, total is the total number of nodes in the list
 */
export function getAgeIndex(): { idx: number; total: number } {
  return getAgeIndexForNodeId(id)
}

export function getAgeIndexForNodeId(nodeId: string): { idx: number; total: number } {
  const totalNodes = activeByIdOrder.length
  let index = 1
  for (let i = byJoinOrder.length - 1; i >= 0; i--) {
    if (byJoinOrder[i].id === nodeId && byJoinOrder[i].status === P2P.P2PTypes.NodeStatus.ACTIVE) {
      return { idx: index, total: totalNodes }
    } else if (byJoinOrder[i].status === P2P.P2PTypes.NodeStatus.ACTIVE) {
      index++
    }
  }
  return { idx: -1, total: totalNodes }
}

/** Returns the validator list hash. It is a hash of the NodeList sorted by join order. This will also update the recorded `lastHashedList` of nodes, which can be retrieved via `getLastHashedNodeList`. */
export function computeNewNodeListHash(): hexstring {
  // set the lastHashedList to the current list by join order, then hash.
  // deep cloning is necessary as validator information may be mutated by
  // reference.
  lastHashedList = clone(byJoinOrder)
  /* prettier-ignore */ if (logFlags.verbose) info('hashing validator list:', JSON.stringify(lastHashedList))
  let hash = crypto.hash(lastHashedList)
  /* prettier-ignore */ if (logFlags.verbose) info('the new validator list hash is', hash)
  return hash
}

/**
 * For Sync v2, returns the validator list hash from the last complete cycle, if available. If you
 * want to compute a new hash instead, use `computeNewNodeListHash`.
 *
 * If Sync v2 is not enabled, it returns the hash of a sorted list of active node IDs.
 */
export function getNodeListHash(): hexstring | undefined {
  if (config.p2p.writeSyncProtocolV2 || config.p2p.useSyncProtocolV2) {
    /* prettier-ignore */ if (logFlags.verbose) info('returning validator list hash:', CycleChain.newest?.nodeListHash)
    return CycleChain.newest?.nodeListHash
  } else {
    // this is how the `nodelistHash` is computed before Sync v2
    const nodelistIDs = activeByIdOrder.map((node) => node.id)
    return crypto.hash(nodelistIDs)
  }
}

let lastHashedList: P2P.NodeListTypes.Node[] = []

/** Returns the last list of nodes that had its hash computed. */
export function getLastHashedNodeList(): P2P.NodeListTypes.Node[] {
  /* prettier-ignore */ if (logFlags.verbose) info('returning last hashed validator list:', JSON.stringify(lastHashedList))
  return lastHashedList
}

export function changeNodeListInRestore(cycleStartTimestamp: number) {
  info(`changeNodeListInRestore: ${cycleStartTimestamp}`)
  nestedCountersInstance.countEvent('p2p', `changeNodeListInRestore: ${cycleStartTimestamp}`)
  if (activeByIdOrder.length === 0) return
  // Combine activeByIdOrder to syncingByIdOrder nodelist; Clear activeByIdOrder and activeOthersByIdOrder nodelists
  for (const node of activeByIdOrder) {
    node.syncingTimestamp = cycleStartTimestamp
    insertSorted(syncingByIdOrder, node, propComparator('id'))
  }
  activeByIdOrder = []
  activeOthersByIdOrder = []
  // change active status nodes to syncing status
  for (const [, node] of nodes) {
    if (node.status === P2P.P2PTypes.NodeStatus.ACTIVE) {
      node.status = P2P.P2PTypes.NodeStatus.SYNCING
      node.syncingTimestamp = cycleStartTimestamp
    }
  }
  for (const [, node] of byPubKey) {
    if (node.status === P2P.P2PTypes.NodeStatus.ACTIVE) {
      node.status = P2P.P2PTypes.NodeStatus.SYNCING
      node.syncingTimestamp = cycleStartTimestamp
    }
  }
  for (const [, node] of byIpPort) {
    if (node.status === P2P.P2PTypes.NodeStatus.ACTIVE) {
      node.status = P2P.P2PTypes.NodeStatus.SYNCING
      node.syncingTimestamp = cycleStartTimestamp
    }
  }
  for (const node of byJoinOrder) {
    if (node.status === P2P.P2PTypes.NodeStatus.ACTIVE) {
      node.status = P2P.P2PTypes.NodeStatus.SYNCING
      node.syncingTimestamp = cycleStartTimestamp
    }
  }
  for (const node of byIdOrder) {
    if (node.status === P2P.P2PTypes.NodeStatus.ACTIVE) {
      node.status = P2P.P2PTypes.NodeStatus.SYNCING
      node.syncingTimestamp = cycleStartTimestamp
    }
  }
  for (const node of othersByIdOrder) {
    if (node.status === P2P.P2PTypes.NodeStatus.ACTIVE) {
      node.status = P2P.P2PTypes.NodeStatus.SYNCING
      node.syncingTimestamp = cycleStartTimestamp
    }
  }
}

/** ROUTES */

function info(...msg: string[]) {
  const entry = `NodeList: ${msg.join(' ')}`
  p2pLogger.info(entry)
}

function warn(...msg: string[]) {
  const entry = `NodeList: ${msg.join(' ')}`
  p2pLogger.warn(entry)
}

function error(...msg: any[]) {
  const entry = `NodeList: ${msg.join(' ')}`
  p2pLogger.error(entry)
}
