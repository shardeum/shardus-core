import { p2p } from './Context'
import { JoinedConsensor } from './CycleChain'
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

export const nodes: Map<Node['id'], Node> = new Map() // In order of joinRequestTimestamp [OLD, ..., NEW]
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
  return nodes.get(id)
}
export function byPublicKey(publicKey: Node['id']) {
  const id = publicKeyToId[publicKey]
  return nodes.get(id)
}
export function byExternalIpPort(
  ip: Node['externalIp'],
  port: Node['externalPort']
) {
  const externalIpPort = ipPort(ip, port)
  const id = externalIpPortToId[externalIpPort]
  return nodes.get(id)
}
export function byInternalIpPort(
  ip: Node['internalIp'],
  port: Node['internalPort']
) {
  const internalIpPort = ipPort(ip, port)
  const publicKey = internalIpPortToId[internalIpPort]
  return nodes.get(publicKey)
}

export async function addNodes(newNodes: Node[]) {
  for (const node of newNodes) {
    nodes.set(node.id, node)
    publicKeyToId[node.id] = node.id
    externalIpPortToId[ipPort(node.externalIp, node.externalPort)] = node.id
    internalIpPortToId[ipPort(node.internalIp, node.internalPort)] = node.id

    // Add nodes to old p2p-state nodelist
    // [TODO] Remove this once eveything is using new NodeList.ts
    await p2p.state.addNode(node)
  }
}
export function removeNodes(ids: string[]) {
  for (const id of ids) {
    const node = nodes.get(id)
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
      nodes.delete(id)
    }
  }
}
export async function updateNodes(updates: Update[]) {
  for (const update of updates) {
    const node = nodes.get(update.id)
    if (node) {
      nodes.set(update.id, deepmerge<Node>(node, update))

      // Update nodes in old p2p-state nodelist
      // [TODO] Remove this once eveything is using new NodeList.ts
      if (update.activeTimestamp) {
        await p2p.state._setNodesActiveTimestamp(
          [update.id],
          update.activeTimestamp
        )
      }
      if (update.status) {
        await p2p.state._updateNodeStatus(node, update.status)
      }
    }
  }
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
