import { Logger } from 'log4js'
import { P2P } from '@shardus/types'
import * as Comms from './Comms'
import * as Context from './Context'
import * as Self from './Self'
import { validateTypes } from '../utils'
import { hasAlreadyEnteredProcessing } from './CycleCreator'
import * as NodeList from './NodeList'

/** STATE */

let p2pLogger: Logger

/** ROUTES */

const gossipRoute: P2P.P2PTypes.GossipHandler = () => {
  return
}

const routes = {
  internal: {},
  gossip: {
    gossip: gossipRoute,
  },
}

/** FUNCTIONS */

/** CycleCreator Functions */

/* These functions must be defined by all modules that implement a
     network action like going active, lost node detection, etc.
     These functions are called by CycleCreator
*/

export function init(): void {
  // Init logger
  p2pLogger = Context.logger.getLogger('p2p')

  // Init state
  reset()

  // Register routes
  for (const [name, handler] of Object.entries(routes.internal)) {
    Comms.registerInternal(name, handler)
  }
  for (const [name, handler] of Object.entries(routes.gossip)) {
    Comms.registerGossipHandler(name, handler)
  }
}

export function reset(): void {
  return
}

export function getTxs(): P2P.ModesTypes.Txs {
  return
}

export function dropInvalidTxs(txs: P2P.ModesTypes.Txs): P2P.ModesTypes.Txs {
  return
}

/*
Given the txs and prev cycle record mutate the referenced record
*/
export function updateRecord(
  txs: P2P.ModesTypes.Txs,
  record: P2P.CycleCreatorTypes.CycleRecord,
  prev: P2P.CycleCreatorTypes.CycleRecord
): void {
  const active = NodeList.activeByIdOrder.length

  // If you're the first node
  if (Self.isFirst) {
    // Get safety mode field values from snapshot
    Object.assign(record, { mode: 'forming' })
  }
  // If you're not the first node
  else if (prev) {
    //  if the modules have just been swapped last cycle
    if (prev.mode === undefined && prev.safetyMode !== undefined) {
      if (hasAlreadyEnteredProcessing === false) {
        record.mode = 'forming'
      } else if (enterProcessing(active)) {
        record.mode = 'processing'
      } else if (enterSafety(active, prev)) {
        record.mode = 'safety'
      } else if (enterRecovery(active)) {
        record.mode = 'recovery'
      }
      // for all other cases
    } else {
      record.mode = prev.mode

      if (prev.mode === 'forming') {
        if (enterProcessing(active)) {
          record.mode = 'processing'
        }
      } else if (prev.mode === 'processing') {
        if (enterRecovery(active)) {
          record.mode = 'recovery'
        } else if (enterSafety(active, prev)) {
          record.mode = 'safety'
        }
      } else if (prev.mode === 'safety') {
        if (enterRecovery(active)) {
          record.mode = 'recovery'
        } else if (enterProcessing(active)) {
          record.mode = 'processing'
        }
      } else if (prev.mode === 'recovery') {
        if (enterSafety(active, prev)) {
          record.mode = 'safety'
        } else if (enterProcessing(active)) {
          record.mode = 'processing'
        }
      }
    }
  }
}

export function validateRecordTypes(rec: P2P.ModesTypes.Record): string {
  const err = validateTypes(rec, { mode: 's' })
  if (err) return err
  return ''
}

export function parseRecord(record: P2P.CycleCreatorTypes.CycleRecord): P2P.CycleParserTypes.Change {
  return {
    added: [],
    removed: [],
    updated: [],
  }
}

export function queueRequest(): void {
  return
}

export function sendRequests(): void {
  return
}

/** Helper Functions */

/* These functions make the code neater and easier to understand
 */

export function enterRecovery(activeCount: number): boolean {
  return activeCount < 0.5 * Context.config.p2p.minNodes
}

export function enterSafety(activeCount: number, prevRecord: P2P.CycleCreatorTypes.CycleRecord): boolean {
  if (prevRecord.mode === 'recovery') {
    return activeCount >= 0.6 * Context.config.p2p.minNodes && activeCount < 0.9 * Context.config.p2p.minNodes
  } else {
    return activeCount >= 0.5 * Context.config.p2p.minNodes && activeCount < 0.9 * Context.config.p2p.minNodes
  }
}

export function enterProcessing(activeCount: number): boolean {
  /* 
  In the future the change from recovery to processing will need to be updated in the recovery project.
  per Andrew, we may want a sticky state that doesn't enter processing until something indicates the data is restored,
  and we may even want the nodes to get to minnodes count before the archivers start patching data
  */
  return activeCount >= Context.config.p2p.minNodes
}
