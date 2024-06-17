import { crypto } from '../../Context'
import { err, ok, Result } from 'neverthrow'
import { hexstring } from '@shardus/types'
import * as utils from '../../../utils'
import * as http from '../../../http'
import * as NodeList from '../../NodeList'
import { deleteStandbyNodeFromMap, getStandbyNodesInfoMap } from '.'
import { getActiveNodesFromArchiver, getRandomAvailableArchiver } from '../../Utils'
import { logFlags } from '../../../logger'
import * as CycleChain from '../../CycleChain'
import { SignedUnjoinRequest } from '@shardus/types/build/src/p2p/JoinTypes'

/** A Set of new public keys of nodes that have submitted unjoin requests. */
const newUnjoinRequests: Set<SignedUnjoinRequest> = new Set()

/**
 * Submits a request to leave the network's standby node list.
 */
export async function submitUnjoin(): Promise<Result<void, Error>> {
  const unjoinRequest = crypto.sign({
    publicKey: crypto.keypair.publicKey,
  })

  const archiver = getRandomAvailableArchiver()
  try {
    const activeNodesResult = await getActiveNodesFromArchiver(archiver)
    if (activeNodesResult.isErr()) {
      return err(new Error(`couldn't get active nodes: ${activeNodesResult.error}`))
    }
    const activeNodes = activeNodesResult.value
    // If we submit to a node that is about to be rotated out, then that node will queue our request for the next cycle
    // but will not send it since it will be removed from the network. Since we are a standby node, we dont have access
    // to the potentiallyRemoved list, so I dont think there's an easy solution to this. We need to think if this is even
    // worth solving. In a live network with a 1000 nodes, the chances of this happening are 1/1000. having 0.1% of standby
    // not being properly removed isn't that big a deal. Standby refresh will take care of them anyways.
    // If we really want to solve this, can do so by sending request to numRotatedOut + 1 nodes.
    const node = utils.getRandom(activeNodes.nodeList, 1)[0]
    await http.post(`${node.ip}:${node.port}/unjoin`, unjoinRequest)
    return ok(void 0)
  } catch (e) {
    throw new Error(`submitUnjoin: Error posting unjoin request: ${e}`)
  }
}

/**
 * Process a new unjoin request, adding it to the set of new unjoin requests
 * that will be recorded in the next cycle.
 *
 * Returns with an error if the unjoin request is invalid.
 */
export function processNewUnjoinRequest(unjoinRequest: SignedUnjoinRequest): Result<void, Error> {
  console.log('processing unjoin request for', unjoinRequest.publicKey)

  // validate the unjoin request and then add it if it is valid
  return validateUnjoinRequest(unjoinRequest).map(() => {
    newUnjoinRequests.add(unjoinRequest)
  })
}

/**
 * Validates an unjoin request by its signature.
 */
export function validateUnjoinRequest(unjoinRequest: SignedUnjoinRequest): Result<void, Error> {
  // ignore if the unjoin request already exists
  if (newUnjoinRequests.has(unjoinRequest)) {
    return err(new Error(`unjoin request from ${unjoinRequest.publicKey} already exists`))
  }

  const wasSelectedLastCycle = CycleChain.newest.joinedConsensors.find(
    (node) => node.publicKey === unjoinRequest.publicKey
  )
    ? true
    : false

  // ignore if the unjoin request is from a node that is active
  // only exception is if it was selected last cycle
  const foundInActiveNodes = NodeList.byPubKey.has(unjoinRequest.publicKey)
  if (foundInActiveNodes && wasSelectedLastCycle === false) {
    return err(
      new Error(`unjoin request from ${unjoinRequest.publicKey} is from an active node that can't unjoin`)
    )
  }

  // ignore if the unjoin request is from a node that is not in standby
  const foundInStandbyNodes = getStandbyNodesInfoMap().has(unjoinRequest.publicKey)
  if (!foundInStandbyNodes && wasSelectedLastCycle === false) {
    return err(
      new Error(
        `unjoin request from ${unjoinRequest.publicKey} is from a node not in standby (doesn't exist?)`
      )
    )
  }

  // lastly, verify the signature of the join request
  if (!crypto.verify(unjoinRequest, unjoinRequest.publicKey)) {
    return err(new Error('unjoin request signature is invalid'))
  }

  return ok(void 0)
}

export function drainNewUnjoinRequests(): SignedUnjoinRequest[] {
  const drained = [...newUnjoinRequests.values()]
  newUnjoinRequests.clear()
  return drained
}

export function deleteStandbyNode(publicKey: hexstring): void {
  if (deleteStandbyNodeFromMap(publicKey)) {
    /* prettier-ignore */ if (logFlags.verbose) console.log(`--removed standby node ${publicKey} count: ${getStandbyNodesInfoMap().size}`)
  } else {
    console.log(`--failed to remove standby node ${publicKey} count: ${getStandbyNodesInfoMap().size}`)
  }
}

export function removeUnjoinRequest(publicKey: hexstring): void {
  newUnjoinRequests.delete(publicKey)
}
