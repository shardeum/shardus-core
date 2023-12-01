import { publicKey } from '@shardus/types'
import { SignedObject } from '@shardus/types/build/src/p2p/P2PTypes'
import { ArchiverDownMsg, ArchiverRefutesLostMsg, ArchiverUpMsg, InvestigateArchiverMsg } from '@shardus/types/build/src/p2p/LostArchiverTypes'

/** TYPES */

export interface LostArchiverRecord {
  isInvestigator: boolean
  gossippedDownMsg: boolean
  gossippedUpMsg: boolean
  target: publicKey
  status: 'reported' | 'investigating' | 'down' | 'up'
  investigateMsg?: SignedObject<InvestigateArchiverMsg>
  archiverDownMsg?: SignedObject<ArchiverDownMsg>
  archiverUpMsg?: SignedObject<ArchiverUpMsg>
  archiverRefuteMsg?: SignedObject<ArchiverRefutesLostMsg>
  cyclesToWait: number
}

/** DATA */

/**
 * An internal map used to keep track of Archivers going through the LostArchivers protocol.
 * Maps Archiver public key to a LostRecord in the map.
 */
export const lostArchiversMap = new Map<publicKey, LostArchiverRecord>()