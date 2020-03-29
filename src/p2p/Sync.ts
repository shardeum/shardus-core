import { Handler } from 'express'
import { promisify } from 'util'
import * as http from '../http'
import { p2p } from './Context'
import * as CycleChain from './CycleChain'
import { UnfinshedCycle } from './CycleChain'
import { ChangeSquasher, parse } from './CycleParser'
import * as NodeList from './NodeList'
import { Route } from './Types'
import { reversed, robustQuery, sequentialQuery } from './Utils'
import { Node } from './p2p-state' 
import { CycleRecord } from "./CycleCreator";
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
    const unfinishedCycle = p2p.state.unfinalizedReady
      ? p2p.state.currentCycle
      : null
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
  // If you are the first node, return
  if (p2p.isFirstSeed) {
    info('First node, no syncing required')
    p2p.acceptInternal = true
    return true
  }

  // Flush old cycles/nodes
  p2p.state._resetState()
  CycleChain.reset()
  NodeList.reset()

  // Get the networks newest cycle as the anchor point for sync
  info(`Getting newest cycle...`)
  const cycleToSyncTo = await getNewestCycle(activeNodes)
  info(`Syncing till cycle ${cycleToSyncTo.counter}...`)

  // Sync old cycles until your active nodes === network active nodes
  const squasher = new ChangeSquasher()
  do {
    const oldestCycle = CycleChain.oldest || cycleToSyncTo
    const prevCycles = await getCycles(
      activeNodes,
      oldestCycle.counter - 100,
      oldestCycle.counter
    )
    for (const prevCycle of reversed(prevCycles)) {
      CycleChain.validate(prevCycle, oldestCycle)
      CycleChain.prepend(prevCycle)
      squasher.addChange(parse(prevCycle))
      if (
        squasher.final.updated.length >= activeNodeCount(cycleToSyncTo)
      ) {
        break
      }
    }
  } while (
    squasher.final.updated.length < activeNodeCount(cycleToSyncTo)
  )
  await NodeList.addNodes(
    squasher.final.added.map(joined => NodeList.createNode(joined))
  )
  await NodeList.updateNodes(squasher.final.updated)
  info('Synced to cycle', cycleToSyncTo.counter)

  // Add synced cycles to old p2p-state cyclechain
  // [TODO] Remove this once everything is using new CycleChain.ts
  p2p.state.addCycles(CycleChain.cycles)

  // Sync new cycles until you can get unfinished cycle data in time to start making cycles
  let unfinishedCycle: UnfinshedCycle
  do {
    const nextCounter = CycleChain.newest.counter + 1
    if (isBeforeNextQuarter4(CycleChain.newest)) {
      info(`waiting until quarter 4 of unfinished cycle ${nextCounter}...`)
      await waitUntilNextQuarter4(CycleChain.newest)
      try {
        info(`getting unfinished cycle data...`)
        unfinishedCycle = await getUnfinishedCycle(activeNodes)
        info(`got unfinishedCycle: ${JSON.stringify(unfinishedCycle)}`)
      } catch (err) {
        error(err)
        info(`trying again...`)
      }
    } else {
      info(`waiting until end of unfinished cycle ${nextCounter}...`)
      await waitUntilNextEnd(CycleChain.newest)
      info(`syncing new cycles...`)
      await syncNewCycles(activeNodes)
    }
  } while (!unfinishedCycle)

  // Add unfinished cycle data and go active
  p2p.acceptInternal = true
  await p2p.state.addUnfinalizedAndStart(unfinishedCycle)
  info('Sync complete')
  return true
}

type SyncNode = Partial<Pick<ActiveNode, 'ip'|'port'> & Pick<NodeList.Node, 'externalIp'|'externalPort'>>

export async function syncNewCycles(activeNodes: SyncNode[]) {
  let newestCycle = await getNewestCycle(activeNodes)
  while (CycleChain.newest.counter < newestCycle.counter) {
    const nextCycles = await getCycles(
      activeNodes,
      CycleChain.newest.counter,
      newestCycle.counter
    )
    for (const nextCycle of nextCycles) {
      CycleChain.validate(CycleChain.newest, newestCycle)
      CycleChain.append(newestCycle)
      await digestCycle(nextCycle)
    }
    newestCycle = await getNewestCycle(activeNodes)
  }
}

export async function digestCycle(cycle: CycleRecord) {
  const changes = parse(cycle)
  NodeList.removeNodes(changes.removed)
  await NodeList.updateNodes(changes.updated)
  await NodeList.addNodes(
    changes.added.map(joined => NodeList.createNode(joined))
  )
}

async function getNewestCycle(activeNodes: SyncNode[]): Promise<CycleRecord> {
  const queryFn = async (node: SyncNode) => {
    const ip = node.ip ? node.ip : node.externalIp
    const port = node.ip ? node.ip : node.externalIp
    const resp = await http.get(`${ip}:${port}/sync-newest-cycle`)
    return resp
  }
  const [response, _responders] = await robustQuery(
    activeNodes,
    queryFn
  )
  const newestCycle = response as CycleRecord
  return newestCycle
}
async function getCycles(
  activeNodes: SyncNode[],
  start: number,
  end: number
): Promise<CycleRecord[]> {
  if (start < 0) start = 0
  if (end < 0) end = 0
  if (start > end) start = end
  const queryFn = async (node: SyncNode) => {
    const ip = node.ip ? node.ip : node.externalIp
    const port = node.ip ? node.ip : node.externalIp
    const resp = await http.post(`${ip}:${port}/sync-cycles`, {
      start,
      end,
    })
    return resp
  }
  const { result } = await sequentialQuery(activeNodes, queryFn)
  const cycles = result as CycleRecord[]
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

function isBeforeNextQuarter4(cycle: CycleRecord): boolean {
  const nextStart = cycle.start + cycle.duration
  const nextQuarter3Start = (nextStart + (3 / 4) * cycle.duration) * 1000
  return Date.now() <= nextQuarter3Start
}
async function waitUntilNextEnd(cycle: CycleRecord) {
  const cycleEnd = cycle.start + cycle.duration
  const nextEnd = (cycleEnd + cycle.duration) * 1000
  const now = Date.now()
  const toWait = nextEnd > now ? nextEnd - now : 0
  await sleep(toWait)
}
async function waitUntilNextQuarter4(cycle: CycleRecord) {
  const nextStart = cycle.start + cycle.duration
  const nextQuarter3Start = (nextStart + (3 / 4) * cycle.duration) * 1000
  const now = Date.now()
  const toWait = nextQuarter3Start > now ? nextQuarter3Start - now : 0
  await sleep(toWait)
}

function activeNodeCount(cycle: CycleRecord) {
  return cycle.active + cycle.activated.length - cycle.apoptosized.length - cycle.removed.length - cycle.lost.length
}

function info(...msg) {
  const entry = `Sync: ${msg.join(' ')}`
  p2p.mainLogger.info(entry)
}

function error(...msg) {
  const entry = `Sync: ${msg.join(' ')}`
  p2p.mainLogger.error(entry)
}

const sleep = promisify(setTimeout)
