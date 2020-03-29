import { insertSorted } from '../utils'
import { p2p } from './Context'
import { JoinedConsensor } from './Joining'
import { NodeStatus } from './Types'
import deepmerge = require('deepmerge')

/** TYPES */

type Diff<T, U> = T extends U ? never : T

type OptionalExceptFor<T, TRequired extends keyof T> = Partial<T> &
  Pick<T, TRequired>

type RequiredExceptFor<T, TOptional extends keyof T> = Pick<
  T,
  Diff<keyof T, TOptional>
> &
  Partial<T>

export interface Node extends JoinedConsensor {
  curvePublicKey: string
  status: NodeStatus
}

export type Update = OptionalExceptFor<Node, 'id'>

/** STATE */

export let nodes: Map<Node['id'], Node> // In order of joinRequestTimestamp [OLD, ..., NEW]
export let byPubKey: Map<Node['publicKey'], Node>
export let byIpPort: Map<string, Node>
export let byJoinOrder: Node[]
export let byIdOrder: Node[]
export let activeByIdOrder: Node[]

function initialize() {
  nodes = new Map()
  byPubKey = new Map()
  byIpPort = new Map()
  byJoinOrder = []
  byIdOrder = []
  activeByIdOrder = []
}
initialize()

/** FUNCTIONS */

export function reset() {
  initialize()
}

export async function addNode(node: Node) {
  nodes.set(node.id, node)
  byPubKey.set(node.publicKey, node)
  byIpPort.set(ipPort(node.internalIp, node.internalPort), node)
  // Insert sorted by joinRequestTimstamp into byJoinOrder
  insertSorted(byJoinOrder, node, (a, b) => {
    if (a.joinRequestTimestamp === b.joinRequestTimestamp) {
      return this.crypto.isGreaterHash(a.id, b.id) ? 1 : -1
    }
    return a.joinRequestTimestamp > b.joinRequestTimestamp ? 1 : -1
  })
  // Insert sorted by id into byIdOrder
  insertSorted(byIdOrder, node, (a, b) => {
    return a.id === b.id ? 0 : a.id < b.id ? -1 : 1
  })
  // If active, insert sorted by id into activeByIdOrder
  if (node.status === NodeStatus.ACTIVE) {
    insertSorted(activeByIdOrder, node, (a, b) => {
      return a.id === b.id ? 0 : a.id < b.id ? -1 : 1
    })
  }
}
export async function addNodes(newNodes: Node[]) {
  for (const node of newNodes) addNode(node)
}

export function removeNode(id) {
  // In reverse
  let idx
  idx = binarySearch(activeByIdOrder, { id })
  if (idx >= 0) activeByIdOrder.splice(idx, 1)
  idx = binarySearch(byIdOrder, { id })
  if (idx >= 0) byIdOrder.splice(idx, 1)
  idx = binarySearch(byJoinOrder, { id })
  if (idx >= 0) byJoinOrder.splice(idx, 1)
  byIpPort.delete(id)
  byPubKey.delete(id)
  nodes.delete(id)
}
export function removeNodes(ids: string[]) {
  for (const id of ids) removeNode(id)
}

export async function updateNode(update: Update) {
  // [TODO] Make this mutate the existing object
  const node = nodes.get(update.id)
  if (node) {
    removeNode(update.id)
    addNode(deepmerge<Node>(node, update))
  }
}
export async function updateNodes(updates: Update[]) {
  for (const update of updates) updateNode(update)
}

export function createNode(joined: JoinedConsensor) {
  const node: Node = {
    ...joined,
    curvePublicKey: p2p.crypto.convertPublicKeyToCurve(joined.publicKey),
    status: NodeStatus.SYNCING,
  }

  return node
}

function ipPort(ip: string, port: number) {
  return ip + ':' + port
}

function binarySearch<T>(array: T[], obj: Partial<T>): number {
  let idx = -1
  const [key, value] = Object.entries(obj)[0]
  // [TODO] Implement a binary search
  idx = array.findIndex(item => item[key] === value)
  return idx
}
