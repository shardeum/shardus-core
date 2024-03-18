import { publicKey } from '@shardus/types'
import { CycleMarker } from '@shardus/types/build/src/p2p/CycleCreatorTypes'
import {
  ArchiverDownMsg,
  ArchiverRefutesLostMsg,
  ArchiverUpMsg,
  InvestigateArchiverMsg,
} from '@shardus/types/build/src/p2p/LostArchiverTypes'
import { Node } from '@shardus/types/build/src/p2p/NodeListTypes'
import { SignedObject } from '@shardus/types/build/src/p2p/P2PTypes'
import * as http from '../../http'
import * as CycleChain from '../../p2p/CycleChain'
import * as Archivers from '../Archivers'
import * as Comms from '../Comms'
import * as Context from '../Context'
import * as NodeList from '../NodeList'
import { LostArchiverRecord, lostArchiversMap } from './state'
import { info, warn, error } from './logging'
import { id } from '../Self'
import { binarySearch } from '../../utils/functions/arrays'
import { activeByIdOrder } from '../NodeList'
import { inspect } from 'util'
import { formatErrorMessage } from '../../utils'
import { nestedCountersInstance } from '../..'
import { shardusGetTime } from '../../network'
import {
  LostArchiverInvestigateReq,
  serializeLostArchiverInvestigateReq,
} from '../../types/LostArchiverInvestigateReq'
import { InternalRouteEnum } from '../../types/enum/InternalRouteEnum'
import { tellBinary } from '../Comms'

/** Lost Archivers Functions */

function stringify(obj: object): string {
  return JSON.stringify(obj, null, 2)
}

export function createLostArchiverRecord(obj: Partial<LostArchiverRecord>): LostArchiverRecord {
  if (obj.isInvestigator == null) obj.isInvestigator = false
  if (obj.gossippedDownMsg == null) obj.gossippedDownMsg = false
  if (obj.gossippedUpMsg == null) obj.gossippedUpMsg = false
  if (obj.target == null) throw 'Must specify a target for LostArchiverRecord'
  if (obj.status == null) obj.status = 'reported'
  if (obj.cyclesToWait == null) obj.cyclesToWait = Context.config.p2p.lostArchiversCyclesToWait
  return obj as LostArchiverRecord
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
  // Add new entry to lostArchiversMap for reported Archiver if it doesn't exist
  // This is to ensure that we don't overwrite existing entries
  if (lostArchiversMap.has(publicKey)) {
    info('reportLostArchiver: already have LostArchiverRecord')
  } else {
    info('reportLostArchiver: adding new LostArchiverRecord')
    // Set status to 'reported'
    // This status indicates that the Archiver has been reported as lost, but not yet investigated
    lostArchiversMap.set(
      publicKey,
      createLostArchiverRecord({
        target: publicKey,
        status: 'reported',
      })
    )
  }
  // don't gossip here; that is initiated in sendRequests()
}

/**
 * Investigates a reported lost Archiver.
 * This function gets called to verify if an Archiver is indeed lost
 * @param publicKey - The public key of the Archiver to investigate
 */
export async function investigateArchiver(
  investigateMsg: SignedObject<InvestigateArchiverMsg>
): Promise<void> {
  info(`investigateArchiver: investigateMsg: ${inspect(investigateMsg)}`)
  const publicKey = investigateMsg.target
  const archiver = Archivers.archivers.get(publicKey)
  if (!archiver) {
    // don't know the archiver
    warn(
      `investigateArchiver: asked to investigate archiver '${publicKey}', but it's not in the archivers list`
    )
    return
  }

  // Retrieve the record of the Archiver from the lostArchiversMap
  info(`investigateArchiver: publicKey: ${publicKey}`)
  let record = lostArchiversMap.get(publicKey)
  if (record && ['investigating', 'down', 'up'].includes(record.status)) {
    info('investigateArchiver: already have LostArchiverRecord')
    // already investigated
    return
  }
  // starting investigation
  record = createLostArchiverRecord({
    isInvestigator: true,
    target: publicKey,
    status: 'investigating',
    gossippedDownMsg: false,
    investigateMsg,
  })

  // record it
  lostArchiversMap.set(publicKey, record)

  // ping the archiver
  const isReachable = await pingArchiver(archiver.ip, archiver.port)

  // handle the result
  if (isReachable) {
    info(`investigateArchiver: archiver is reachable`)
    lostArchiversMap.delete(publicKey)
  } else {
    info(`investigateArchiver: archiver is not reachable`)
    record.status = 'down'
  }
  // don't gossip here; that is initiated in sendRequests()
}

/**
 * Picks an investigator node for lost archiver detection
 * @param record record in from the lostArchiverRecordMap
 * @returns The node ID of the investigator for that specific record
 */
export function getInvestigator(target: publicKey, marker: CycleMarker): Node {
  // Implement hashing target + marker and returning node from Nodelist with id closest to hash
  // This is to ensure that the investigator node is chosen in a deterministic manner
  const obj = { target, marker }
  const near = Context.crypto.hash(obj)
  let idx = binarySearch(activeByIdOrder, near, (i, r) => i.localeCompare(r.id))
  if (idx < 0) idx = (-1 - idx) % activeByIdOrder.length
  // eslint-disable-next-line security/detect-object-injection
  const foundNode = activeByIdOrder[idx]
  // eslint-disable-next-line security/detect-object-injection
  if (foundNode == null) {
    throw new Error(`activeByIdOrder idx:${idx} length: ${activeByIdOrder.length}`)
  }
  if (foundNode.id === id) idx = (idx + 1) % activeByIdOrder.length // skip to next node if the selected node is target
  return foundNode
}

/**
 * Informs the investigator node that an Archiver is lost
 * @param target - The public key of the lost Archiver
 */
export function informInvestigator(target: publicKey): void {
  // This is to initiate the investigation process
  try {
    // Compute investigator based off of hash(target + cycle marker)
    const cycle = CycleChain.getCurrentCycleMarker()
    const investigator = getInvestigator(target, cycle)
    // Don't send yourself an InvestigateArchiverMsg
    if (id === investigator.id) {
      info(`informInvestigator: investigator is self, not sending InvestigateArchiverMsg`)
      return
    }

    // Form msg
    const investigateMsg: SignedObject<InvestigateArchiverMsg> = Context.crypto.sign({
      type: 'investigate',
      target,
      investigator: investigator.id,
      sender: id,
      cycle,
    })

    // Send message to investigator
    info(`informInvestigator: sending InvestigateArchiverMsg: ${inspect(investigateMsg)}`)
    if (this.config.p2p.useBinarySerializedEndpoints && this.config.p2p.lostArchiverInvestigateBinary) {
      Comms.tellBinary<LostArchiverInvestigateReq>(
        [investigator],
        InternalRouteEnum.binary_broadcast_state,
        investigateMsg,
        serializeLostArchiverInvestigateReq,
        {}
      )
    } else {
      Comms.tell([investigator], 'lost-archiver-investigate', investigateMsg)
    }
    
  } catch (ex) {
    nestedCountersInstance.countEvent('p2p', `informInvestigator error ${shardusGetTime()}`)
    error('informInvestigator: ' + formatErrorMessage(ex))
  }
}

/**
 * Tells the network that an Archiver is down
 * @param archiverKey - The public key of the down Archiver
 */
export function tellNetworkArchiverIsDown(record: LostArchiverRecord): void {
  const archiverKey = record.target
  info(`tellNetworkArchiverIsDown: archiverKey: ${archiverKey}`)
  const downMsg: SignedObject<ArchiverDownMsg> = Context.crypto.sign({
    type: 'down',
    cycle: CycleChain.getCurrentCycleMarker(),
    investigateMsg: record.investigateMsg,
  })
  info(`tellNetworkArchiverIsDown: downMsg: ${stringify(downMsg)}`)
  record.archiverDownMsg = downMsg
  Comms.sendGossip('lost-archiver-down', downMsg, '', null, NodeList.byIdOrder, /* isOrigin */ true)
  // This is to inform the rest of the network that the Archiver is down
}

/**
 * Tells the network thtellNetworkArchiverIsUpat an Archiver as up.
 * @param publicKey - The public key of the Archiver that is now up
 */
export function tellNetworkArchiverIsUp(record: LostArchiverRecord): void {
  // Create an ArchiverUpMsg using the saved ArchiverRefutedLostMsg
  const upMsg: SignedObject<ArchiverUpMsg> = Context.crypto.sign({
    type: 'up',
    downMsg: record.archiverDownMsg,
    refuteMsg: record.archiverRefuteMsg,
    cycle: CycleChain.getCurrentCycleMarker(),
  })
  record.archiverUpMsg = upMsg
  // Gossip the ArchiverUpMsg to the rest of the network
  info(`tellNetworkArchiverIsUp: upMsg: ${stringify(upMsg)}`)
  Comms.sendGossip('lost-archiver-up', upMsg, '', null, NodeList.byIdOrder, /* isOrigin */ true)
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

function missingProperties(obj: object, keys: string | string[]): string[] {
  if (typeof keys === 'string') keys = keys.split(/\s+/)
  if (obj == null) return keys
  const missing = []
  for (const key of keys) {
    if (!(key in obj)) missing.push(key)
  }
  return missing
}

/**
 * Checks for errors in an ArchiverDownMsg
 * @param msg - The ArchiverDownMsg to check
 * @returns null if there are no errors, and a string describing the error otherwise
 */
export function errorForArchiverDownMsg(msg: SignedObject<ArchiverDownMsg> | null): string | null {
  if (msg == null) return 'null message'
  if (msg.sign == null) return 'no signature'
  const missing = missingProperties(msg, 'type investigateMsg cycle')
  if (missing.length) return `missing properties: ${missing.join(', ')}`
  return _errorForInvestigateArchiverMsg(msg.investigateMsg)
  // to-do: check for valid signature
}

/**
 * Checks for errors in an ArchiverUpMsg
 * @param msg - The ArchiverUpMsg to check
 * @returns null if there are no errors, and a string describing the error otherwise
 */
export function errorForArchiverUpMsg(msg: SignedObject<ArchiverUpMsg> | null): string | null {
  if (msg == null) return 'null message'
  if (msg.sign == null) return 'no signature'
  const missing = missingProperties(msg, 'type downMsg refuteMsg cycle')
  if (missing.length) return `missing properties: ${missing.join(', ')}`
  /*
  to-do:
    downMsg: ArchiverDownMsg;
    refuteMsg: ArchiverRefutesLostMsg;
  */
  // to-do: check for valid signature
  return null
}

/**
 * Checks for errors in an ArchiverRefutesLostMsg
 * @param msg - The ArchiverUpMsg to check
 * @returns null if there are no errors, and a string describing the error otherwise
 */
export function errorForArchiverRefutesLostMsg(
  msg: SignedObject<ArchiverRefutesLostMsg> | null
): string | null {
  if (msg == null) return 'null message'
  if (msg.sign == null) return 'no signature'
  const missing = missingProperties(msg, 'archiver cycle')
  if (missing.length) return `missing properties: ${missing.join(', ')}`
  // to-do: check for valid signature
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
  const error = _errorForInvestigateArchiverMsg(msg)
  if (error) return error
  // to-do: check for valid signature
  return null
}

function _errorForInvestigateArchiverMsg(msg: InvestigateArchiverMsg | null): string | null {
  if (msg == null) return 'null message'
  const missing = missingProperties(msg, 'type target investigator sender cycle')
  if (missing.length) return `missing properties: ${missing.join(', ')}`
  if (msg.type !== 'investigate') return `invalid type: ${msg.type}`
  return null
}
