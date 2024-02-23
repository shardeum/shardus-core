import { getRandomAvailableArchiver, getActiveNodesFromArchiver } from '../../Utils'
import * as utils from '../../../utils'
import * as http from '../../../http'
import { ok, Result } from 'neverthrow'
import { logFlags } from '../../../logger'
import { JoinRequest, KeepInStandby } from '@shardus/types/build/src/p2p/JoinTypes'
import { getStandbyNodesInfoMap } from './index'
import * as CycleChain from '../../CycleChain'
import { crypto } from '../../Context'
import { SignedObject } from '@shardus/types/build/src/p2p/P2PTypes'
import rfdc from 'rfdc'

//const clone = rfdc()

type publickey = JoinRequest['nodeInfo']['publicKey']
let newStandbyRefreshRequests: Map<publickey, KeepInStandby> = new Map()
//let lastCycleStandbyRefreshRequests: Map<publickey, KeepInStandby> = new Map()

export async function submitStandbyRefresh(publicKey: string, cycleNumber: number): Promise<Result<void, Error>> {
  const archiver = getRandomAvailableArchiver()
  try {
    const activeNodesResult = await getActiveNodesFromArchiver(archiver)
    if (activeNodesResult.isErr()) {
      throw Error(`couldn't get active nodes: ${activeNodesResult.error}`)
    }
    const activeNodes = activeNodesResult.value
    const node = utils.getRandom(activeNodes.nodeList, 1)[0]

    let payload = {
      publicKey: publicKey,
      cycleNumber: cycleNumber
    }
    payload = crypto.sign(payload)

    await http.post(`${node.ip}:${node.port}/standby-refresh`, payload)
    return ok(void 0)
  } catch (e) {
    throw Error(`submitStandbyRefresh: Error posting standbyRefresh request: ${e}`)
  }
}

//KeepInStandby
export interface StandbyRefreshRequestResponse {
  success: boolean
  reason: string
  fatal: boolean
}

export function addStandbyRefresh(keepInStandbyRequest: KeepInStandby): StandbyRefreshRequestResponse {
  // validate keepInStandbyRequest
  if (getStandbyNodesInfoMap().has(keepInStandbyRequest.publicKey) === false) {
    return {
      success: false,
      reason: 'Node not found in standby list',
      fatal: true,
    }
  }

  // cycle number check
  const cycleNumber = CycleChain.getNewest().counter
  if (cycleNumber !== keepInStandbyRequest.cycleNumber) {
    return {
      success: false,
      reason: 'cycle number in keepInStandby request does not match current cycle number',
      fatal: false,
    }
  }

  //add it to TXs
  if (newStandbyRefreshRequests.has(keepInStandbyRequest.publicKey) === true) {
    return {
      success: false,
      reason: 'Node already in standby refresh list',
      fatal: false,
    }
  }

  if (!crypto.verify(keepInStandbyRequest as unknown as SignedObject, keepInStandbyRequest.sign.owner)) {
    return {
      success: false,
      reason: 'verification of syncStarted request failed',
      fatal: false,
    }
  }

  newStandbyRefreshRequests.set(keepInStandbyRequest.publicKey, keepInStandbyRequest)

  return {
    success: true,
    reason: 'keepInStandbyRequest passed all checks and verification',
    fatal: false,
  }
}

/**
 * Returns the list of new KeepInStandby requests and empties the list.
 */

export function drainNewStandbyRefreshRequests(): KeepInStandby[] {
  if (logFlags.verbose) console.log('draining new KeepInStandby info:', newStandbyRefreshRequests)
  //lastCycleStandbyRefreshRequests = deepCloneMap(newStandbyRefreshRequests)
  const tmp = Array.from(newStandbyRefreshRequests.values())
  newStandbyRefreshRequests = new Map()
  return tmp
}

/*
export function getLastCycleStandbyRefreshRequest(publicKey: publickey): KeepInStandby {
  return lastCycleStandbyRefreshRequests.get(publicKey)
}

export function resetLastCycleStandbyRefreshRequests(): void {
  lastCycleStandbyRefreshRequests = new Map()
}

function deepCloneMap(originalMap: Map<any, any>): Map<any, any> {
  const clonedMap = new Map();
  originalMap.forEach((value, key) => {
    const clonedKey = clone(key); // Clone the key
    const clonedValue = clone(value); // Clone the value
    clonedMap.set(clonedKey, clonedValue);
  });
  return clonedMap;
}
*/
