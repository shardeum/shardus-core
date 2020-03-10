import * as http from '../http'
import * as CycleChain from './CycleChain'
import { Cycle } from './CycleChain'
import { ChangeSquasher, parse } from './CycleParser'
import * as NodeList from './NodeList'
import { reversed, robustQuery, sequentialQuery } from './p2p-utils'
import { p2p } from './P2PContext'
import { Route } from './p2p-types'
import { Handler } from 'express'

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

export const externalRoutes = [newestCycleRoute, cyclesRoute]

/** FUNCTIONS */

export async function sync(activeNodes: ActiveNode[]) {
  console.log('DBG', 'Started Sync > sync...')

  // Get the networks newest cycle as the anchor point for sync
  const newestCycle = await getNewestCycle(activeNodes)
  console.log('DBG', 'newestCycle', newestCycle)
  CycleChain.append(newestCycle)

  // Sync old cycles until your active nodes === network active nodes
  const squasher = new ChangeSquasher()
  do {
    const prevCycles = await getCycles(
      activeNodes,
      CycleChain.oldest.counter - 100,
      CycleChain.oldest.counter
    )
    console.log('DBG', 'prevCycles', JSON.stringify(prevCycles))
    for (const prevCycle of reversed(prevCycles)) {
      CycleChain.validate(prevCycle, CycleChain.oldest)
      CycleChain.prepend(prevCycle)
      console.log('DBG', 'parse(prevCycle)', parse(prevCycle))
      squasher.addChange(parse(prevCycle))
      if (squasher.final.updated.length >= newestCycle.active) {
        break
      }
    }

    console.log('DBG', 'squasher.final.updated.length', squasher.final.updated.length)

  } while (squasher.final.updated.length < newestCycle.active)
  NodeList.addNodes(
    squasher.final.added.map(joined => NodeList.createNode(joined))
  )
  NodeList.updateNodes(squasher.final.updated)

  // Sync new cycles until you can get unfinished cycle data in time to start making cycles
  await syncNewCycles(activeNodes)

  let unfinishedCycle = await getUnfinishedCycle(activeNodes)
  while (
    CycleChain.newest.counter < unfinishedCycle.counter - 1 ||
    isInQuarter4(unfinishedCycle)
  ) {
    await waitUntilEnd(unfinishedCycle)
    await syncNewCycles(activeNodes)
    unfinishedCycle = await getUnfinishedCycle(activeNodes)
  }

  // [TODO] Add unfinished cycle data and go active
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
    const resp = await http.post(`${node.ip}:${node.port}/sync-cycles`, { start, end })
    return resp
  }
  const { result } = await sequentialQuery(activeNodes, queryFn)
  const cycles = result as Cycle[]
  return cycles
}
async function getUnfinishedCycle(activeNodes): Promise<Cycle> {
  // [TODO]
  return {} as Cycle
}

async function waitUntilEnd(cycle: Cycle) {
  // [TODO]
}
function isInQuarter4(cycle: Cycle): boolean {
  // [TODO]
  return true
}
