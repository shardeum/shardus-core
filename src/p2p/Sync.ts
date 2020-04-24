import { Handler } from 'express'
import { Logger } from 'log4js'
import * as http from '../http'
import { sleep } from '../utils'
import { logger, network } from './Context'
import * as CycleChain from './CycleChain'
import * as CycleCreator from './CycleCreator'
import { Change, ChangeSquasher, parse } from './CycleParser'
import * as NodeList from './NodeList'
import * as Refresh from './Refresh'
import { Route } from './Types'
import { reversed, robustQuery, sequentialQuery } from './Utils'

/** TYPES */

export interface ActiveNode {
  ip: string
  port: number
  publicKey: string
}

/** STATE */

let p2pLogger: Logger

/** ROUTES */

const newestCycleRoute: Route<Handler> = {
  method: 'GET',
  name: 'sync-newest-cycle',
  handler: (_req, res) => {
    const newestCycle = CycleChain.newest ? CycleChain.newest : undefined
    res.json({ newestCycle })
  },
}

const cyclesRoute: Route<Handler> = {
  method: 'POST',
  name: 'sync-cycles',
  handler: (req, res) => {
    const start = req.body.start | 0
    const end = req.body.end | 0
    // const cycles = p2p.state.getCycles(start, end)
    const cycles = CycleChain.getCycleChain(start, end)
    res.json(cycles)
  },
}

const routes = {
  external: [newestCycleRoute /** unfinishedCycleRoute */, cyclesRoute],
}

/** FUNCTIONS */

export function init() {
  p2pLogger = logger.getLogger('p2p')

  for (const route of routes.external) {
    network._registerExternal(route.method, route.name, route.handler)
  }
}

export async function sync(activeNodes: ActiveNode[]) {
  // If you are the first node, return
  // if (p2p.isFirstSeed) {
  //   info('First node, no syncing required')
  //   p2p.acceptInternal = true
  //   return true
  // }

  // Flush old cycles/nodes
  // p2p.state._resetState()
  CycleChain.reset()
  NodeList.reset()

  // Sync old cycles until your active nodes === network active nodes
  let gotPrevCycles = false
  let cycleToSyncTo: CycleCreator.CycleRecord
  let cyclesToGet: number
  const squasher = new ChangeSquasher()
  do {
    if (gotPrevCycles === false) {
      // Get the networks newest cycle as the anchor point for sync
      info(`Getting newest cycle...`)
      cycleToSyncTo = await getNewestCycle(activeNodes)
      info(`Syncing till cycle ${cycleToSyncTo.counter}...`)
      cyclesToGet = Refresh.getRefreshCount(cycleToSyncTo.active) + 5
    }

    const oldestCycle = CycleChain.oldest || cycleToSyncTo
    const prevCycles = await getCycles(
      activeNodes,
      oldestCycle.counter - cyclesToGet,
      oldestCycle.counter
    )

    gotPrevCycles = prevCycles.length < 1
    if (gotPrevCycles === false) {
      await sleep(1000)
    }

    for (const prevCycle of reversed(prevCycles)) {
      CycleChain.validate(prevCycle, oldestCycle)
      CycleChain.prepend(prevCycle)
      squasher.addChange(parse(prevCycle))
      if (squasher.final.updated.length >= activeNodeCount(cycleToSyncTo)) {
        break
      }
    }
  } while (squasher.final.updated.length < activeNodeCount(cycleToSyncTo))
  applyNodeListChange(squasher.final)
  info('Synced to cycle', cycleToSyncTo.counter)
  info(
    `Sync complete; ${NodeList.activeByIdOrder.length} active nodes; ${CycleChain.cycles.length} cycles`
  )
  info(`NodeList after sync: ${JSON.stringify([...NodeList.nodes.entries()])}`)
  info(`CycleChain after sync: ${JSON.stringify(CycleChain.cycles)}`)
  return true
}

type SyncNode = Partial<
  Pick<ActiveNode, 'ip' | 'port'> &
    Pick<NodeList.Node, 'externalIp' | 'externalPort'>
>

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
      await digestCycle(nextCycle)
    }
    newestCycle = await getNewestCycle(activeNodes)
  }
}

export function digestCycle(cycle: CycleCreator.CycleRecord) {
  const marker = CycleCreator.makeCycleMarker(cycle)
  if (CycleChain.cyclesByMarker[marker]) {
    warn(
      `Tried to digest cycle record twice: ${JSON.stringify(cycle)}\n` +
        `${new Error().stack}`
    )
    return
  }

  info(`
    Digested C${cycle.counter}
      cycle record: ${JSON.stringify(cycle)}
      node list: ${JSON.stringify([...NodeList.nodes.values()])}
      active nodes: ${JSON.stringify(NodeList.activeByIdOrder)}
  `)

  applyNodeListChange(parse(cycle))
  CycleChain.append(cycle)
}

function applyNodeListChange(change: Change) {
  NodeList.addNodes(change.added.map(joined => NodeList.createNode(joined)))
  NodeList.updateNodes(change.updated)
  NodeList.removeNodes(change.removed)
}

async function getNewestCycle(
  activeNodes: SyncNode[]
): Promise<CycleCreator.CycleRecord> {
  const queryFn = async (node: SyncNode) => {
    const ip = node.ip ? node.ip : node.externalIp
    const port = node.port ? node.port : node.externalPort
    const resp = await http.get(`${ip}:${port}/sync-newest-cycle`)
    return resp
  }
  const [response, _responders] = await robustQuery(activeNodes, queryFn)

  // [TODO] Validate response
  if (!response) throw new Error('Bad response')
  if (!response.newestCycle) throw new Error('Bad response')

  const newestCycle = response.newestCycle as CycleCreator.CycleRecord
  return newestCycle
}
async function getCycles(
  activeNodes: SyncNode[],
  start: number,
  end: number
): Promise<CycleCreator.CycleRecord[]> {
  if (start < 0) start = 0
  if (end < 0) end = 0
  if (start > end) start = end
  const queryFn = async (node: SyncNode) => {
    const ip = node.ip ? node.ip : node.externalIp
    const port = node.port ? node.port : node.externalPort
    const resp = await http.post(`${ip}:${port}/sync-cycles`, {
      start,
      end,
    })
    return resp
  }
  const { result } = await sequentialQuery(activeNodes, queryFn)
  const cycles = result as CycleCreator.CycleRecord[]
  return cycles
}

function activeNodeCount(cycle: CycleCreator.CycleRecord) {
  return (
    cycle.active +
    cycle.activated.length -
    cycle.apoptosized.length -
    cycle.removed.length -
    cycle.lost.length
  )
}

function info(...msg) {
  const entry = `Sync: ${msg.join(' ')}`
  p2pLogger.info(entry)
}

function warn(...msg) {
  const entry = `Sync: ${msg.join(' ')}`
  p2pLogger.warn(entry)
}

function error(...msg) {
  const entry = `Sync: ${msg.join(' ')}`
  p2pLogger.error(entry)
}
