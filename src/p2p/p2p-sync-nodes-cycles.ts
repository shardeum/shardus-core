import { fetchNodeInfo } from './p2p-startup'
import { Node, NodeInfo, P2PModuleContext } from './p2p-types'
import { QueryFunction, sequentialQuery } from './p2p-utils'

/** TYPES */

export interface Cycle {
  [otherCycleFields: string]: any
  counter: number
  active: number
}

export interface CycleChainEnd {
  cycle_marker: string
  cycle_number: number
}

export interface CycleDataRequest {
  start: number
  end: number
}

export type CycleChainSlice = Cycle[]

/** STATE */

let p2p: P2PModuleContext

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
  p2p = context
}

export async function newSyncToNetwork(activeNodes: Node[]) {
  /**
   * Get the end of the current cycle chain from the network
   */
  const chainEndResp = await getNetworkChainEnd(activeNodes)
  if (checkChainEnd(chainEndResp) === false) {
    // [TODO] Get new active nodes and try again
    console.log('Bad chainEndResp:', chainEndResp)
  }
  const chainEnd = chainEndResp as CycleChainEnd

  console.log('DBG chainEnd', chainEnd)

  /**
   * Query the active nodes for their complete node info
   */
  const [nodeInfoResps, nodeInfoErrors] = await fetchNodeInfo(activeNodes)
  if (checkActiveNodeInfos(nodeInfoResps) === false) {
    // [TODO] Get new active nodes and try again
    console.log('Bad active node infos')
    console.log(nodeInfoErrors)
  }
  const activeNodeInfos = nodeInfoResps as NodeInfo[]

  /**
   * Get increasingly older cycle chain slices and use them to build our
   * node list, until our node list length === newestCycle.totalNodes
   */
  const sliceSize = 100
  let chainSlice: Cycle[] = []
  let oldestCycle: Cycle | null = null
  let newestCycle: Cycle | null = null

  do {
    /**
     * If we don't have an oldest cycle, set our oldest cycle number to the
     * current chain end
     */
    const oldestCycleNumber = oldestCycle
      ? oldestCycle.counter
      : chainEnd.cycle_number
    /**
     * Get a chain slice that goes sliceSize cycles back from the oldest cycle
     * number we have, process it, and update oldestCycle
     */
    const chainSliceResp = await getChainSlice(
      activeNodeInfos,
      oldestCycleNumber,
      sliceSize
    )
    if (checkChainSlice(chainSliceResp) === false) {
      // [TODO] Get new active nodes and try again
      console.log('Bad chainSliceResp:', chainSliceResp)
    }
    chainSlice = chainSliceResp as CycleChainSlice

    console.log('DBG chainSlice', chainSlice)

    processChainSlice(chainSlice)
    oldestCycle = chainSlice[chainSlice.length - 1] // slice = [NEW, ..., OLD]
    /**
     * If we don't have a newest cycle, set it to the first cycle in the
     * chain slice we just got (this will be the cycle at current chain end)
     */
    if (!newestCycle) {
      newestCycle = chainSlice[0]
    }
  } while (getActiveNodesLength() !== newestCycle.active)
}

function checkActiveNodeInfos(responses): boolean {
  if (!Array.isArray(responses)) return false
  if (responses.length < 1) return false
  // [TODO] Check type and range of NodeInfos
  return true
}

async function getNetworkChainEnd(nodes): Promise<unknown> {
  // [TODO] RobustQuery nodes for the end of their current cycle chain

  // Use the 'cyclemarker' public route for now
  let cycleMarkerInfo
  try {
    cycleMarkerInfo = await p2p._fetchCycleMarker(nodes)
  } catch (e) {
    // [TODO] Log the error better
    console.log('p2p-sync: getNetworkChainEnd:')
    console.log(e)
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
    cycle_number,
  }
}

function checkChainEnd(response: unknown): boolean {
  // [TODO] Type and range checking for a cycle chain end
  if (!response) return false
  return true
}

async function getChainSlice(
  nodeInfos: NodeInfo[],
  start: number,
  offset: number
): Promise<unknown> {
  // [TODO] SequentialQuery nodes for cycle chain data

  // Use the old 'cyclechain' internal route for now
  const end = start > offset ? start - offset : 0
  const queryFn: QueryFunction = node =>
    p2p.ask(node, 'cyclechain', { start: end, end: start })

  const resp = await sequentialQuery(nodeInfos, queryFn)

  console.log('DBG getChainSlice resp', resp)

  if (resp.errors.length > 0) {
    // [TODO] These are interesting to know but dont really change anything
  }
  return resp.result
}

function checkChainSlice(response: unknown): boolean {
  // [TODO] Type and range checking for a cycle chain slice
  if (!response) return false
  return true
}

function getActiveNodesLength(): number {
  return Object.keys(p2p.state.nodes.active).length
}

function processChainSlice(slice: Cycle[]) {
  // [TODO] Add nodes in chain slice to our node list
  // [TODO] Add chain slice to our cycle chain

  // Use the Old Ways for now

  // Add cycles
  p2p.state.addCycles(slice)

  // Parse cycles to get nodes to add to node list
}
