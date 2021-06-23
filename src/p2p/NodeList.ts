import { Logger } from 'log4js'
import { stringify } from 'shardus-crypto-utils'
import {
  binarySearch,
  insertSorted,
  propComparator,
  propComparator2,
} from '../utils'
import { crypto, logger } from './Context'
import * as CycleChain from './CycleChain'
import { JoinedConsensor } from "../shared-types/p2p/JoinTypes"
import { id } from './Self'
import { NodeStatus } from '../shared-types/p2p/P2PTypes'
import deepmerge = require('deepmerge')
import { Node, Update } from '../shared-types/p2p/NodeListTypes'

/** STATE */

let p2pLogger: Logger

export let nodes: Map<Node['id'], Node> // In order of joinRequestTimestamp [OLD, ..., NEW]
export let byPubKey: Map<Node['publicKey'], Node>
export let byIpPort: Map<string, Node>
export let byJoinOrder: Node[] // In order of joinRequestTimestamp [OLD, ..., NEW]
export let byIdOrder: Node[]
export let othersByIdOrder: Node[] // used by sendGossipIn
export let activeByIdOrder: Node[]
export let activeOthersByIdOrder: Node[]
export let potentiallyRemoved: Set<Node['id']>

const VERBOSE = false // Use to dump complete NodeList and CycleChain data

reset()

/** FUNCTIONS */

export function init() {
  p2pLogger = logger.getLogger('p2p')
}

export function reset() {
  nodes = new Map()
  byPubKey = new Map()
  byIpPort = new Map()
  byJoinOrder = []
  byIdOrder = []
  othersByIdOrder = []
  activeByIdOrder = []
  activeOthersByIdOrder = []
  potentiallyRemoved = new Set()
}

export function addNode(node: Node) {
  // Don't add duplicates
  if (nodes.has(node.id)) {
    warn(
      `NodeList.addNode: tried to add duplicate ${
        node.externalPort
      }: ${stringify(node)}\n` + `${new Error().stack}`
    )

    return
  }

  nodes.set(node.id, node)
  byPubKey.set(node.publicKey, node)
  byIpPort.set(ipPort(node.internalIp, node.internalPort), node)

  // Insert sorted by joinRequestTimstamp into byJoinOrder
  insertSorted(byJoinOrder, node, propComparator2('joinRequestTimestamp', 'id'))

  // Insert sorted by id into byIdOrder
  insertSorted(byIdOrder, node, propComparator('id'))

  // Dont insert yourself into othersbyIdOrder
  if (node.id !== id) {
    insertSorted(othersByIdOrder, node, propComparator('id'))
  }

  // If active, insert sorted by id into activeByIdOrder
  if (node.status === NodeStatus.ACTIVE) {
    insertSorted(activeByIdOrder, node, propComparator('id'))

    // Dont insert yourself into activeOthersByIdOrder
    if (node.id !== id) {
      insertSorted(activeOthersByIdOrder, node, propComparator('id'))
    }
  }
}
export function addNodes(newNodes: Node[]) {
  for (const node of newNodes) addNode(node)
}

export function removeNode(id) {
  let idx

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
  if (idx >= 0) activeByIdOrder.splice(idx, 1)

  idx = binarySearch(othersByIdOrder, { id }, propComparator('id'))
  if (idx >= 0) othersByIdOrder.splice(idx, 1)

  idx = binarySearch(byIdOrder, { id }, propComparator('id'))
  if (idx >= 0) byIdOrder.splice(idx, 1)

  const joinRequestTimestamp = nodes.get(id).joinRequestTimestamp
  idx = binarySearch(
    byJoinOrder,
    { joinRequestTimestamp, id },
    propComparator2('joinRequestTimestamp', 'id')
  )
  if (idx >= 0) byJoinOrder.splice(idx, 1)

  // Remove from maps
  const node = nodes.get(id)
  byIpPort.delete(ipPort(node.internalIp, node.internalPort))
  byPubKey.delete(node.publicKey)
  nodes.delete(id)
}
export function removeNodes(ids: string[]) {
  for (const id of ids) removeNode(id)
}

export function updateNode(update: Update) {
  const node = nodes.get(update.id)
  if (node) {
    // Update node properties
    for (const key of Object.keys(update)) {
      node[key] = update[key]
    }

    // Add the node to active arrays, if needed
    if (update.status === NodeStatus.ACTIVE) {
      insertSorted(activeByIdOrder, node, propComparator('id'))
      // Don't add yourself to
      if (node.id !== id) {
        insertSorted(activeOthersByIdOrder, node, propComparator('id'))
      }
    }
  }
}
export function updateNodes(updates: Update[]) {
  for (const update of updates) updateNode(update)
}

export function createNode(joined: JoinedConsensor) {
  const node: Node = {
    ...joined,
    curvePublicKey: crypto.convertPublicKeyToCurve(joined.publicKey),
    status: NodeStatus.SYNCING,
  }

  return node
}

export function ipPort(ip: string, port: number) {
  return ip + ':' + port
}

function idTrim(id) {
  return id.substr(0, 4)
}

export function getDebug() {
  let output = `
    NODES:
      hash:                  ${crypto.hash(byJoinOrder).slice(0, 5)}
      byJoinOrder:           [${byJoinOrder
        .map(
          (node) =>
            `${node.externalIp}:${node.externalPort}-${node.counterRefreshed}`
        )
        .join()}]
      byIdOrder:             [${byIdOrder
        .map(
          (node) =>
            `${node.externalIp}:${node.externalPort}` + '-x' + idTrim(node.id)
        )
        .join()}]
      othersByIdOrder:       [${othersByIdOrder.map(
        (node) => `${node.externalIp}:${node.externalPort}`
      )}]
      activeByIdOrder:       [${activeByIdOrder.map(
        (node) => `${node.externalIp}:${node.externalPort}`
      )}]
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

/** ROUTES */

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
