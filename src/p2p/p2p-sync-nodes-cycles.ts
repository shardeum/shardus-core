import { P2PModuleContext } from './p2p-types';

/** TYPES */

export interface Cycle {
  [otherCycleFields: string]: any;
  counter: number;
  active: number;
}

export interface CycleChainEnd {
  cycle_marker: string;
  cycle_number: number;
}

export interface CycleDataRequest {
  start: number;
  end: number;
}

export type CycleChainSlice = Cycle[];

/** STATE */

let p2p: P2PModuleContext;

/** ROUTES */

/* [TODO]
export const internalRoutes = [
  {
    name: 'cycle_chain_end',
    handler: () => {},
  },
  {
    name: 'cycle_data',
    handler: () => {},
  },
];
*/

/** FUNCTIONS */

export function setContext(context: P2PModuleContext) {
  p2p = context;
}

export async function newSyncToNetwork(activeNodes) {
  /**
   * Get the end of the current cycle chain from the network
   */
  const chainEndResp = await getNetworkChainEnd(activeNodes);
  if (checkChainEnd(chainEndResp) === false) {
    // [TODO] Get new active nodes and try again
  }
  const chainEnd = chainEndResp as CycleChainEnd;

  console.log('DBG newSyncToNetwork', chainEnd)

  /**
   * Get increasingly older cycle chain slices and use them to build our
   * node list, until our node list length === newestCycle.totalNodes
   */
  const sliceSize = 100;
  let chainSlice: Cycle[] = [];
  let oldestCycle: Cycle | null = null;
  let newestCycle: Cycle | null = null;

  do {
    /**
     * If we don't have an oldest cycle, set our oldest cycle number to the
     * current chain end
     */
    const oldestCycleNumber = oldestCycle
      ? oldestCycle.counter
      : chainEnd.cycle_number;
    /**
     * Get a chain slice that goes sliceSize cycles back from the oldest cycle
     * number we have, process it, and update oldestCycle
     */
    const chainSliceResp = getChainSlice(activeNodes, oldestCycleNumber, sliceSize);
    if (checkChainSlice(chainSliceResp) === false) {
      // [TODO] Get new active nodes and try again
    }
    chainSlice = chainSliceResp as CycleChainSlice;
    processChainSlice(chainSlice);
    oldestCycle = chainSlice[chainSlice.length - 1];
    /**
     * If we don't have a newest cycle, set it to the first cycle in the
     * chain slice we just got (this will be the cycle at current chain end)
     */
    if (!newestCycle) {
      newestCycle = chainSlice[0];
    }
  } while (getActiveNodesLength() !== newestCycle.active);
}

async function getNetworkChainEnd(nodes): Promise<unknown> {
  // [TODO] RobustQuery nodes for the end of their current cycle chain
  let cycleMarkerInfo
  try {
    cycleMarkerInfo = await p2p._fetchCycleMarker(nodes)
  } catch (e) {
    return undefined
  }


  // tslint:disable-next-line: variable-name
  let cycle_marker: any
  // tslint:disable-next-line: variable-name
  let cycle_number: any

  if (cycleMarkerInfo) {
    if (cycleMarkerInfo.currentCycleMarker) {
      cycle_marker = cycleMarkerInfo.currentCycleMarker
    }
    if (cycleMarkerInfo.cycleCounter) {
      cycle_number = cycleMarkerInfo.cycleCounter
    }
  }

  return {
    cycle_marker,
    cycle_number
  }
}

function checkChainEnd(response: unknown): boolean {
  // [TODO] Type and range checking for a cycle chain end
  return true;
}

function getChainSlice(nodes, start: number, offset: number): unknown[] {
  // [TODO] SequentialQuery nodes for cycle chain data
  return [];
}

function checkChainSlice(response: unknown): boolean {
  // [TODO] Type and range checking for a cycle chain slice
  return true;
}

function getActiveNodesLength(): number {
  return Object.keys(p2p.state.nodes.active).length;
}

function processChainSlice(slice: Cycle[]) {
  // [TODO] Add nodes in chain slice to our node list
  // [TODO] Add chain slice to our cycle chain
}
