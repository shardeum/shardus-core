/**
 * `v2` houses some new state or functions introduced with Join Protocol v2.
 * TODO: Rename this module later?
 */

import { P2P, hexstring } from '@shardus/types'
import { JoinRequest } from '@shardus/types/build/src/p2p/JoinTypes'
import { config, crypto, shardus } from '../../Context'
import * as CycleChain from '../../CycleChain'
import * as Self from '../../Self'
import rfdc from 'rfdc'
import { executeNodeSelection, notifyNewestJoinedConsensors } from './select'
import { attempt } from '../../Utils'
import { submitUnjoin } from './unjoin'
import { ResultAsync } from 'neverthrow'
import { reset as resetAcceptance } from './acceptance'
import { stringifyReduce } from '../../../utils/functions/stringifyReduce'
import { logFlags } from '../../../logger'
import { submitStandbyAdd } from './standbyAdd'
import { Utils } from '@shardus/types'

const clone = rfdc()

/** Just a local convenience type. */
type publickey = JoinRequest['nodeInfo']['publicKey']

/** The list of nodes that are currently on standby. */
export const standbyNodesInfo: Map<publickey, JoinRequest> = new Map()

export const standbyNodesInfoHashes: Map<publickey, string> = new Map()
/** This list is a map of standby node public keys to refreshed time in seconds */
export const standbyNodesRefresh: Map<publickey, number> = new Map()

/**
 * New join requests received during the node's current cycle. This list is
 * "drained" when the cycle is digested. Its entries are added to `standbyNodeList` as part of cycle...
 * digestion. appetizing!
 */
let newJoinRequests: JoinRequest[] = []

export function init(): void {
  console.log('initializing join protocol v2')

  // set up event listeners for cycle quarters
  Self.emitter.on('cycle_q1_start', () => {
    if (config.p2p.useJoinProtocolV2) {
      //TODO clean out the accepted route or is it still useful?
      //accepted endpoint does not return any more
      // The accepted flow is deprecated
      // notifyNewestJoinedConsensors().catch((e) => {
      //   console.error('failed to notify selected nodes:', e)
      // })
    }
  })
  Self.emitter.on('cycle_q2_start', () => {
    if (config.p2p.useJoinProtocolV2) executeNodeSelection()
  })
}

function addJoinRequestToStandbyMap(joinRequest: JoinRequest): void {
  //this is the same as before.  add the join request to the map
  standbyNodesInfo.set(joinRequest.nodeInfo.publicKey, joinRequest)
  //here we add the hash of the joinrequest to a different map
  standbyNodesInfoHashes.set(joinRequest.nodeInfo.publicKey, crypto.hash(joinRequest))
}

export function deleteStandbyNodeFromMap(key: publickey): boolean {
  if (standbyNodesInfo.has(key)) {
    standbyNodesInfo.delete(key)
    standbyNodesInfoHashes.delete(key)
    return true
  }
  return false
}

/**
 * Pushes the join request onto the list of new join requests. Its node's info
 * will be added to the standby node list at the end of the cycle during cycle
 * digestion.
 *
 * @param joinRequest The join request to save.
 * @param persistImmediately If true, the node will be added to the standby node list immediately. This can be used for the first node in the network.
 */
export function saveJoinRequest(joinRequest: JoinRequest, persistImmediately = false): void {
  if (logFlags.verbose) console.log('saving join request:', joinRequest)

  // if first node, add to standby list immediately
  if (persistImmediately) {
    addJoinRequestToStandbyMap(joinRequest)
    return
  }

  //TODO confirm this is the best place to submit the standby add tx
  if (!shardus.p2p.isFirstSeed) {
    submitStandbyAdd(joinRequest)
  }
  newJoinRequests.push(joinRequest)
}

/**
 * Returns the list of new standby join requests and empties the list.
 */
export function drainNewJoinRequests(): JoinRequest[] {
  if (logFlags.verbose) console.log('draining new standby info:', newJoinRequests)
  const tmp = newJoinRequests
  newJoinRequests = []
  return tmp
}

/**
 * Adds nodes to the standby node list.
 */
export function addStandbyJoinRequests(nodes: JoinRequest[], logErrors = false): void {
  if (logFlags.verbose) console.log('adding standby nodes:', nodes)
  //TODO proper input validation
  for (const joinRequest of nodes) {
    if (getStandbyNodesInfoMap().size >= config.p2p.maxStandbyCount) {
      /* prettier-ignore */ if (logErrors && logFlags.important_as_fatal) console.error('standby nodes list is max capacity reached. Cannot add more nodes.')
      return;
    }

    if (joinRequest == null) {
      /* prettier-ignore */ if (logErrors && logFlags.important_as_fatal) console.error('null node in standby list')
      continue
    }
    if (joinRequest.nodeInfo == null) {
      /* prettier-ignore */ if (logErrors && logFlags.important_as_fatal) console.error('null node.nodeInfo in standby list: ' + Utils.safeStringify(joinRequest))
      continue
    }
    addJoinRequestToStandbyMap(joinRequest)
  }
}

let lastHashedList: JoinRequest[] = []

/**
 * Returns the list of standby nodes, sorted by their public keys.
 */
export function getSortedStandbyJoinRequests(): JoinRequest[] {
  if (logFlags.verbose) console.log('getting sorted standby node list')
  return [...standbyNodesInfo.values()].sort((a, b) =>
    // using mathematical comparison in case localeCompare is inconsistent.
    // we will use a simple ternary statement for this that doesn't account for
    // equality. this should be fine as no two public keys should be the same.
    a.nodeInfo.publicKey > b.nodeInfo.publicKey ? 1 : -1
  )
}

/** Calculates and returns a hash based on the list of standby nodes, sorted by public key. This will also update the recorded `lastHashedList` of nodes, which can be retrieved via `getLastHashedStandbyList`. */
export function computeNewStandbyListHash(): hexstring {
  if (config.p2p.standbyListFastHash) {
    //this field must be udpated as it is used by other functions
    lastHashedList = Array.from(getSortedStandbyJoinRequests())
    //sort hashes by value.  could sort by ID, but this is a bit faster

    const hashes = Array.from(standbyNodesInfoHashes.values())
    hashes.sort()
    const hash = crypto.hash(hashes)
    return hash
  }

  // set the lastHashedList to the current list by pubkey, then hash.
  lastHashedList = Array.from(getSortedStandbyJoinRequests())
  const hash = crypto.hash(lastHashedList)

  if (logFlags.verbose) {
    console.log(`computing new standby list hash: ${hash} number of nodes: ${lastHashedList.length}`)
    //use map to convert lastHashedList to a list of public keys
    const publicKeyList = lastHashedList.map((node) => node.nodeInfo.publicKey)
    console.log(`{standby_public_key_list: ${stringifyReduce(publicKeyList)}}`)
  }
  return hash
}

/**
 * Returns the standby node list hash from the last complete cycle, if available. If you
 * want to compute a new hash instead, use `computeNewStandbyListHash`.
 */
export function getStandbyListHash(): hexstring | undefined {
  if (logFlags.verbose) console.log('getting standby list hash')
  return CycleChain.newest?.standbyNodeListHash
}

/** Returns the last list of standby information that had its hash computed. */
export function getLastHashedStandbyList(): JoinRequest[] {
  if (logFlags.verbose) console.log('getting last hashed standby list')
  return lastHashedList
}

/** Returns the map of standby information. */
export function getStandbyNodesInfoMap(): Map<publickey, JoinRequest> {
  if (logFlags.verbose) console.log('getting standby nodes info map')
  return standbyNodesInfo
}

export function updateStandbyRefreshCounter(updatedJoinRequest: JoinRequest): void {
  const originalJoinRequest = standbyNodesInfo.get(updatedJoinRequest.nodeInfo.publicKey)

  // TODO: Ask pod1 if we need to updated lastHashedList here

  if (areJoinRequestsIdenticalExceptRefreshCounter(originalJoinRequest, updatedJoinRequest)) {
    if (standbyNodesRefresh.has(updatedJoinRequest.nodeInfo.publicKey))
      standbyNodesInfo.set(updatedJoinRequest.nodeInfo.publicKey, updatedJoinRequest)
    if (standbyNodesInfoHashes.has(updatedJoinRequest.nodeInfo.publicKey))
      standbyNodesInfoHashes.set(updatedJoinRequest.nodeInfo.publicKey, crypto.hash(updatedJoinRequest))
  } else {
    console.error('Trying to update Join request fields other than refreshedCounter. Ignoring the update.')
  }
}

function areJoinRequestsIdenticalExceptRefreshCounter(original: JoinRequest, updated: JoinRequest): boolean {
  // Clone the objects to avoid mutating the original ones
  const originalCopy = Utils.safeJsonParse(Utils.safeStringify(original));
  const updatedCopy = Utils.safeJsonParse(Utils.safeStringify(updated));

  delete originalCopy.refreshedCounter
  delete updatedCopy.refreshedCounter

  // Compare the two objects without the refreshedCounter field
  return deepEqual(originalCopy, updatedCopy);
}

function deepEqual(obj1, obj2): boolean {
  if (obj1 === obj2) {
      return true; // Identical references or primitive values
  }

  if (typeof obj1 !== 'object' || obj1 === null || typeof obj2 !== 'object' || obj2 === null) {
      return false; // One of them is not an object or is null
  }

  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) {
      return false; // Different number of properties
  }

  for (const key of keys1) {
      if (!keys2.includes(key) || !deepEqual(obj1[key], obj2[key])) {
          return false; // Different keys or values
      }
  }

  return true; // Everything matched
}

export function isOnStandbyList(publicKey: string): boolean {
  if (standbyNodesInfo.has(publicKey)) {
    return true
  } else {
    return false
  }
}

export function debugDumpJoinRequestList(list: JoinRequest[], message: string): void {
  list.sort((a, b) => (a.nodeInfo.publicKey > b.nodeInfo.publicKey ? 1 : -1))
  //let getSortedStandbyNodeList = JoinV2.getSortedStandbyJoinRequests()
  const result = list.map((node) => ({
    pubKey: node.nodeInfo.publicKey,
    //ip: node.nodeInfo.externalIp,
    port: node.nodeInfo.externalPort,
  }))
  console.log(`Standby list:${list.length} `, message, stringifyReduce(result))
}

/**
 * Handles unjoining from the network.
 */
export async function shutdown(): Promise<void> {
  // if not using join protocol v2, unjoining isn't needed
  if (!config.p2p.useJoinProtocolV2) return

  const unjoinResult = await ResultAsync.fromPromise(
    attempt(async () => submitUnjoin(), {
      delay: 1000,
      maxRetries: 5,
    }),
    (err) => err as Error
  ).andThen((result) => result)

  // reset acceptance state
  resetAcceptance()

  if (unjoinResult.isErr()) {
    console.error('Failed send unjoin request:', unjoinResult.error)
  } else {
    if (logFlags.verbose) console.log('Unjoin request sent')
  }
}
