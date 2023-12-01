import { publicKey } from '@shardus/types'
import { CycleMarker } from '@shardus/types/build/src/p2p/CycleCreatorTypes'
import {
  ArchiverDownMsg,
  ArchiverUpMsg,
  InvestigateArchiverMsg,
} from '@shardus/types/build/src/p2p/LostArchiverTypes'
import { Node } from '@shardus/types/build/src/p2p/NodeListTypes'
import { SignedObject } from '@shardus/types/build/src/p2p/P2PTypes'
import { info } from 'console'
import * as http from '../../http'
import * as CycleChain from '../../p2p/CycleChain'
import * as Archivers from '../Archivers'
import * as Comms from '../Comms'
import * as Context from '../Context'
import * as NodeList from '../NodeList'
import { lostArchiversMap } from './state'
import { config } from 'process'

/** Lost Archivers Functions */

function stringify(obj: object): string {
  return JSON.stringify(obj, null, 2)
}

/**
 * Marks an Archiver as lost in our internal map.
 * This function gets called anytime communication with an Archiver breaks down
 * @param publicKey - The public key of the lost Archiver
 * @param errorMsg - The error message received when communication broke down
 * Called by Archivers.ts
 */
export function reportLostArchiver(publicKey: publicKey, errorMsg: string): void {
  info(`reportLostArchiver: publicKey: ${publicKey}, errorMsg: ${errorMsg}`)
  // Add new entry to lostArchiversMap for reported Archiver if it doesnt exist
  // This is to ensure that we don't overwrite existing entries
  if (lostArchiversMap.has(publicKey)) {
    info('reportLostArchiver: already have LostArchiverRecord')
  } else {
    info('reportLostArchiver: adding new LostArchiverRecord')
    // Set status to 'reported'
    // This status indicates that the Archiver has been reported as lost, but not yet investigated
    lostArchiversMap.set(publicKey, {
      isInvestigator: false,
      gossipped: false,
      target: publicKey,
      status: 'reported',
      cyclesToWait: Context.config.p2p.lostArchiversCyclesToWait,
    })
  }
  // don't gossip here; that is initiated in sendRequests()
}

/**
 * Investigates a reported lost Archiver.
 * This function gets called to verify if an Archiver is indeed lost
 * @param publicKey - The public key of the Archiver to investigate
 */
export async function investigateArchiver(publicKey: publicKey): Promise<void> {
  // Retrieve the record of the Archiver from the lostArchiversMap
  info(`investigateArchiver: publicKey: ${publicKey}`)
  let record = lostArchiversMap.get(publicKey)
  if (record) {
    info('investigateArchiver: already have LostArchiverRecord')
    // already investigated
    return
  }
  // starting investigation
  record = {
    isInvestigator: true,
    gossipped: false,
    target: publicKey,
    status: 'investigating',
    cyclesToWait: Context.config.p2p.lostArchiversCyclesToWait,
  }
  // record it
  lostArchiversMap.set(publicKey, record)
  // ping the archiver
  const archiver = Archivers.archivers.get(publicKey)
  const isReachable = await pingArchiver(archiver.ip, archiver.port)
  // handle the result
  if (isReachable) {
    lostArchiversMap.delete(publicKey)
  } else {
    record.status = 'down'
  }
  // don't gossip here; that is initiated in sendRequests()
}

/**
 * Reports an Archiver as up.
 * This function gets called when an Archiver that was previously marked as down is now reachable
 * @param publicKey - The public key of the Archiver that is now up
 */
export function reportArchiverUp(publicKey: publicKey): void {
  // Retrieve the record of the Archiver from the lostArchiversMap
  const record = lostArchiversMap.get(publicKey)
  // If the record exists and the status of the Archiver is 'down', mark it as 'up'
  // This is to ensure that we only update the status of Archivers that were previously marked as down
  if (record && record.status === 'down') {
    record.status = 'up'
    // TODO: Implement gossiping the up message to the rest of the network
    // This is to inform the rest of the network that the Archiver is now up
  }
}

/**
 * Picks an investigator node for lost archiver detection
 * @param record record in from the lostArchiverRecordMap
 * @returns The node ID of the investigator for that specific record
 */
export function getInvestigator(target: publicKey, marker: CycleMarker): Node {
  // TODO: Implement hashing target + marker and returning node from Nodelist with id closest to hash
  // This is to ensure that the investigator node is chosen in a deterministic manner
  return null
}

/**
 * Informs the investigator node that an Archiver is lost
 * @param target - The public key of the lost Archiver
 */
export function informInvestigator(target: publicKey): void {
  // TODO: Create InvestigateArchiverMsg and send it to the lostArchiverInvestigate route
  // This is to initiate the investigation process
}

/**
 * Tells the network that an Archiver is down
 * @param archiverKey - The public key of the down Archiver
 */
export function tellNetworkArchiverIsDown(archiverKey: publicKey): void {
  info(`tellNetworkArchiverIsDown: archiverKey: ${archiverKey}`)
  const downMsg: ArchiverDownMsg = {
    type: 'down',
    cycle: CycleChain.getCurrentCycleMarker(),
    investigateTx: {
      type: 'investigate',
      target: archiverKey,
      investigator: Context.crypto.getPublicKey(),
      sender: Context.crypto.getPublicKey(),
      cycle: CycleChain.getCurrentCycleMarker(),
    },
  }
  info(`tellNetworkArchiverIsDown: downMsg: ${stringify(downMsg)}`)
  Comms.sendGossip('lost-archiver-down', downMsg, '', null, NodeList.byIdOrder, /* isOrigin */ true)
  // This is to inform the rest of the network that the Archiver is down
}

/**
 * Returns true if the archiver can be pinged.
 * This function is used to check if an Archiver is reachable
 * @param host - The host of the Archiver
 * @param port - The port of the Archiver
 * @returns A promise that resolves to true if the Archiver is reachable, and false otherwise
 */
async function pingArchiver(host: string, port: number): Promise<boolean> {
  // The Archiver is considered reachable if we can get its info
  return (await getArchiverInfo(host, port)) !== null
}

/**
 * Returns the JSON object from the archiver's nodeInfo endpoint, or null if the archiver is not reachable.
 * Keys include publicKey, ip, port, version and time.
 * This function is used to get the info of an Archiver
 * @param host - The host of the Archiver
 * @param port - The port of the Archiver
 * @returns A promise that resolves to the info of the Archiver if it is reachable, and null otherwise
 */
async function getArchiverInfo(host: string, port: number): Promise<object> | null {
  try {
    // Try to get the info of the Archiver
    return await http.get<object>(`http://${host}:${port}/nodeInfo`)
  } catch (e) {
    // If an error occurs (e.g., the Archiver is not reachable), return null
    return null
  }
}

/**
 * Checks for errors in an ArchiverDownMsg
 * @param msg - The ArchiverDownMsg to check
 * @returns null if there are no errors, and a string describing the error otherwise
 */
export function errorForArchiverDownMsg(msg: SignedObject<ArchiverDownMsg> | null): string | null {
  if (msg == null) return 'null message'
  if (msg.sign == null) return 'no signature'
  // TODO: Implement error checking for ArchiverDownMsg
  // This is to ensure that the message is valid
  return null
}

/**
 * Checks for errors in an ArchiverUpMsg
 * @param msg - The ArchiverUpMsg to check
 * @returns null if there are no errors, and a string describing the error otherwise
 */
export function errorForArchiverUpMsg(msg: SignedObject<ArchiverUpMsg> | null): string | null {
  if (msg == null) return 'null message'
  if (msg.sign == null) return 'no signature'
  // TODO: Implement error checking for ArchiverUpMsg
  // This is to ensure that the message is valid
  return null
}

/**
 * Checks for errors in an InvestigateArchiverMsg
 * @param msg - The InvestigateArchiverMsg to check
 * @returns null if there are no errors, and a string describing the error otherwise
 */
export function errorForInvestigateArchiverMsg(
  msg: SignedObject<InvestigateArchiverMsg> | null
): string | null {
  if (msg == null) return 'null message'
  if (msg.sign == null) return 'no signature'
  // TODO: Implement error checking for InvestigateArchiverMsg
  // This is to ensure that the message is valid
  return null
}
