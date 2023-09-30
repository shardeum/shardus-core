import { hexstring, P2P } from "@shardus/types";
import { err, ok } from "neverthrow";
import { EventEmitter } from "events";
import { Result } from "neverthrow";
import * as http from '../../../http'
import { getRandom } from "../../../utils";
import { crypto } from "../../Context";
import { JoinedConsensor } from "@shardus/types/build/src/p2p/JoinTypes";
import { SignedObject } from "@shardus/types/build/src/p2p/P2PTypes";
import { getActiveNodesFromArchiver, getRandomAvailableArchiver } from "../../Utils";

let alreadyCheckingAcceptance = false

/**
  * A simple object that tells a joining node which cycle marker it has been
  * supposedly accepted on. AcceptanceOffers should be signed by active nodes
  * to verify their origin.
  */
export interface AcceptanceOffer {
  cycleMarker: hexstring
  activeNodePublicKey: hexstring
}

const eventEmitter = new EventEmitter()
export function getEventEmitter(): EventEmitter {
  return eventEmitter
}

export async function confirmAcceptance(offer: SignedObject<AcceptanceOffer>): Promise<Result<boolean, Error>> {
  // ensure we're not already checking acceptance
  if (alreadyCheckingAcceptance) {
    return err(new Error('already checking acceptance'))
  }
  alreadyCheckingAcceptance = true

  // ensure we even have nodes to check from
  const archiver = getRandomAvailableArchiver()
  const activeNodesResult = await getActiveNodesFromArchiver(archiver)
  if (activeNodesResult.isErr()) {
    return err(new Error(`couldn't get active nodes: ${activeNodesResult.error}`))
  }
  const activeNodes = activeNodesResult.value.nodeList
  if (activeNodes.length === 0) {
    // disable this flag since we're returning
    alreadyCheckingAcceptance = false
    return err(new Error('no active nodes provided'))
  }

  // verify the signature of the offer
  if (!crypto.verify(offer, offer.activeNodePublicKey)) {
    // disable this flag since we're returning
    alreadyCheckingAcceptance = false
    return err(new Error('acceptance offer signature invalid'))
  }

  // now, we need to query for the cycle record from a node to confirm that we were,
  // in fact, accepted during the cycle
  const randomNode = getRandom(activeNodes, 1)[0]

  let cycle: P2P.CycleCreatorTypes.CycleRecord
  try {
    cycle = await getCycleFromNode(randomNode, offer.cycleMarker)
  } catch (e) {
    // disable this flag since we're returning
    alreadyCheckingAcceptance = false
    return err(new Error(`error getting cycle from node ${randomNode.ip}:${randomNode.port}: ${e}`))
  }

  // check to see that we were included in the cycle
  const ourPublicKey = crypto.getPublicKey()
  const included = cycle.joinedConsensors.some((joinedConsensor: JoinedConsensor) => joinedConsensor.publicKey === ourPublicKey)

  // disable this flag since we're done
  alreadyCheckingAcceptance = false

  return ok(included)
}

async function getCycleFromNode(node: P2P.P2PTypes.Node, cycleMarker: hexstring): Promise<P2P.CycleCreatorTypes.CycleRecord> {
  const url = `http://${node.ip}:${node.port}/cycle-by-marker?marker=${cycleMarker}`
  const cycle: P2P.CycleCreatorTypes.CycleRecord =
    await http.get(url)

  return cycle
}
