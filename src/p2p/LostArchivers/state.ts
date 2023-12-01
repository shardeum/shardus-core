import { publicKey } from '@shardus/types'
import { SignedObject } from '@shardus/types/build/src/p2p/P2PTypes'
import { ArchiverDownMsg, ArchiverUpMsg } from '@shardus/types/src/p2p/LostArchiverTypes'
import { config } from '../Context'

/** TYPES */

export interface LostArchiverRecord {
  isInvestigator: boolean
  gossipped: boolean
  target: publicKey
  status: 'reported' | 'investigating' | 'down' | 'up'
  archiverDownMsg?: SignedObject<ArchiverDownMsg>
  archiverUpMsg?: SignedObject<ArchiverUpMsg>
  cyclesToWait: number
}

/** DATA */

/**
 * An internal map used to keep track of Archivers going through the LostArchivers protocol.
 * Maps Archiver public key to a LostRecord in the map.
 */
export const lostArchiversMap = new Map<publicKey, LostArchiverRecord>()