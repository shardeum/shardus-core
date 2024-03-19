import { getRandomAvailableArchiver, getActiveNodesFromArchiver } from '../../Utils'
import * as utils from '../../../utils'
import * as http from '../../../http'
import { ok, Result } from 'neverthrow'
import { logFlags } from '../../../logger'
import { JoinRequest, StandbyRefreshRequest } from '@shardus/types/build/src/p2p/JoinTypes'
import { getStandbyNodesInfoMap } from './index'
import * as CycleChain from '../../CycleChain'
import { crypto } from '../../Context'
import { SignedObject } from '@shardus/types/build/src/p2p/P2PTypes'
import { config } from '../../Context'
import { P2P } from '@shardus/types'

type publickey = JoinRequest['nodeInfo']['publicKey']
let newStandbyRefreshRequests: Map<publickey, StandbyRefreshRequest> = new Map()

export async function submitStandbyRefresh(publicKey: string): Promise<Result<void, Error>> {
  const archiver = getRandomAvailableArchiver()
  try {
    const activeNodesResult = await getActiveNodesFromArchiver(archiver);
    if (activeNodesResult.isErr()) {
      throw Error(`couldn't get active nodes: ${activeNodesResult.error}`);
    }
    const activeNodes = activeNodesResult.value;
    const maxRetries = 3;
    let attempts = 0;
    const queriedNodesPKs = []

    while (attempts < maxRetries) {
      try {
        let node;
        let pickNodeAttempts = 5
        do {
          if (pickNodeAttempts === 0) throw Error('submitStandbyRefresh: No active nodes to query');
          node = utils.getRandom(activeNodes.nodeList, 1)[0];
          pickNodeAttempts--
        } while(queriedNodesPKs.includes(node.publicKey));
        queriedNodesPKs.push(node.publicKey);

        await http.post(`${node.ip}:${node.port}/standby-refresh`, { publicKey })
        return ok(void 0)
      } catch (e) {
        console.error(`Attempt ${attempts + 1} failed: ${e}`);
        attempts++;
        utils.sleep(config.p2p.resumbitStandbyRefreshWaitDuration); // Sleep for 1 second before retrying
      }
    }

    // If the code reaches this point, all retries have failed
    throw Error('All attempts to post standbyRefresh request failed');
  } catch (e) {
    // This catch block will handle errors from getActiveNodesFromArchiver and if all retries fail
    throw Error(`submitStandbyRefresh: Error posting standbyRefresh request: ${e}`);
  }
}

export interface StandbyRefreshRequestResponse {
  success: boolean
  reason: string
  fatal: boolean
}

export function addStandbyRefresh(keepInStandbyRequest: StandbyRefreshRequest): StandbyRefreshRequestResponse {
  // validate keepInStandbyRequest
  if (!getStandbyNodesInfoMap().has(keepInStandbyRequest.publicKey)) {
    return {
      success: false,
      reason: 'Node not found in standby list',
      fatal: false,
    }
  }

  // cycle number check
  const cycleNumber = CycleChain.getNewest().counter
  if (cycleNumber !== keepInStandbyRequest.cycleNumber) {
    return {
      success: false,
      reason: 'cycle number in StandbyRefreshRequest request does not match current cycle number',
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
 * Returns the list of new StandbyRefreshRequest requests and empties the list.
 */

export function drainNewStandbyRefreshRequests(): StandbyRefreshRequest[] {
  if (logFlags.verbose) console.log('draining new StandbyRefreshRequest info:', newStandbyRefreshRequests)
  const tmp = Array.from(newStandbyRefreshRequests.values())
  newStandbyRefreshRequests = new Map()
  return tmp
}
