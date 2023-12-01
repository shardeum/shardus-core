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
import { lostArchiversMap } from './state'

/** Lost Archivers Functions */

/**
 * Marks an Archiver as lost in our internal map.
 * This function gets called anytime communication with an Archiver breaks down
 */
export function reportLostArchiver(publicKey: publicKey, errorMsg: string): void {
  if (!lostArchiversMap.has(publicKey)) {
    lostArchiversMap.set(publicKey, {
      isInvestigator: false,
      gossipped: false,
      target: publicKey,
      status: 'reported',
      cyclesToWait: 0,
    })
  }
}

export function investigateArchiver(publicKey: publicKey): void {
  let record = lostArchiversMap.get(publicKey)
  if (!record) {
    record = {
      isInvestigator: true,
      gossipped: false,
      target: publicKey,
      status: 'investigating',
      cyclesToWait: 0,
    }
    lostArchiversMap.set(publicKey, record)
  }

  // Need to get host and port from archiver public key
  /*
  pingArchiver(record.target, record.port).then((isReachable) => {
    if (isReachable) {
      lostArchiversMap.delete(publicKey)
    } else {
      record.status = 'down'
    }
  })
  */
}

export function reportArchiverUp(publicKey: publicKey): void {
  const record = lostArchiversMap.get(publicKey)
  if (record && record.status === 'down') {
    record.status = 'up'
    // TODO: Implement gossiping the up message to the rest of the network
  }
}

/**
 * Picks an investigator node for lost archiver detection
 * @param record record in from the lostArchiverRecordMap
 * @returns The node ID of the investigator for that specific record
 */
export function getInvestigator(target: publicKey, marker: CycleMarker): Node {
  // TODO: Implement hashing target + marker and returning node from Nodelist with id closest to hash
  return null
}

export function informInvestigator(target: publicKey): void {
  // TODO: Create InvestigateArchiverMsg and send it to the lostArchiverInvestigate route
}

export function tellNetworkArchiverIsDown(target: publicKey): void {
  // TODO: Create ArchiverDownMsg and gossip it on the lostArchiverDownGossip route
}

/**
 * Returns true if the archiver can be pinged.
 */
async function pingArchiver(host: string, port: number): Promise<boolean> {
  return (await getArchiverInfo(host, port)) !== null
}

/**
 * Returns the JSON object from the archiver's nodeInfo endpoint, or null if the archiver is not reachable.
 * Keys include publicKey, ip, port, version and time.
 */
async function getArchiverInfo(host: string, port: number): Promise<object> | null {
  try {
    return await http.get<object>(`http://${host}:${port}/nodeInfo`)
  } catch (e) {
    return null
  }
}

export function errorForArchiverDownMsg(msg: SignedObject<ArchiverDownMsg>): null | string {
  // TODO: Implement error checking for ArchiverDownMsg
  return null
}

export function errorForArchiverUpMsg(msg: SignedObject<ArchiverUpMsg>): null | string {
  // TODO: Implement error checking for ArchiverUpMsg
  return null
}

export function errorForInvestigateArchiverMsg(msg: SignedObject<InvestigateArchiverMsg>): null | string {
  // TODO: Implement error checking for InvestigateArchiverMsg
  return null
}
