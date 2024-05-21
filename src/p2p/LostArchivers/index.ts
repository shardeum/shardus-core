import { P2P } from '@shardus/types'
import { insertSorted } from '../../utils'
import { removeArchiverByPublicKey } from '../Archivers'
import {
  errorForArchiverDownMsg,
  errorForArchiverUpMsg,
  informInvestigator,
  tellNetworkArchiverIsDown,
  tellNetworkArchiverIsUp,
} from './functions'
import { info, initLogging } from './logging'
import { registerRoutes } from './routes'
import { lostArchiversMap } from './state'
import { ArchiverDownMsg, ArchiverUpMsg } from '@shardus/types/build/src/p2p/LostArchiverTypes'
import { SignedObject } from '@shardus/types/build/src/p2p/P2PTypes'
import { inspect } from 'util'
import { logFlags } from '../../logger'
import { Utils } from '@shardus/types'

/** CycleCreator Functions */

/* These functions must be defined by all modules that implement a 
     network action like going active, lost node detection, etc.
     These functions are called by CycleCreator
*/

/**
 * Gets called once when the CycleCreator system is initialized
 */
export function init(): void {
  initLogging()
  info('init() called')

  // Init state
  reset()

  // Register routes
  registerRoutes()
}

/**
 * This gets called before start of Q1
 */
export function reset(): void {
  info('reset() called')
}

/**
 * This gets called at the start of Q3.
 * @returns CycleTxs specific to this cycle module
 */
export function getTxs(): P2P.LostArchiverTypes.Txs {
  info('getTxs() called')

  const lostArchivers: SignedObject<ArchiverDownMsg>[] = []
  const refutedArchivers: SignedObject<ArchiverUpMsg>[] = []

  // loop through lostArchiversMap
  info('  looping through lostArchiversMap')
  for (const entry of lostArchiversMap.values()) {
    info(`    record: ${inspect(entry)}`)
    // Don't include entries you haven't investigated yet
    if (entry.isInvestigator && !entry.gossippedDownMsg) continue
    // if status == 'down', Put entry's ArchiverDownMsg into lostArchivers array
    if (entry.status === 'down' && entry.archiverDownMsg) {
      insertSorted(lostArchivers, entry.archiverDownMsg)
    }
    // if status == 'up', Put entry's ArchiverUpMsg into refutedArchivers array
    if (entry.status === 'up' && entry.archiverUpMsg) {
      insertSorted(refutedArchivers, entry.archiverUpMsg)
    }
  }

  info('===Lost Archivers Txs===')
  info(`lostArchivers: ${inspect(lostArchivers)}`)
  info(`refutedArchivers: ${inspect(refutedArchivers)}`)
  info('===Lost Archivers Txs===')

  return {
    lostArchivers,
    refutedArchivers,
  }
}

/**
 * This gets called during Q3 after getTxs.
 * @param txs CycleTxs specific to this cycle module
 * @returns An object containing only valid txs for this cycle module
 */
export function dropInvalidTxs(txs: P2P.LostArchiverTypes.Txs): P2P.LostArchiverTypes.Txs {
  info('dropInvalidTxs() called')

  // filter lostArchivers array of any invalid ArchiverDownMsgs
  const lostArchivers = txs.lostArchivers.filter((tx) => errorForArchiverDownMsg(tx) === null)
  // filter refutedArchivers array of any invalid ArchiverUpMsgs
  const refutedArchivers = txs.refutedArchivers.filter((tx) => errorForArchiverUpMsg(tx) === null)

  return {
    lostArchivers,
    refutedArchivers,
  }
}

/**
 * This gets called during Q3 after dropInvalidTxs.
 * Given the txs and prev cycle record mutate the referenced record.
 * @param txs CycleTxs specific to this cycle module
 * @param record A reference to the currently being created Cycle Record
 * @param prev A reference to the previously created Cycle Record
 */
export function updateRecord(
  txs: P2P.LostArchiverTypes.Txs,
  record: P2P.CycleCreatorTypes.CycleRecord,
  prev: P2P.CycleCreatorTypes.CycleRecord
): void {
  info('updateRecord function called')

  const lostArchivers = []
  const refutedArchivers = []
  const removedArchivers = []

  // add all txs.lostArchivers publicKeys to record.lostArchivers
  for (const tx of txs.lostArchivers) {
    const target = tx.investigateMsg?.target
    if(target) {
      insertSorted(lostArchivers, target)
    } else {
      /* prettier-ignore */ if (logFlags.debug) console.log(`publicKey undefined for tx: ${Utils.safeStringify(tx)} in lostArchivers`)
    }
  }
  // add all txs.refutedArchivers publicKeys to record.refutedArchivers
  for (const tx of txs.refutedArchivers) {
    const target = tx.downMsg?.investigateMsg?.target
    if(target) {
      insertSorted(refutedArchivers, target)
    } else {
      /* prettier-ignore */ if (logFlags.debug) console.log(`publicKey undefined for tx: ${Utils.safeStringify(tx)} in refutedArchivers`)
    }
  }

  // loop through prev.lostArchivers
  if (prev) {
    for (const publicKey of prev.lostArchivers) {
      // get lostArchiversMap entry from publicKey
      const record = lostArchiversMap.get(publicKey)
      if (!record) continue

      // wait cyclesToWait before adding the lostArchiver to removedArchivers
      if (record.cyclesToWait > 0) {
        // decrement cyclesToWait
        record.cyclesToWait--
      } else {
        // add publicKey to record.removedArchivers
        insertSorted(removedArchivers, publicKey)
      }
    }
  }

  record.lostArchivers = lostArchivers
  record.refutedArchivers = refutedArchivers
  record.removedArchivers = removedArchivers
}

/**
 * This is called after Q4 of the prev cycle and before Q1 of the next cycle by CycleCreator
 * @param record The latest create Cycle Record
 * @returns A Change describing an addition, removal, or update from the Nodelist
 */
export function parseRecord(record: P2P.CycleCreatorTypes.CycleRecord): P2P.CycleParserTypes.Change {
  info('parseRecord function called')

  // loop through publicKeys from record.removedArchivers
  for (const publicKey of record.removedArchivers) {
    // delete publicKey entry from Archivers.archivers map
    removeArchiverByPublicKey(publicKey)
    // delete publicKey entry from lostArchiversMap
    lostArchiversMap.delete(publicKey)
  }

  // loop through publicKeys from record.refutedArchivers
  for (const publicKey of record.refutedArchivers) {
    // delete publicKey entry from lostArchiversMap
    lostArchiversMap.delete(publicKey)
  }

  return {
    added: [],
    removed: [],
    updated: [],
  }
}

export function queueRequest(request: any): void {
  /** Not used by LostArchivers */
}

/**
 * This is called once per cycle at the start of Q1 by CycleCreator.
 */
export function sendRequests(): void {
  info('sendRequests function called')

  // DBG pretty print internal lostArchiversMap to logs
  info('=== lostArchiversMap ===')
  info(`${inspect(lostArchiversMap)}`)
  info('=== lostArchiversMap ===')

  // loop through lostArchiversMap
  for (const [publicKey, record] of lostArchiversMap) {
    info(`  record: ${inspect(record)}`)
    // any entries with status 'reported'
    if (record.status === 'reported') {
      // Create InvestigateArchiverMsg and send it to the lostArchiverInvestigate route
      informInvestigator(publicKey)
      // Delete record from map
      lostArchiversMap.delete(publicKey)
      continue
    }
    // if isInvestigator
    if (record.isInvestigator) {
      // if status == 'down' && not gossipped
      if (record.status === 'down' && !record.gossippedDownMsg) {
        // Create ArchiverDownMsg and gossip it on the lostArchiverDownGossip route
        tellNetworkArchiverIsDown(record)
        // set gossipped to true
        record.gossippedDownMsg = true
      }
      continue
    }
    if (record.status === 'up' && !record.gossippedUpMsg) {
      // Create ArchiverUpMsg and gossip it on the lostArchiverUpGossip route
      tellNetworkArchiverIsUp(record) 
      // set gossiped to true
      record.gossippedUpMsg = true
      continue
    }
  }
  return
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function validateRecordTypes(rec: P2P.ActiveTypes.Record): string {
  return ''
}
