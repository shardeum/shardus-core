import { getRandomAvailableArchiver, getActiveNodesFromArchiver } from '../../Utils'
import * as utils from '../../../utils'
import * as http from '../../../http'
import { ok, Result } from 'neverthrow'
import { logFlags } from '../../../logger'
import { JoinRequest, StandbyAddRequest } from '@shardus/types/build/src/p2p/JoinTypes'
import { isOnStandbyList } from './index'
import * as CycleChain from '../../CycleChain'
import { crypto } from '../../Context'
import { SignedObject } from '@shardus/types/build/src/p2p/P2PTypes'
import { config } from '../../Context'

type publickey = JoinRequest['nodeInfo']['publicKey']
let newStandbyAddRequests: Map<publickey, StandbyAddRequest> = new Map()

export async function submitStandbyAdd(joinRequest: JoinRequest): Promise<Result<void, Error>> {
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
          if (pickNodeAttempts === 0) throw Error('submitStandbyAdd: No active nodes to query');
          node = utils.getRandom(activeNodes.nodeList, 1)[0];
          pickNodeAttempts--
        } while(queriedNodesPKs.includes(node.publicKey));
        queriedNodesPKs.push(node.publicKey);

        await http.post(`${node.ip}:${node.port}/standby-add`, JSON.parse(utils.cryptoStringify(joinRequest)))
        return ok(void 0)
      } catch (e) {
        console.error(`Attempt ${attempts + 1} failed: ${e}`);
        attempts++;
        utils.sleep(config.p2p.resubmitStandbyAddWaitDuration); // Sleep for 1 second before retrying
      }
    }

    // If the code reaches this point, all retries have failed
    throw Error('All attempts to post standbyAdd request failed');
  } catch (e) {
    // This catch block will handle errors from getActiveNodesFromArchiver and if all retries fail
    throw Error(`submitStandbyAdd: Error posting standbyAdd request: ${e}`);
  }
}

export interface StandbyAddRequestResponse {
  success: boolean
  reason: string
  fatal: boolean
}

export function addStandbyAdd(standbyAddRequest: StandbyAddRequest): StandbyAddRequestResponse {
  // validate keepInStandbyRequest
  if (isOnStandbyList(standbyAddRequest.joinRequest.nodeInfo.publicKey)) {
    return {
      success: false,
      reason: 'Node already in standby list',
      fatal: false,
    }
  }

  // cycle number check
  const cycleNumber = CycleChain.getNewest().counter
  if (cycleNumber !== standbyAddRequest.cycleNumber) {
    return {
      success: false,
      reason: 'cycle number in StandbyAddRequest request does not match current cycle number',
      fatal: false,
    }
  }

  //add it to TXs
  if (newStandbyAddRequests.has(standbyAddRequest.joinRequest.nodeInfo.publicKey) === true) {
    return {
      success: false,
      reason: 'Node already in standby add list',
      fatal: false,
    }
  }

  if (!crypto.verify(standbyAddRequest as unknown as SignedObject, standbyAddRequest.sign.owner)) {
    return {
      success: false,
      reason: 'verification of syncStarted request failed',
      fatal: false,
    }
  }

  newStandbyAddRequests.set(standbyAddRequest.joinRequest.nodeInfo.publicKey, standbyAddRequest)

  return {
    success: true,
    reason: 'standbyAddRequest passed all checks and verification',
    fatal: false,
  }
}

/**
 * Returns the list of new StandbyAddRequest requests and empties the list.
 */

export function drainNewStandbyAddRequests(): StandbyAddRequest[] {
  if (logFlags.verbose) console.log('draining new StandbyAddRequest info:', newStandbyAddRequests)
  const current = Array.from(newStandbyAddRequests.values())
  newStandbyAddRequests = new Map()
  return current
}
