import * as NodeList from '../../NodeList'
import { FinishedSyncingRequest, JoinRequest } from '@shardus/types/build/src/p2p/JoinTypes'
import { SignedObject } from '@shardus/crypto-utils'
import * as CycleChain from '../../CycleChain'
import { crypto } from '../../Context'
import { nestedCountersInstance } from '../../../utils/nestedCounters'
import { config } from '../../Context'
import { P2P } from '@shardus/types'
import { logFlags } from '../../../logger'
import { isFirst } from '../../Self'

//** List of synced nodes */
export let newSyncFinishedNodes: Map<string, FinishedSyncingRequest> = new Map()

export interface FinishedSyncingRequestResponse {
  success: boolean
  reason: string
  fatal: boolean
}

/**
 * Adds nodes to the local state synced node list.
 */
export function addFinishedSyncing(
  finishedSyncRequest: FinishedSyncingRequest
): FinishedSyncingRequestResponse {
  const node = NodeList.byIdOrder.find((node) => node.id === finishedSyncRequest.nodeId)
  // validate
  // lookup node by id in payload and use pubkey and compare to sig.owner
  const publicKeysMatch = (node?.publicKey || crypto.keypair.publicKey) === finishedSyncRequest.sign.owner
  if (!publicKeysMatch) {
    if (logFlags.verbose)
      console.log(
        `addFinishedSyncing(): public key in addFinishedSyncing does not match public key of node`,
        finishedSyncRequest.nodeId
      )
    /* prettier-ignore */ nestedCountersInstance.countEvent('syncFinished.ts', `addFinishedSyncing(): publicKeysMatch failed` )
    return {
      success: false,
      reason: 'public key in addFinishedSyncing does not match public key of node',
      fatal: false,
    }
  }

  // cycle number check
  const cycleNumber = CycleChain.getNewest().counter
  if (cycleNumber !== finishedSyncRequest.cycleNumber) {
    if (logFlags.console)
      console.log(
        `addFinishedSyncing(): cycleNumber in request does not match cycleNumber of node`,
        finishedSyncRequest.nodeId
      )
    /* prettier-ignore */ nestedCountersInstance.countEvent('syncFinished.ts', `addFinishedSyncing(): cycleNumber match failed` )
    return {
      success: false,
      reason: `cycleNumber in request does not match cycleNumber of node`,
      fatal: false,
    }
  }

  // return false if already in local list
  if (newSyncFinishedNodes.has(finishedSyncRequest.nodeId) === true) {
    if (logFlags.console)
      console.log(
        `addFinishedSyncing(): Node already in newSyncFinishedNodes list`,
        finishedSyncRequest.nodeId
      )
    /* prettier-ignore */ nestedCountersInstance.countEvent('syncFinished.ts', `addFinishedSyncing(): already in local list` )
    return {
      success: false,
      reason: `node has already submitted syncFinished request`,
      fatal: false,
    }
  }
  // return false if signature is invalid
  if (!crypto.verify(finishedSyncRequest as SignedObject, finishedSyncRequest.sign.owner)) {
    if (logFlags.console) console.log(`addFinishedSyncing(): signature invalid`, finishedSyncRequest.nodeId)
    /* prettier-ignore */ nestedCountersInstance.countEvent('syncFinished.ts', `addFinishedSyncing(): signature invalid` )
    return {
      success: false,
      reason: 'verification of syncFinished request failed',
      fatal: false,
    }
  }

  /* prettier-ignore */ if (logFlags.verbose) console.log(`addFinishedSyncing: ${finishedSyncRequest.nodeId} port:${node?.externalPort}`)
  newSyncFinishedNodes.set(finishedSyncRequest.nodeId, finishedSyncRequest)
  /* prettier-ignore */ nestedCountersInstance.countEvent('syncFinished.ts', `addFinishedSyncing(): success` )
  return {
    success: true,
    reason: `Node ${finishedSyncRequest.nodeId} added to syncFinishedNodesInfo map`,
    fatal: false,
  }
}

/**
 * Returns the list of new synced nodes info and empties the list.
 *
 * @returns SyncCompletedRequest[]
 */
export function drainFinishedSyncingRequest(): FinishedSyncingRequest[] {
  const tmp = Array.from(newSyncFinishedNodes.values());
  newSyncFinishedNodes = new Map<string, FinishedSyncingRequest>();
  return tmp;
}

/**
 * Determines if a node is among the first N nodes in the pre-sorted list `readyByTimeAndIdOrder` when in 'processing' mode,
 * or within the entire list in other modes. The list is sorted by `readyTimestamp`, with `ID` as a tiebreaker.
 *
 * @param nodeId The ID of the node to check.
 * @returns True if the node is among the first N ready nodes in 'processing' mode or in the entire list in other modes, false otherwise.
 */
export function isNodeSelectedReadyList(nodeId: string): boolean {
  const mode = CycleChain.getNewest().mode
  // Adjust the list based on the mode
  const listToCheck = mode === 'processing' 
    ? NodeList.readyByTimeAndIdOrder.slice(0, config.p2p.allowActivePerCycle)
    : NodeList.readyByTimeAndIdOrder;

  // Check if nodeId is in listToCheck
  return listToCheck.some((readyNode) => readyNode.id === nodeId)
}

export function selectNodesFromReadyList(mode: string): P2P.NodeListTypes.Node[] {
  if (mode === 'processing') {
    if (config.debug.readyNodeDelay > 0)
      return NodeList.readyByTimeAndIdOrder
        .slice(0, config.p2p.allowActivePerCycle)
        .filter((node) => CycleChain.newest.start >= node.readyTimestamp + config.debug.readyNodeDelay)

    return NodeList.readyByTimeAndIdOrder.slice(0, config.p2p.allowActivePerCycle)
  } else {
    if (mode === 'forming' && isFirst && NodeList.activeByIdOrder.length === 0) return NodeList.readyByTimeAndIdOrder
    
    if (config.debug.readyNodeDelay > 0)
      return NodeList.readyByTimeAndIdOrder.filter(
        (node) => CycleChain.newest.start >= node.readyTimestamp + config.debug.readyNodeDelay
      )

    return NodeList.readyByTimeAndIdOrder
  }
}
