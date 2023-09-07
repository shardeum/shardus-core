import { hexstring, P2P } from "@shardus/types";
import { ok } from "neverthrow";
import { EventEmitter } from "events";
import { Result } from "neverthrow";
import * as http from '../../../http'
import { getRandom } from "../../../utils";
import { crypto } from "../../Context";
import { JoinedConsensor } from "@shardus/types/build/src/p2p/JoinTypes";

let activeNodes: P2P.P2PTypes.Node[] = []
export function provideActiveNodes(nodes: P2P.P2PTypes.Node[]): void {
  activeNodes = nodes
}

const eventEmitter = new EventEmitter()
export function getEventEmitter(): EventEmitter {
  return eventEmitter
}

export async function confirmAcceptance(onCycleMarker: hexstring): Promise<Result<boolean, Error>> {
  // we need to query for the cycle record from a node to confirm that we were,
  // in fact, accepted during the cycle
  const randomNode = getRandom(activeNodes, 1)[0]

  let cycle: P2P.CycleCreatorTypes.CycleRecord
  try {
    cycle = await getCycleFromNode(randomNode, onCycleMarker)
  } catch (err) {
    return err(new Error(`error getting cycle from node ${randomNode.ip}:${randomNode.port}: ${err}`))
  }

  const ourPublicKey = crypto.getPublicKey()
  const included = cycle.joinedConsensors.some((joinedConsensor: JoinedConsensor) => joinedConsensor.publicKey === ourPublicKey)
  return ok(included)
}

async function getCycleFromNode(node: P2P.P2PTypes.Node, cycleMarker: hexstring): Promise<P2P.CycleCreatorTypes.CycleRecord> {
  const url = `http://${node.ip}:${node.port}/cycle-by-marker?marker=${cycleMarker}`
  const cycle: P2P.CycleCreatorTypes.CycleRecord =
    await http.get(url)

  return cycle
}
