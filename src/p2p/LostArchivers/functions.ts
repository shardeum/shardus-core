import * as http from '../../http'
import { publicKey } from '@shardus/types'
import { CycleMarker } from '@shardus/types/build/src/p2p/CycleCreatorTypes'
import {
  ArchiverDownMsg,
  ArchiverUpMsg,
  InvestigateArchiverMsg,
} from '@shardus/types/build/src/p2p/LostArchiverTypes'
import { Node } from '@shardus/types/build/src/p2p/NodeListTypes'
import { SignedObject } from '@shardus/types/build/src/p2p/P2PTypes'
import * as Archivers from '../Archivers'
import * as Comms from '../Comms'
import * as Context from '../Context'
import * as CycleChain from '../../p2p/CycleChain'
import * as NodeList from '../NodeList'
import { LostArchiverRecord, lostArchiversMap } from './state'
import { logFunc } from './logging'
import { info } from 'console'

/** Lost Archivers Functions */

function stringify(obj: object): string {
  return JSON.stringify(obj, null, 2)
}

/**
 * Marks an Archiver as lost in our internal map.
 * This function gets called anytime communication with an Archiver breaks down
 * Called by Archivers.ts
 */
export function reportLostArchiver(publicKey: publicKey, errorMsg: string): void {
  info(`reportLostArchiver: publicKey: ${publicKey}, errorMsg: ${errorMsg}`)
  if (lostArchiversMap.has(publicKey)) {
    info('reportLostArchiver: already have LostArchiverRecord')
  } else {
    info('reportLostArchiver: adding new LostArchiverRecord')
    lostArchiversMap.set(publicKey, {
      isInvestigator: false,
      gossipped: false,
      target: publicKey,
      status: 'reported',
      cyclesToWait: 0,
    })
  }
  // don't gossip here; that is initiated in sendRequests()
}

/**
 * Called by investigateLostArchiverRoute
 */
export async function investigateArchiver(publicKey: publicKey): Promise<void> {
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
    cyclesToWait: 0,
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

export function errorForArchiverDownMsg(msg: SignedObject<ArchiverDownMsg> | null): string | null {
  if (msg == null) return 'null message'
  if (msg.sign == null) return 'no signature'
  // TODO: Implement error checking for ArchiverDownMsg
  return null
}

export function errorForArchiverUpMsg(msg: SignedObject<ArchiverUpMsg> | null): string | null {
  if (msg == null) return 'null message'
  if (msg.sign == null) return 'no signature'
  // TODO: Implement error checking for ArchiverUpMsg
  return null
}

export function errorForInvestigateArchiverMsg(
  msg: SignedObject<InvestigateArchiverMsg> | null
): string | null {
  if (msg == null) return 'null message'
  if (msg.sign == null) return 'no signature'
  // TODO: Implement error checking for InvestigateArchiverMsg
  return null
}
