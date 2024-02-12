import { logFlags } from '../../../logger'
import * as NodeList from '../../NodeList'
import { SyncStarted } from '@shardus/types/build/src/p2p/JoinTypes'
import { SignedObject } from '@shardus/types/build/src/p2p/P2PTypes'
import * as CycleChain from '../../CycleChain'
import { crypto } from '../../Context'
// import * as utils from '../../../utils'
// import { getRandomAvailableArchiver, getActiveNodesFromArchiver } from '../../Utils'
//import * as http from '../../../http'
import { currentQuarter } from '../../CycleCreator'
// import { ok, Result } from 'neverthrow'

export const nodesYetToStartSyncing: Map<string, number> = new Map()
export let lostAfterSelection: string[] = []
let newSyncStarted: string[] = []

export interface SyncStartedRequestResponse {
  success: boolean
  reason: string
  fatal: boolean
}

/*
Currently not used

export async function submitSyncStarted(payload: SyncStarted): Promise<Result<void, Error>> {
  const archiver = getRandomAvailableArchiver()
  try {
    const activeNodesResult = await getActiveNodesFromArchiver(archiver)
    if (activeNodesResult.isErr()) {
      throw Error(`couldn't get active nodes: ${activeNodesResult.error}`)
    }
    const activeNodes = activeNodesResult.value
    const node = utils.getRandom(activeNodes.nodeList, 1)[0]
    await http.post(`${node.ip}:${node.port}/sync-started`, payload)
    return ok(void 0)
  } catch (e) {
    throw Error(`submitSyncStarted: Error posting syncStarted request: ${e}`)
  }
}
*/

export function insertSyncStarted(nodeId: string): void {
  newSyncStarted.push(nodeId)
}

export function addSyncStarted(syncStarted: SyncStarted): SyncStartedRequestResponse {
  // lookup node by id in payload and use pubkey and compare to sig.owner
  const publicKeysMatch = ((NodeList.byIdOrder.find((node) => node.id === syncStarted.nodeId))?.publicKey) === syncStarted.sign.owner
  if (!publicKeysMatch) {
    return {
      success: false,
      reason: 'public key in syncStarted request does not match public key of node',
      fatal: false,
    }
  }
  // cycle number check
  const cycleNumber = CycleChain.getNewest().counter
  if (cycleNumber !== syncStarted.cycleNumber) {
    return {
      success: false,
      reason: 'cycle number in syncStarted request does not match current cycle number',
      fatal: false,
    }
  }

  // return false if already in map
  if (newSyncStarted.includes(syncStarted.nodeId) === true) {
    return {
      success: false,
      reason: 'node has already submitted syncStarted request',
      fatal: false,
    }
  }

  if (!crypto.verify(syncStarted as unknown as SignedObject, syncStarted.sign.owner)) {
    return {
      success: false,
      reason: 'verification of syncStarted request failed',
      fatal: false,
    }
  }

  insertSyncStarted(syncStarted.nodeId)

  return {
    success: true,
    reason: 'passed all checks and verification',
    fatal: false,
  }
}


/**
 * Returns the list of nodeIds of nodes that started syncing empties the map.
 */
export function drainSyncStarted(): string[] {
  if (currentQuarter === 3) {
    if (logFlags.verbose) console.log('draining new KeepInStandby info:', newSyncStarted)
    const tmp = newSyncStarted
    newSyncStarted = []
    return tmp.sort()
  } else {
    return []
  }
}

export function drainLostAfterSelectionNodes(): string[] {
  if (currentQuarter === 3) {
    if (logFlags.verbose) console.log('draining lost after selection nodes:', lostAfterSelection)
    const tmp = lostAfterSelection
    lostAfterSelection = []
    return tmp.sort()
  } else {
    return []
  }
}
