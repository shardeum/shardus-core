import { publicKey } from '@shardus/types'
import { CycleMarker } from '@shardus/types/build/src/p2p/CycleCreatorTypes'
import {
  ArchiverDownMsg,
  ArchiverUpMsg,
  InvestigateArchiverMsg,
} from '@shardus/types/build/src/p2p/LostArchiverTypes'
import { Node } from '@shardus/types/build/src/p2p/NodeListTypes'
import { SignedObject } from '@shardus/types/build/src/p2p/P2PTypes'
import * as http from '../../http'

/** Lost Archivers Functions */

/**
 * Marks an Archiver as lost in our internal map.
 * This function gets called anytime communication with an Archiver breaks down
 */
export function reportLostArchiver(publicKey: publicKey, errorMsg: string): void {
  // Add new entry to lostArchiversMap for reported Archiver
  // Set status to 'reported'
  // If entry exists, do nothing
}

export function investigateArchiver(publicKey: publicKey): void {
  // If no entry exists in lostArchiversMap for target Archiver
  //   create new entry
  //   set isInvestigator to true
  //   set status = 'investigating'
  // Else if entry exists
  //   return
  // Asynchronously ping the archiver to investigate it
  //  if it comes back as reachable
  //    delete target from map and return
  //  if it is unreachable
  //    set status = 'down'
}

export function reportArchiverUp(publicKey: publicKey): void {
  // After an Archiver tells us its still up
  // We need to gossip the up message to the rest of the network
}

/**
 * Returns true if the archiver can be pinged.
 */
async function pingArchiver(host: string, port: number): Promise<boolean> {
  // the /nodeInfo endpoint is used to ping the archiver because it's cheap
  return (await getArchiverInfo(host, port)) !== null
}

/**
 * Returns the JSON object from the archiver's nodeInfo endpoint, or null if the archiver is not reachable.
 * Keys include publicKey, ip, port, version and time.
 */
async function getArchiverInfo(host: string, port: number): Promise<object> | null {
  /*
  Example:
    {
      "publicKey": "840e7b59a95d3c5f5044f4bc62ab9fa94bc107d391001141410983502e3cde63",
      "ip": "45.79.43.36",
      "port": 4000,
      "version": "3.3.8",
      "time": 1697852551464
    }
  */
  try {
    return await http.get<object>(`http://${host}:${port}/nodeInfo`)
  } catch (e) {
    return null
  }
}

/**
 * Picks an investigator node for lost archiver detection
 * @param record record in from the lostArchiverRecordMap
 * @returns The node ID of the investigator for that specific record
 */
export function getInvestigator(target: publicKey, marker: CycleMarker): Node {
  // hash target + marker
  // return node from Nodelist with id closest to hash
  return
}

export function informInvestigator(target: publicKey): void {
  // Create InvestigateArchiverMsg and send it to the lostArchiverInvestigate route
}

export function tellNetworkArchiverIsDown(target: publicKey): void {
  // Create ArchiverDownMsg and gossip it on the lostArchiverDownGossip route
}

export function errorForArchiverDownMsg(msg: SignedObject<ArchiverDownMsg>): null | string {
  return null
}

export function errorForArchiverUpMsg(msg: SignedObject<ArchiverUpMsg>): null | string {
  return null
}

export function errorForInvestigateArchiverMsg(msg: SignedObject<InvestigateArchiverMsg>): null | string {
  return null
}
