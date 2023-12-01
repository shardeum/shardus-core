import { publicKey } from '@shardus/types'
import { ArchiverDownMsg } from '@shardus/types/src/p2p/LostArchiverTypes'
import { SignedObject } from '@shardus/types/build/src/p2p/P2PTypes'

/** TYPES */

export interface LostArchiverRecord {
  isInvestigator: boolean
  gossipped: boolean
  target: publicKey
  status: 'reported' | 'investigating' | 'down' | 'up'
  archiverDownMsg: SignedObject<ArchiverDownMsg>
  cyclesToWait: number
}

/** DATA */

/**
 * An internal map used to keep track of Archivers going through the LostArchivers protocol.
 * Maps Archiver public key to a LostRecord in the map.
 */
export const lostArchiversMap = new Map<publicKey, LostArchiverRecord>()
