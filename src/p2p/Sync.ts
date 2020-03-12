import { Handler } from 'express'
import { promisify } from 'util'
import * as http from '../http'
import * as CycleChain from './CycleChain'
import { Cycle, UnfinshedCycle } from './CycleChain'
import { ChangeSquasher, parse } from './CycleParser'
import * as NodeList from './NodeList'
import { Route } from './p2p-types'
import { reversed, robustQuery, sequentialQuery } from './p2p-utils'
import { p2p } from './P2PContext'

/** TYPES */

export interface ActiveNode {
  ip: string
  port: number
  publicKey: string
}

/** ROUTES */

const newestCycleRoute: Route<Handler> = {
  method: 'GET',
  name: 'sync-newest-cycle',
  handler: (_req, res) => {
    const last = p2p.state.cycles.length - 1
    const newestCycle = p2p.state.cycles[last]
    res.json(newestCycle)
  },
}
const unfinishedCycleRoute: Route<Handler> = {
  method: 'GET',
  name: 'sync-unfinished-cycle',
  handler: (_req, res) => {
    const unfinishedCycle = p2p.state.currentCycle
    res.json(unfinishedCycle)
  },
}
const cyclesRoute: Route<Handler> = {
  method: 'POST',
  name: 'sync-cycles',
  handler: (req, res) => {
    const start = req.body.start | 0
    const end = req.body.end | 0
    const cycles = p2p.state.getCycles(start, end)
    res.json(cycles)
  },
}
export const externalRoutes = [
  newestCycleRoute,
  unfinishedCycleRoute,
  cyclesRoute,
]

/** FUNCTIONS */

export async function sync(activeNodes: ActiveNode[]) {
  // Get the networks newest cycle as the anchor point for sync
  const cycleToSyncTo = await getNewestCycle(activeNodes)
  console.log(`DBG Syncing till cycle ${cycleToSyncTo.counter}...`)
  CycleChain.append(cycleToSyncTo)

  // Sync old cycles until your active nodes === network active nodes
  const squasher = new ChangeSquasher()
  do {
    const prevCycles = await getCycles(
      activeNodes,
      CycleChain.oldest.counter - 100,
      CycleChain.oldest.counter
    )
    for (const prevCycle of reversed(prevCycles)) {
      CycleChain.validate(prevCycle, CycleChain.oldest)
      CycleChain.prepend(prevCycle)
      squasher.addChange(parse(prevCycle))
      if (squasher.final.updated.length >= cycleToSyncTo.active) {
        break
      }
    }
  } while (squasher.final.updated.length < cycleToSyncTo.active)
  NodeList.addNodes(
    squasher.final.added.map(joined => NodeList.createNode(joined))
  )
  NodeList.updateNodes(squasher.final.updated)
  console.log('DBG Synced to cycle', cycleToSyncTo.counter)

  // Add nodes to old p2p-state nodelist
  // [TODO] Remove this once eveything is using new NodeList.ts

  // Sync new cycles until you can get unfinished cycle data in time to start making cycles
  let unfinishedCycle: UnfinshedCycle
  console.log(
    `DBG Syncing cycles after ${cycleToSyncTo.counter} and unfinished cycle...`
  )
  do {
    if (unfinishedCycle) {
      console.log(
        `DBG waiting till end of cycle ${unfinishedCycle.data.counter}`
      )
      await waitUntilEnd(unfinishedCycle.data)
    }
    await syncNewCycles(activeNodes)
    console.log(`DBG got new cycles till ${CycleChain.newest.counter}`)
    unfinishedCycle = await getUnfinishedCycle(activeNodes)
    console.log('DBG got unfinishedCycle', JSON.stringify(unfinishedCycle))
  } while (
    CycleChain.newest.counter < unfinishedCycle.data.counter - 1 ||
    isInQuarter4(unfinishedCycle.data)
  )

  // Add cycle to old p2p-state cyclechain
  // [TODO] Remove this once everything is using new CycleChain.ts

  // Add unfinished cycle data and go active
  console.log('DBG Sync complete')
  console.log('DBG Starting cycles...')
  await p2p.state.addUnfinalizedAndStart(unfinishedCycle)
  console.log('DBG Cycles started')
}

async function syncNewCycles(activeNodes: ActiveNode[]) {
  let newestCycle = await getNewestCycle(activeNodes)
  while (CycleChain.newest.counter < newestCycle.counter) {
    const nextCycles = await getCycles(
      activeNodes,
      CycleChain.newest.counter,
      newestCycle.counter
    )
    for (const nextCycle of nextCycles) {
      CycleChain.validate(CycleChain.newest, nextCycle)
      CycleChain.append(nextCycle)
      const changes = parse(nextCycle)
      NodeList.removeNodes(changes.removed)
      NodeList.updateNodes(changes.updated)
      NodeList.addNodes(
        changes.added.map(joined => NodeList.createNode(joined))
      )
    }
    newestCycle = await getNewestCycle(activeNodes)
  }
}

async function getNewestCycle(activeNodes: ActiveNode[]): Promise<Cycle> {
  const queryFn = async (node: ActiveNode) => {
    const resp = await http.get(`${node.ip}:${node.port}/sync-newest-cycle`)
    return resp
  }
  const [response, _responders] = await robustQuery<ActiveNode>(
    activeNodes,
    queryFn
  )
  const newestCycle = response as Cycle
  return newestCycle
}
async function getCycles(
  activeNodes: ActiveNode[],
  start: number,
  end: number
): Promise<Cycle[]> {
  if (start < 0) start = 0
  if (end < 0) end = 0
  if (start > end) start = end
  const queryFn = async (node: ActiveNode) => {
    const resp = await http.post(`${node.ip}:${node.port}/sync-cycles`, {
      start,
      end,
    })
    return resp
  }
  const { result } = await sequentialQuery(activeNodes, queryFn)
  const cycles = result as Cycle[]
  return cycles
}
async function getUnfinishedCycle(
  activeNodes: ActiveNode[]
): Promise<UnfinshedCycle> {
  const queryFn = async (node: ActiveNode) => {
    const resp = await http.get(`${node.ip}:${node.port}/sync-unfinished-cycle`)
    return resp
  }
  const [response, _responders] = await robustQuery<ActiveNode>(
    activeNodes,
    queryFn
  )
  const unfinishedCycle = response as UnfinshedCycle
  return unfinishedCycle
}

async function waitUntilEnd(cycle: Cycle) {
  const cycleEnd = (cycle.start + cycle.duration) * 1000
  const now = Date.now()
  const toWait = cycleEnd > now ? cycleEnd - now : 0
  await sleep(toWait)
}
function isInQuarter4(cycle: Cycle): boolean {
  const quarter4Start = (cycle.start + (3 / 4) * cycle.duration) * 1000
  return Date.now() >= quarter4Start
}

const sleep = promisify(setTimeout)
