import { Handler } from 'express'
import { Logger } from 'log4js'
import * as http from '../http'
import { reversed, validateTypes } from '../utils'
import { logger, network } from './Context'
import * as CycleChain from './CycleChain'
import * as CycleCreator from './CycleCreator'
import { Change, ChangeSquasher, parse } from './CycleParser'
import * as NodeList from './NodeList'
import * as Self from './Self'
import { Route } from './Types'
import { robustQuery, sequentialQuery } from './Utils'
import util from 'util'

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
    let err = validateTypes(req, { body: 'o' })
    if (err) {
      warn('sync-cycles bad req ' + err)
      res.json([])
      return
    }
    err = validateTypes(req.body, { start: 'n?', end: 'n?' })
    if (err) {
      warn('sync-cycles bad req.body ' + err)
      res.json([])
      return
    }
    const start = req.body.start | 0
    const end = req.body.end
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
  // Flush existing cycles/nodes
  CycleChain.reset()
  NodeList.reset()

  // Get the networks newest cycle as the anchor point for sync
  info('Getting newest cycle...')
  const cycleToSyncTo = await getNewestCycle(activeNodes)
  info(`Syncing till cycle ${cycleToSyncTo.counter}...`)
  const cyclesToGet = 2 * Math.floor(Math.sqrt(cycleToSyncTo.active)) + 2
  info(`Cycles to get is ${cyclesToGet}`)

  // Sync old cycles until your active nodes === network active nodes
  const squasher = new ChangeSquasher()

  CycleChain.prepend(cycleToSyncTo)
  squasher.addChange(parse(CycleChain.oldest))

  do {
    // Get prevCycles from the network
    const end = CycleChain.oldest.counter - 1
    const start = end - cyclesToGet
    info(`Getting cycles ${start} - ${end}...`)
    const prevCycles = await getCycles(activeNodes, start, end)
    info(
      `Got cycles ${JSON.stringify(prevCycles.map((cycle) => cycle.counter))}`
    )
    info(`  ${JSON.stringify(prevCycles)}`)

    // If prevCycles is empty, start over
    if (prevCycles.length < 1) throw new Error('Got empty previous cycles')

    // Add prevCycles to our cycle chain
    let prepended = 0

    for (const prevCycle of reversed(prevCycles)) {
      const marker = CycleChain.computeCycleMarker(prevCycle)
      // If you already have this cycle, skip it
      if (CycleChain.cyclesByMarker[marker]) {
        warn(`Record ${prevCycle.counter} already in cycle chain`)
        continue
      }
      // Stop prepending prevCycles if one of them is invalid
      if (CycleChain.validate(prevCycle, CycleChain.oldest) === false) {
        warn(`Record ${prevCycle.counter} failed validation`)
        break
      }
      // Prepend the cycle to our cycle chain
      CycleChain.prepend(prevCycle)
      squasher.addChange(parse(prevCycle))
      prepended++

      if (
        squasher.final.updated.length >= activeNodeCount(cycleToSyncTo) &&
        squasher.final.added.length >= totalNodeCount(cycleToSyncTo)
      ) {
        break
      }
    }

    info(
      `Got ${
        squasher.final.updated.length
      } active nodes, need ${activeNodeCount(cycleToSyncTo)}`
    )
    info(
      `Got ${squasher.final.added.length} total nodes, need ${totalNodeCount(
        cycleToSyncTo
      )}`
    )
    if (squasher.final.added.length < totalNodeCount(cycleToSyncTo))
      info(
        'Short on nodes. Need to get more cycles. Cycle:' +
          cycleToSyncTo.counter
      )
    //    showNodeCount(cycleToSyncTo)

    // If you weren't able to prepend any of the prevCycles, start over
    if (prepended < 1) throw new Error('Unable to prepend any previous cycles')
  } while (
    squasher.final.updated.length < activeNodeCount(cycleToSyncTo) ||
    squasher.final.added.length < totalNodeCount(cycleToSyncTo)
  )

  // Now that our node list is synced, validate the anchor cycle's cert
  // [TODO] [AS]
  /**
   * Commented this out for now; we need to change the logic to look at the cert
   * instead of the marker, and to compare:
   *   (anchor cycle) with (anchor cycle - 1)
   * instead of:
   *   (anchor cycle) with (latest cycle)
   */
  /*
  let nodesToQuery = squasher.final.added.map(node => ({
    ip: node.externalIp,
    port: node.externalPort,
    publicKey: node.publicKey
  }))
  let anchorCycleFromNetwork = await getNewestCycle(nodesToQuery)
  let cycleToSyncMarker = CycleChain.computeCycleMarker(cycleToSyncTo)
  let markerFromNetwork = CycleChain.computeCycleMarker(anchorCycleFromNetwork)

  info('cycleToSyncMarker', cycleToSyncMarker)
  info('markerFromNetwork', markerFromNetwork)

  // If the anchor cycle was invalid, start over
  if (cycleToSyncMarker !== markerFromNetwork) {
    warn(`Anchor cycle's cert is different from other nodes in the network`)
    return false
  }
  */

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
  warn(`myNewest=${CycleChain.newest.counter} netNewest=${newestCycle.counter}`)
  while (CycleChain.newest.counter < newestCycle.counter) {
    const nextCycles = await getCycles(
      activeNodes,
      CycleChain.newest.counter + 1 // [DONE] maybe we should +1 so that we don't get the record we already have
    )
    for (const nextCycle of nextCycles) {
      //      CycleChain.validate(CycleChain.newest, newestCycle)
      if (CycleChain.validate(CycleChain.newest, nextCycle))
        await digestCycle(nextCycle)
      else
        error(
          `syncNewCycles next record does not fit with prev record.\nnext: ${JSON.stringify(
            CycleChain.newest
          )}\nprev: ${JSON.stringify(newestCycle)}`
        )
      // [TODO] If we ever hit this, we should return from here after setting
      //        a timeout to run syncNewCycles function again. Maybe also through away
      //        the most recent record we have in case it was bad.
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

  applyNodeListChange(parse(cycle))
  CycleChain.append(cycle)

  info(`
    Digested C${cycle.counter}
      cycle record: ${JSON.stringify(cycle)}
      node list: ${JSON.stringify([...NodeList.nodes.values()])}
      active nodes: ${JSON.stringify(NodeList.activeByIdOrder)}
  `)
}

function applyNodeListChange(change: Change) {
  NodeList.addNodes(change.added.map((joined) => NodeList.createNode(joined)))
  NodeList.updateNodes(change.updated)
  NodeList.removeNodes(change.removed)
}

export async function getNewestCycle(
  activeNodes: SyncNode[]
): Promise<CycleCreator.CycleRecord> {
  const queryFn = async (node: SyncNode) => {
    const ip = node.ip ? node.ip : node.externalIp
    const port = node.port ? node.port : node.externalPort
    // the queryFunction must return null if the given node is our own
    // while syncing nodeList we dont have node.id, so use ip and port
    if (ip === Self.ip && port === Self.port) return null
    const resp = await http.get(`${ip}:${port}/sync-newest-cycle`)
    return resp
  }
  const eqFn = (item1, item2) => {
    console.log(`item is: ${JSON.stringify(item1)}`)
    try {
      if (item1.newestCycle.counter === item2.newestCycle.counter) return true
      return false
    } catch (err) {
      return false
    }
  }
  let redundancy = 1
  if (activeNodes.length > 5) redundancy = 2
  if (activeNodes.length > 10) redundancy = 3
  //const [response, _responders] = await robustQuery(activeNodes, queryFn)
  const [response, _responders] = await robustQuery(
    activeNodes,
    queryFn,
    eqFn,
    redundancy,
    true
  )
  console.log(`response is: ${JSON.stringify(response)}`)

  // [TODO] Validate response
  if (!response) throw new Error('Bad response')
  if (!response.newestCycle) throw new Error('Bad response')

  const newestCycle = response.newestCycle as CycleCreator.CycleRecord
  return newestCycle
}

// This tries to get the cycles with counter from start to end inclusively.
async function getCycles(
  activeNodes: SyncNode[],
  start: number,
  end?: number
): Promise<CycleCreator.CycleRecord[]> {
  if (start < 0) start = 0
  if (end !== undefined){
      if (start > end) start = end
  }
  let data : {start: number, end?: number} = {start}
  if (end !== undefined) data.end = end
  const queryFn = async (node: SyncNode) => {
    const ip = node.ip ? node.ip : node.externalIp
    const port = node.port ? node.port : node.externalPort
    const resp = await http.post(`${ip}:${port}/sync-cycles`, data)
    return resp
  }

  info(`getCycles: ${start} - ${end}...`)

  // use robust query so we can ask less nodes to get the cycles
  let redundancy = 1
  if (activeNodes.length > 5) redundancy = 2
  if (activeNodes.length > 10) redundancy = 3
  const [response, _responders] = await robustQuery(activeNodes, queryFn, util.isDeepStrictEqual, redundancy, true  ) 

  // [TODO] Validate whatever came in
  const cycles = response as CycleCreator.CycleRecord[]
  return cycles
}

export function activeNodeCount(cycle: CycleCreator.CycleRecord) {
  return (
    cycle.active +
    cycle.activated.length -
    cycle.apoptosized.length -
    cycle.removed.length -
    cycle.lost.length
  )
}

export function showNodeCount(cycle: CycleCreator.CycleRecord) {
  warn(` syncing + joined + active - apop - rem - lost
    ${cycle.syncing} +
    ${cycle.joinedConsensors.length} +
    ${cycle.active} +
    ${cycle.apoptosized.length} -
    ${cycle.removed.length} -
    ${cycle.lost.length}
    ${cycle.counter}
  `)
  //    ${cycle.activated.length} -
}

export function totalNodeCount(cycle: CycleCreator.CycleRecord) {
  return (
    cycle.syncing +
    cycle.joinedConsensors.length +
    cycle.active +
    //    cycle.activated.length -      // don't count activated because it was already counted in syncing
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
