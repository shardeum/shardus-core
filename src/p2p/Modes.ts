import { Logger } from 'log4js';
import { P2P } from '@shardus/types';
import * as Comms from './Comms';
import * as Context from './Context';
import * as Self from './Self';
import { validateTypes } from '../utils';
import { hasAlreadyEnteredProcessing } from './CycleCreator';
import * as NodeList from './NodeList';
import { nestedCountersInstance } from '../utils/nestedCounters';
import { logFlags } from '../logger';

/** STATE */

let p2pLogger: Logger;
export let networkMode: P2P.ModesTypes.Record['mode'] = 'forming';

/** ROUTES */
/*
const gossipRoute: P2P.P2PTypes.GossipHandler = () => {
  return
}

const routes = {
  internal: {},
  gossip: {
    gossip: gossipRoute,
  },
}
*/

/** FUNCTIONS */

/** CycleCreator Functions */

/* These functions must be defined by all modules that implement a
     network action like going active, lost node detection, etc.
     These functions are called by CycleCreator
*/

export function init(): void {
  // Init logger
  p2pLogger = Context.logger.getLogger('p2p');

  // Init state
  reset();

  // Register routes
  /*
  for (const [name, handler] of Object.entries(routes.internal)) {
    Comms.registerInternal(name, handler)
  }
  for (const [name, handler] of Object.entries(routes.gossip)) {
    Comms.registerGossipHandler(name, handler)
  }
  */
}

export function reset(): void {
  return;
}

export function getTxs(): P2P.ModesTypes.Txs {
  return;
}

export function dropInvalidTxs(txs: P2P.ModesTypes.Txs): P2P.ModesTypes.Txs {
  return;
}

/*
Given the txs and prev cycle record mutate the referenced record
*/
export function updateRecord(
  txs: P2P.ModesTypes.Txs,
  record: P2P.CycleCreatorTypes.CycleRecord,
  prev: P2P.CycleCreatorTypes.CycleRecord
): void {
  const active = NodeList.activeByIdOrder.length;

  const { initShutdown, forcedMode } = Context.config.p2p;

  // Check for forcedMode and apply it directly if present
  // for forcedMode v1 just allowing safety mode
  const validModes: P2P.ModesTypes.Record['mode'][] = [
    //'forming',
    //'processing',
    'safety',
    //'recovery',
    //'restart',
    //'restore',
  ];

  if (forcedMode && forcedMode !== '') {
    if (validModes.includes(forcedMode as P2P.ModesTypes.Record['mode'])) {
      /* prettier-ignore */ nestedCountersInstance.countEvent('P2P: forcedMode', forcedMode)
      /* prettier-ignore */ if(logFlags.verbose) console.log('P2P: Modes: Forced mode to:', forcedMode)
      record.mode = forcedMode as P2P.ModesTypes.Record['mode'];
    } else {
      /* prettier-ignore */ nestedCountersInstance.countEvent('P2P: forcedMode:invalid', forcedMode)
      /* prettier-ignore */ if(logFlags.verbose) console.log('P2P: Modes: Invalid forced mode:', forcedMode)
    }
    return;
  }

  // If Shutdown mode in triggered from Admin/DAO tx
  if (initShutdown) {
    record.mode = 'shutdown';
    return;
  }

  if (prev) {
    //  if the modules have just been swapped last cycle
    if (prev.mode === undefined && prev.safetyMode !== undefined) {
      if (hasAlreadyEnteredProcessing === false) {
        record.mode = 'forming';
      } else if (enterProcessing(active)) {
        record.mode = 'processing';
      } else if (enterSafety(active)) {
        record.mode = 'safety';
      } else if (enterRecovery(active)) {
        record.mode = 'recovery';
      }
      // for all other cases
    } else {
      record.mode = prev.mode;

      if (prev.mode === 'forming') {
        if (enterProcessing(active)) {
          record.mode = 'processing';
        }
      } else if (prev.mode === 'processing') {
        if (enterShutdown(active)) {
          record.mode = 'shutdown';
        } else if (enterRecovery(active)) {
          record.mode = 'recovery';
        } else if (enterSafety(active)) {
          record.mode = 'safety';
        }
      } else if (prev.mode === 'safety') {
        if (enterShutdown(active)) {
          record.mode = 'shutdown';
        } else if (enterRecovery(active)) {
          record.mode = 'recovery';
        } else if (enterProcessing(active)) {
          record.mode = 'processing';
        }
      } else if (prev.mode === 'recovery') {
        if (enterShutdown(active)) {
          record.mode = 'shutdown';
        } else if (enterRestore(active + prev.syncing)) {
          record.mode = 'restore';
        }
      } else if (prev.mode === 'shutdown' && Self.isFirst) {
        record.mode = 'restart';
      } else if (prev.mode === 'restart') {
        // Use prev.syncing to be sure that new joined nodes in the previous cycle have synced the cycle data before we trigger the `restore` mode to start syncing the state data
        if (enterRestore(prev.syncing)) {
          record.mode = 'restore';
        }
      } else if (prev.mode === 'restore') {
        if (enterProcessing(active)) {
          record.mode = 'processing';
        }
      }
    }
  } else if (Self.isFirst) {
    // If you're the first node
    record.mode = 'forming';
  }
}

export function validateRecordTypes(rec: P2P.ModesTypes.Record): string {
  const err = validateTypes(rec, { mode: 's' });
  if (err) return err;
  return '';
}

export function parseRecord(record: P2P.CycleCreatorTypes.CycleRecord): P2P.CycleParserTypes.Change {
  // If the networkMode before updating is 'restart' or 'recovery' and now it's about to change to 'restore', emit 'restore' event
  if ((networkMode === 'restart' || networkMode === 'recovery') && record.mode === 'restore') {
    Self.emitter.emit('restore', record.counter);
  }
  if (networkMode === 'restore' && record.mode === 'processing') {
    Self.setRestartNetwork(false);
  }
  networkMode = record.mode;
  if (networkMode === 'restart' && !Self.isRestartNetwork) Self.setRestartNetwork(true);
  return {
    added: [],
    removed: [],
    updated: [],
  };
}

export function queueRequest(): void {
  return;
}

export function sendRequests(): void {
  return;
}

/** Helper Functions */

/* These functions make the code neater and easier to understand
 */
// use baselineNodes for the below functions since it deals with losing nodes and unexpected downsizing
// baselineNodes is the baseline number of nodes required to be in the network to be considered safe
export function enterRecovery(activeCount: number): boolean {
  const threshold = Context.config.p2p.networkBaselineEnabled
    ? Context.config.p2p.baselineNodes
    : Context.config.p2p.minNodes;
  return activeCount < 0.75 * threshold;
}

export function enterShutdown(activeCount: number): boolean {
  const threshold = Context.config.p2p.networkBaselineEnabled
    ? Context.config.p2p.baselineNodes
    : Context.config.p2p.minNodes;
  return activeCount <= 0.3 * threshold;
}

export function enterSafety(activeCount: number): boolean {
  const threshold = Context.config.p2p.networkBaselineEnabled
    ? Context.config.p2p.baselineNodes
    : Context.config.p2p.minNodes;
  return activeCount >= 0.75 * threshold && activeCount < 0.9 * threshold;
}

export function enterProcessing(activeCount: number): boolean {
  /* 
  In the future the change from recovery to processing will need to be updated in the recovery project.
  per Andrew, we may want a sticky state that doesn't enter processing until something indicates the data is restored,
  and we may even want the nodes to get to minnodes count before the archivers start patching data
  */
  // use of minNodes instead of baselineNodes since dealing with going into processing mode
  return activeCount >= Context.config.p2p.minNodes;
}
/** An internal tx is allowed to be processed if the network is in one of the modes mentioned in the function */
export function isInternalTxAllowed(): boolean {
  return ['processing', 'safety', 'forming'].includes(networkMode);
}

export function enterRestore(totalNodeCount: number): boolean {
  // use of baselineNodes since dealing with going into restore mode and baselineNodes is the minimum number of nodes required to go into safety, restore, and recovery mode
  const threshold = Context.config.p2p.networkBaselineEnabled
    ? Context.config.p2p.baselineNodes
    : Context.config.p2p.minNodes;
  return totalNodeCount >= threshold + Context.config.p2p.extraNodesToAddInRestart;
}
