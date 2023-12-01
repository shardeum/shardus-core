import { P2P } from '@shardus/types'
import { info, initLogging } from './logging'
import { registerRoutes } from './routes'

/** CycleCreator Functions */

/* These functions must be defined by all modules that implement a 
     network action like going active, lost node detection, etc.
     These functions are called by CycleCreator
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

  // loop through lostArchiversMap
  //   if status == 'down'
  //     Put entry's ArchiverDownMsg into lostArchivers array
  //   if status == 'up'
  //     Put entry's ArchiverUpMsg into refutedArchivers array

  // collect all ArchiverDownMsgs and put them into lostArchivers array
  // collect all ArchiverUpMsgs and put them into refutedArchivers array

  return {
    lostArchivers: [],
    refutedArchivers: [],
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
  // filter refutedArchivers array of any invalid ArchiverUpMsgs

  return {
    lostArchivers: [],
    refutedArchivers: [],
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

  // add all txs.lostArchivers publicKeys to record.lostArchivers
  // add all txs.refutedArchivers publicKeys to record.refutedArchivers

  // loop through prev.lostArchivers
  //   get lostArchiversMap entry from publicKey
  //   if cyclesToWait is > 0
  //     decrement cyclesToWait
  //     continue
  //   else
  //     add publicKey to record.removedArchivers
}

/**
 * This is called after Q4 of the prev cycle and before Q1 of the next cycle by CycleCreator
 * @param record The latest create Cycle Record
 * @returns A Change describing an addition, removal, or update from the Nodelist
 */
export function parseRecord(record: P2P.CycleCreatorTypes.CycleRecord): P2P.CycleParserTypes.Change {
  info('parseRecord function called')
  // loop through publicKeys from record.removedArchivers
  //   delete publicKey entry from Archivers.archivers map
  //   delete publicKey entry from lostArchiversMap

  // loop through publicKeys from record.refutedArchivers
  //   delete publicKey entry from lostArchiversMap
  return
}

export function queueRequest(request: any): void {
  /** Not used by LostArchivers */
}

/**
 * This is called once per cycle at the start of Q1 by CycleCreator.
 */
export function sendRequests(): void {
  info('sendRequests function called')

  // loop through lostArchiversMap
  //
  //   any entries with status 'reported'
  //     send off an InvestigateArchiverMessage to the investigator
  //     remove entry from the lostArchiversMap
  //
  //   if isInvestigator
  //     if status == 'down' && not gossipped
  //       Create ArchiverDownMsg and gossip it on the lostArchiverDownGossip route
  //       set gossipped to true
  // 
  return
}
