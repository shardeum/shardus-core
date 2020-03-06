import { p2p } from './P2PContext'
import deepmerge = require('deepmerge')
import { notEqual } from 'assert'
import { JoinedConsensor } from './CycleChain'

/** TYPES */

type Diff<T, U> = T extends U ? never : T

type OptionalExceptFor<T, TRequired extends keyof T> = Partial<T> &
  Pick<T, TRequired>

type RequiredExceptFor<T, TOptional extends keyof T> = Pick<
  T,
  Diff<keyof T, TOptional>
> &
  Partial<T>

export interface Node {
  externalIp: string
  externalPort: number
  internalIp: string
  internalPort: number
  publicKey: string
  address: string
  joinRequestTimestamp: number
  status: string
  curvePublicKey: string
  id: string
}

export type Update = OptionalExceptFor<Node, 'id'>

/** STATE */

const nodeList: Map<Node['id'], Node> = new Map() // In order of joinRequestTimestamp [OLD, ..., NEW]
const publicKeyToId: { [publicKey: string]: string } = {}
const externalIpPortToId: { [externalIpPort: string]: string } = {}
const internalIpPortToId: { [internalIpPort: string]: string } = {}

/** FUNCTIONS */

export function idBy(type: string, publicKeyOrIp: string, port?: number) {
  switch (type) {
    case 'publicKey': {
      return publicKeyToId[publicKeyOrIp]
    }
    case 'externalIpPort': {
      if (port) {
        return externalIpPortToId[ipPort(publicKeyOrIp, port)]
      }
      break
    }
    case 'internalIpPort': {
      if (port) {
        return internalIpPortToId[ipPort(publicKeyOrIp, port)]
      }
      break
    }
    default: {
      break
    }
  }
}

export function byId(id: Node['id']) {
  return nodeList.get(id)
}
export function byPublicKey(publicKey: Node['id']) {
  const id = publicKeyToId[publicKey]
  return nodeList.get(id)
}
export function byExternalIpPort(
  ip: Node['externalIp'],
  port: Node['externalPort']
) {
  const externalIpPort = ipPort(ip, port)
  const id = externalIpPortToId[externalIpPort]
  return nodeList.get(id)
}
export function byInternalIpPort(
  ip: Node['internalIp'],
  port: Node['internalPort']
) {
  const internalIpPort = ipPort(ip, port)
  const publicKey = internalIpPortToId[internalIpPort]
  return nodeList.get(publicKey)
}

export function addNodes(nodes: Node[]) {
  for (const node of nodes) {
    nodeList.set(node.id, node)
    publicKeyToId[node.id] = node.id
    externalIpPortToId[ipPort(node.externalIp, node.externalPort)] = node.id
    internalIpPortToId[ipPort(node.internalIp, node.internalPort)] = node.id
  }
}
export function removeNodes(ids: string[]) {
  for (const id of ids) {
    const node = nodeList.get(id)
    if (node) {
      if (publicKeyToId[node.id]) delete publicKeyToId[node.id]
      const externalIpPort = ipPort(node.externalIp, node.externalPort)
      if (externalIpPortToId[externalIpPort]) {
        delete externalIpPortToId[externalIpPort]
      }
      const internalIpPort = ipPort(node.internalIp, node.internalPort)
      if (internalIpPortToId[internalIpPort]) {
        delete internalIpPort[internalIpPort]
      }
      nodeList.delete(id)
    }
  }
}
export function updateNodes(updates: Update[]) {
  for (const update of updates) {
    const node = nodeList.get(update.id)
    if (node) {
      nodeList.set(update.id, deepmerge<Node>(node, update))
    }
  }
}
export function createNode(joined: JoinedConsensor) {
  const node: Node = {
    externalIp: joined.externalIp,
    externalPort: joined.externalPort,
    internalIp: joined.internalIp,
    internalPort: joined.internalPort,
    publicKey: joined.publicKey,
    address: joined.address,
    joinRequestTimestamp: joined.joinRequestTimestamp,
    status: 'syncing',
    curvePublicKey: p2p.crypto.convertPublicKeyToCurve(joined.publicKey),
    id: joined.id,
  }

  return node
}

function ipPort(ip: string, port: number) {
  return ip + ':' + port
}
