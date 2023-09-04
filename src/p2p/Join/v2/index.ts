/**
  * `v2` houses some new state or functions introduced with Join Protocol v2.
  * TODO: Rename this module later?
  */

import { hexstring, P2P } from "@shardus/types";
import { JoinRequest, StandbyAdditionInfo } from "@shardus/types/build/src/p2p/JoinTypes";
import { crypto } from '../../Context'
import * as CycleChain from '../../CycleChain'
import rfdc from 'rfdc'

const clone = rfdc()

/** The list of nodes that are currently on standby. */
const standbyNodesInfo: Map<StandbyAdditionInfo['publicKey'], StandbyAdditionInfo> = new Map()

/**
  * New join requests received during the node's current cycle. This list is
  * "flushed" when the cycle is digested. Its entries are added to `standbyNodeList` as part of cycle...
  * digestion. appetizing!
  */
let newJoinRequests: JoinRequest[] = []

/**
  * All join requests that have been received from other nodes.
  */
const allJoinRequests: Map<P2P.P2PTypes.Node['publicKey'], JoinRequest> = new Map()

/**
  * Pushes the join request onto the list of new join requests. Its node's info
  * will be added to the standby node list at the end of the cycle during cycle
  * digestion.
  */
export function saveJoinRequest(joinRequest: JoinRequest): void {
  console.log('saving join request:', joinRequest)
  newJoinRequests.push(joinRequest)
  allJoinRequests.set(joinRequest.nodeInfo.publicKey, joinRequest)
}

/**
  * Returns the list of new join requests and empties the list.
  */
export function drainNewJoinRequests(): JoinRequest[] {
  console.log('draining new join requests:', newJoinRequests)
  const tmp = newJoinRequests
  newJoinRequests = []
  return tmp
}

/**
  * Adds nodes to the standby node list.
  */
export function addStandbyNodes(...nodes: StandbyAdditionInfo[]): void {
  console.log('adding standby nodes:', nodes)
  for (const node of nodes) {
    standbyNodesInfo.set(node.publicKey, node)
  }
}

let lastHashedList: StandbyAdditionInfo[] = []

/**
  * Returns the list of standby nodes, sorted by their public keys.
  */
export function getSortedStandbyNodeList(): StandbyAdditionInfo[] {
  console.log('getting sorted standby node list')
  return [...standbyNodesInfo.values()].sort((a, b) =>
    // using mathematical comparison in case localeCompare is inconsistent.
    // we will use a simple ternary statement for this that doens't account for
    // equality. this should be fine as no two public keys should be the same.
    a.publicKey > b.publicKey ? 1 : -1
  )
}

/** Calculates and returns a hash based on the list of standby nodes, sorted by public key. This will also update the recorded `lastHashedList` of nodes, which can be retrieved via `getLastHashedStandbyList`. */
export function computeNewStandbyListHash(): hexstring {
  console.log('computing new standby list hash')
  // set the lastHashedList to the current list by pubkey, then hash.
  // deep cloning is necessary as standby node information may be mutated by
  // reference.
  lastHashedList = clone(getSortedStandbyNodeList())
  const hash = crypto.hash(lastHashedList)
  return hash
}

/**
 * Returns the standby node list hash from the last complete cycle, if available. If you
 * want to compute a new hash instead, use `computeNewStandbyListHash`.
 */
export function getStandbyListHash(): hexstring | undefined {
  console.log('getting standby list hash')
  return CycleChain.newest?.standbyNodeListHash
}

/** Returns the last list of standby information that had its hash computed. */
export function getLastHashedStandbyList(): StandbyAdditionInfo[] {
  console.log('getting last hashed standby list')
  return lastHashedList
}

export function getStandbyNodesInfoMap(): Map<P2P.JoinTypes.StandbyAdditionInfo['publicKey'], P2P.JoinTypes.StandbyAdditionInfo> {
  console.log('getting standby nodes info map')
  return standbyNodesInfo
}

export function getAllJoinRequestsMap(): Map<P2P.P2PTypes.Node['publicKey'], P2P.JoinTypes.JoinRequest> {
  console.log('getting all join requests map')
  return allJoinRequests
}
