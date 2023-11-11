import { SignedObject } from '@shardus/types/build/src/p2p/P2PTypes'
import { crypto } from '../../Context'
import { err, ok, Result } from 'neverthrow'
import { hexstring } from '@shardus/types'
import * as utils from '../../../utils'
import * as http from '../../../http'
import * as NodeList from '../../NodeList'
import { getStandbyNodesInfoMap } from '.'
import { getActiveNodesFromArchiver, getRandomAvailableArchiver } from '../../Utils'

/**
 * A request to leave the network's standby node list.
 */
export type UnjoinRequest = SignedObject<{
  publicKey: hexstring
}>

/** A Set of new public keys of nodes that have submitted unjoin requests. */
const newUnjoinRequests: Set<hexstring> = new Set()

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
    const node = utils.getRandom(activeNodes.nodeList, 1)[0]
    await http.post(`${node.ip}:${node.port}/unjoin`, unjoinRequest)
    return ok(void 0)
  } catch (e) {
    return err(new Error(`submitUnjoin: Error posting unjoin request: ${e}`))
  }
}

/**
 * Process a new unjoin request, adding it to the set of new unjoin requests
 * that will be recorded in the next cycle.
 *
 * Returns with an error if the unjoin request is invalid.
 */
export function processNewUnjoinRequest(unjoinRequest: UnjoinRequest): Result<void, Error> {
  console.log('processing unjoin request for', unjoinRequest.publicKey)

  // validate the unjoin request and then add it if it is valid
  return validateUnjoinRequest(unjoinRequest).map(() => {
    newUnjoinRequests.add(unjoinRequest.publicKey)
  })
}

/**
 * Validates an unjoin request by its signature.
 */
export function validateUnjoinRequest(unjoinRequest: UnjoinRequest): Result<void, Error> {
  // ignore if the unjoin request already exists
  if (newUnjoinRequests.has(unjoinRequest.publicKey)) {
    return err(new Error(`unjoin request from ${unjoinRequest.publicKey} already exists`))
  }

  // ignore if the unjoin request is from a node that is active
  const foundInActiveNodes = NodeList.byPubKey.has(unjoinRequest.publicKey)
  if (foundInActiveNodes) {
    return err(
      new Error(`unjoin request from ${unjoinRequest.publicKey} is from an active node that can't unjoin`)
    )
  }

  // ignore if the unjoin request is from a node that is not in standby
  const foundInStandbyNodes = getStandbyNodesInfoMap().has(unjoinRequest.publicKey)
  if (!foundInStandbyNodes) {
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

export function drainNewUnjoinRequests(): hexstring[] {
  const drained = [...newUnjoinRequests.values()]
  newUnjoinRequests.clear()
  return drained
}

export function deleteStandbyNode(publicKey: hexstring): void {
  if (getStandbyNodesInfoMap().delete(publicKey)) {
    console.log(`--removed standby node ${publicKey} count: ${getStandbyNodesInfoMap().size}`)
  } else {
    console.log(`--failed to remove standby node ${publicKey} count: ${getStandbyNodesInfoMap().size}`)
  }
}
