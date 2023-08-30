import { Handler } from 'express'
import { Logger } from 'log4js'
import util from 'util'
import * as http from '../http'
import { P2P } from '@shardus/types'
import { reversed, validateTypes } from '../utils'
import { config, logger, network } from './Context'
import * as Archivers from './Archivers'
import * as CycleChain from './CycleChain'
import * as CycleCreator from './CycleCreator'
import { ChangeSquasher, parse } from './CycleParser'
import * as NodeList from './NodeList'
import * as Self from './Self'
import { robustQuery } from './Utils'
import { profilerInstance } from '../utils/profiler'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { byJoinOrder } from './NodeList'

/** STATE */

let p2pLogger: Logger

/** ROUTES */

const newestCycleRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'sync-newest-cycle',
  handler: (_req, res) => {
    profilerInstance.scopedProfileSectionStart('sync-newest-cycle')
    const newestCycle = CycleChain.newest || null
    res.json({ newestCycle })
    profilerInstance.scopedProfileSectionEnd('sync-newest-cycle')
  },
}

const cyclesRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'POST',
  name: 'sync-cycles',
  handler: (req, res) => {
    profilerInstance.scopedProfileSectionStart('sync-cycles')
    try {
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
    } catch (e) {
      warn('sync-cycles', e)
    } finally {
      profilerInstance.scopedProfileSectionEnd('sync-cycles')
    }
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

export async function sync(activeNodes: P2P.SyncTypes.ActiveNode[]) {
  // Flush existing cycles/nodes
  CycleChain.reset()
  NodeList.reset()

  nestedCountersInstance.countEvent('p2p', `sync-start`)

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

  nestedCountersInstance.countEvent('p2p', `sync-to-cycle ${cycleToSyncTo.counter}`)

  do {
    // Get prevCycles from the network
    const end = CycleChain.oldest.counter - 1
    const start = end - cyclesToGet
    info(`Getting cycles ${start} - ${end}...`)
    nestedCountersInstance.countEvent('p2p', `sync-getting-cycles ${start} - ${end}`)
    const prevCycles = await getCycles(activeNodes, start, end)
    info(`Got cycles ${JSON.stringify(prevCycles.map((cycle) => cycle.counter))}`)
    info(`  ${JSON.stringify(prevCycles)}`)

    // If prevCycles is empty, start over
    if (prevCycles.length < 1) {
      nestedCountersInstance.countEvent('p2p', `sync-getting-cycles failed to get ${start} - ${end}`)

      //add some code to detect which nodes we are actually missing
      let missing = []
      for (let node of byJoinOrder) {
        if (squasher.addedIds.has(node.id) === false) {
          missing.push(node)
        }
      }
      let totalNodes = totalNodeCount(cycleToSyncTo)
      let squasherTotal = squasher.final.added.length
      let expectedMissing = totalNodes - squasherTotal
      let missingListCount = missing.length
      //if there are more than five nodes in the missingn list truncate it to just five
      if (missing.length > 5) {
        missing = missing.slice(0, 5)
      }
      let missingList = missing.map((node) => {
        return { id: node.id, externalIp: node.externalIp, externalPort: node.externalPort }
      })

      let missingStr = 'none detected'
      if (missingListCount > 0) {
        missingStr = JSON.stringify(missingList[0])
      }

      /* prettier-ignore */ nestedCountersInstance.countEvent( 'p2p', `sync-getting-cycles failed to get ${start} - ${end}  expectedMissing:${expectedMissing} missingListCount:${missingListCount} missing:${missingStr}` )
      /* prettier-ignore */ error( `sync-getting-cycles failed to get ${start} - ${end}  expectedMissing:${expectedMissing} missingListCount:${missingListCount}` + JSON.stringify(missingList) )

      if (config.p2p.hackForceCycleSyncComplete === true && missingListCount === 0) {
        /* prettier-ignore */ nestedCountersInstance.countEvent( 'p2p', `hack-fix: go active missing count is 0`)
        /* prettier-ignore */ error( `hack-fix: go active missing count is 0`)
        return true
      }

      throw new Error('Got empty previous cycles')
    }

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

    info(`Got ${squasher.final.updated.length} active nodes, need ${activeNodeCount(cycleToSyncTo)}`)
    info(`Got ${squasher.final.added.length} total nodes, need ${totalNodeCount(cycleToSyncTo)}`)
    if (squasher.final.added.length < totalNodeCount(cycleToSyncTo))
      info('Short on nodes. Need to get more cycles. Cycle:' + cycleToSyncTo.counter)
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

  applyNodeListChange(squasher.final, false, null)

  info('Synced to cycle', cycleToSyncTo.counter)
  info(`Sync complete; ${NodeList.activeByIdOrder.length} active nodes; ${CycleChain.cycles.length} cycles`)
  info(`NodeList after sync: ${JSON.stringify([...NodeList.nodes.entries()])}`)
  info(`CycleChain after sync: ${JSON.stringify(CycleChain.cycles)}`)

  const p2pSyncReport = {
    cycle: cycleToSyncTo.counter,
    activeNodes: NodeList.activeByIdOrder.length,
    cyclesSynced: CycleChain.cycles.length,
  }
  nestedCountersInstance.countEvent('p2p', `Sync cyclechain complete; ${JSON.stringify(p2pSyncReport)}`)

  return true
}

type SyncNode = Partial<
  Pick<P2P.SyncTypes.ActiveNode, 'ip' | 'port'> & Pick<P2P.NodeListTypes.Node, 'externalIp' | 'externalPort'>
>

export async function syncNewCycles(activeNodes: SyncNode[]) {
  let newestCycle = await getNewestCycle(activeNodes)
  warn(`myNewest=${CycleChain.newest.counter} netNewest=${newestCycle.counter}`)

  const progressHistory = 5
  const maxAttempts = 10
  let progress = []
  let attempt = 0

  while (CycleChain.newest.counter < newestCycle.counter) {
    const nextCycles = await getCycles(
      activeNodes,
      CycleChain.newest.counter + 1 // [DONE] maybe we should +1 so that we don't get the record we already have
    )

    const oldCounter = CycleChain.newest.counter
    for (const nextCycle of nextCycles) {
      //      CycleChain.validate(CycleChain.newest, newestCycle)
      if (CycleChain.validate(CycleChain.newest, nextCycle)) await digestCycle(nextCycle)
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
    const newCounter = CycleChain.newest.counter

    // Check progress history and number of attempts to stop tight loops
    progress[attempt % progressHistory] = newCounter - oldCounter
    if (progress.reduce((prev, curr) => prev + curr, 0) <= 0) {
      warn(`syncNewCycles: no progress in the last ${progressHistory} attempts`)
      return
    }
    if (attempt >= maxAttempts - 1) {
      warn(`syncNewCycles: exceeded max ${maxAttempts} attempts`)
      return
    }

    attempt++
    newestCycle = await getNewestCycle(activeNodes)
  }
}

export function digestCycle(cycle: P2P.CycleCreatorTypes.CycleRecord) {
  // get the node list hashes *before* applying node changes
  if (config.p2p.useSyncProtocolV2 || config.p2p.writeSyncProtocolV2) {
    cycle.nodeListHash = NodeList.computeNewNodeListHash()
    cycle.archiverListHash = Archivers.computeNewArchiverListHash()
  }

  const marker = CycleCreator.makeCycleMarker(cycle)
  if (CycleChain.cyclesByMarker[marker]) {
    warn(`Tried to digest cycle record twice: ${JSON.stringify(cycle)}\n` + `${new Error().stack}`)
    return
  }

  const changes = parse(cycle)
  applyNodeListChange(changes, true, cycle)

  CycleChain.append(cycle)

  let nodeLimit = 2 //todo set this to a higher number, but for now I want to make sure it works in a small test
  if (NodeList.activeByIdOrder.length <= nodeLimit) {
    info(`
      Digested C${cycle.counter}
        cycle record: ${JSON.stringify(cycle)}
        cycle changes: ${JSON.stringify(changes)}
        node list: ${JSON.stringify([...NodeList.nodes.values()])}
        active nodes: ${JSON.stringify(NodeList.activeByIdOrder)}
    `)
  } else {
    info(`
    Digested C${cycle.counter}
      cycle record: ${JSON.stringify(cycle)}
      cycle changes: ${JSON.stringify(changes)}
      node list: too many to list: ${NodeList.nodes.size}
      active nodes: too many to list: ${NodeList.activeByIdOrder.length}
    `)
  }
}

function applyNodeListChange(
  change: P2P.CycleParserTypes.Change,
  raiseEvents: boolean,
  cycle: P2P.CycleCreatorTypes.CycleRecord | null
) {
  NodeList.addNodes(change.added.map((joined) => NodeList.createNode(joined)))
  NodeList.updateNodes(change.updated, raiseEvents, cycle)
  NodeList.removeNodes(change.removed, raiseEvents, cycle)
}

export async function getNewestCycle(activeNodes: SyncNode[]): Promise<P2P.CycleCreatorTypes.CycleRecord> {
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
  const { topResult: response, winningNodes: _responders } = await robustQuery(
    activeNodes,
    queryFn,
    eqFn,
    redundancy,
    true
  )
  console.log(`response is: ${JSON.stringify(response)}`)

  // [TODO] Validate response
  if (!response) throw new Error('Bad response: no response')
  if (!response.newestCycle) throw new Error('Bad response: no newestCycle')

  const newestCycle = response.newestCycle as P2P.CycleCreatorTypes.CycleRecord
  return newestCycle
}

// This tries to get the cycles with counter from start to end inclusively.
async function getCycles(
  activeNodes: SyncNode[],
  start: number,
  end?: number
): Promise<P2P.CycleCreatorTypes.CycleRecord[]> {
  if (start < 0) start = 0
  if (end !== undefined) {
    if (start > end) start = end
  }
  const data: {
    start: number
    end?: number
  } = { start }
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
  const { topResult: response, winningNodes: _responders } = await robustQuery(
    activeNodes,
    queryFn,
    util.isDeepStrictEqual,
    redundancy,
    true
  )

  // [TODO] Validate whatever came in
  const cycles = response as P2P.CycleCreatorTypes.CycleRecord[]

  const valid = validateCycles(cycles)
  if (valid) return cycles
}

export function activeNodeCount(cycle: P2P.CycleCreatorTypes.CycleRecord) {
  return (
    cycle.active +
    cycle.activated.length +
    -cycle.apoptosized.length +
    -cycle.removed.length +
    -cycle.lost.length
  )
}

export function showNodeCount(cycle: P2P.CycleCreatorTypes.CycleRecord) {
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

export function totalNodeCount(cycle: P2P.CycleCreatorTypes.CycleRecord) {
  return (
    cycle.syncing +
    cycle.joinedConsensors.length +
    cycle.active +
    //    cycle.activated.length -      // don't count activated because it was already counted in syncing
    -cycle.apoptosized.length +
    -cycle.removed.length
    // -cycle.lost.length
  )
}

function validateCycles(cycles: P2P.CycleCreatorTypes.CycleRecord[]) {
  const archiverType = {
    publicKey: 's',
    ip: 's',
    port: 'n',
    curvePk: 's',
  }
  for (const cycleRecord of cycles) {
    let err = validateTypes(cycleRecord, {
      safetyMode: 'b',
      safetyNum: 'n',
      networkStateHash: 's',
      refreshedArchivers: 'a',
      refreshedConsensors: 'a',
      joinedArchivers: 'a',
      leavingArchivers: 'a',
      syncing: 'n',
      joinedConsensors: 'a',
      active: 'n',
      activated: 'a',
      activatedPublicKeys: 'a',
      lost: 'a',
      refuted: 'a',
      joined: 'a',
      returned: 'a',
      apoptosized: 'a',
      networkDataHash: 'a',
      networkReceiptHash: 'a',
      networkSummaryHash: 'a',
      desired: 'n',
    })
    if (err) {
      warn('Type validation failed for cycleRecord: ' + err)
    }
    for (const refreshedArchiver of cycleRecord.refreshedArchivers) {
      err = validateTypes(refreshedArchiver, archiverType)
      if (err) {
        warn('Validation failed for cycleRecord.refreshedArchivers: ' + err)
        return false
      }
    }
    for (const refreshedConsensor of cycleRecord.refreshedConsensors) {
      err = validateTypes(refreshedConsensor, {
        curvePublicKey: 's',
        status: 's',
      })
      if (err) {
        warn('Validation failed for cycleRecord.refreshedConsensors: ' + err)
        return false
      }
    }
    for (const joinedArchiver of cycleRecord.joinedArchivers) {
      err = validateTypes(joinedArchiver, archiverType)
      if (err) {
        warn('Validation failed for cycleRecord.joinedArchivers: ' + err)
        return false
      }
    }
    for (const leavingArchiver of cycleRecord.leavingArchivers) {
      err = validateTypes(leavingArchiver, archiverType)
      if (err) {
        warn('Validation failed for cycleRecord.leavingArchivers: ' + err)
        return false
      }
    }
    for (const joinedConsensor of cycleRecord.joinedConsensors) {
      err = validateTypes(joinedConsensor, {
        cycleJoined: 's',
        counterRefreshed: 'n',
        id: 's',
      })
      if (err) {
        warn('Validation failed for cycleRecord.joinedConsensors: ' + err)
        return false
      }
    }
    for (const nodeId of cycleRecord.activated) {
      if (typeof nodeId !== 'string') {
        warn('Validation failed for cycleRecord.refreshedConsensors: ' + err)
        return false
      }
    }
    for (const activatedPublicKey of cycleRecord.activatedPublicKeys) {
      if (typeof activatedPublicKey !== 'string') {
        warn('Validation failed for cycleRecord.activatedPublicKeys: ' + err)
        return false
      }
    }
    for (const nodeId of cycleRecord.lost) {
      if (typeof nodeId !== 'string') {
        warn('Validation failed for cycleRecord.lost: ' + err)
        return false
      }
    }
    for (const nodeId of cycleRecord.refuted) {
      if (typeof nodeId !== 'string') {
        warn('Validation failed for cycleRecord.refuted: ' + err)
        return false
      }
    }
    for (const nodeId of cycleRecord.joined) {
      if (typeof nodeId !== 'string') {
        warn('Validation failed for cycleRecord.joined: ' + err)
        return false
      }
    }
    for (const nodeId of cycleRecord.returned) {
      if (typeof nodeId !== 'string') {
        warn('Validation failed for cycleRecord.returned: ' + err)
        return false
      }
    }
    for (const nodeId of cycleRecord.apoptosized) {
      if (typeof nodeId !== 'string') {
        warn('Validation failed for cycleRecord.apoptosized: ' + err)
        return false
      }
    }
    for (const networkHash of cycleRecord.networkDataHash) {
      err = validateTypes(networkHash, {
        cycle: 'n',
        hash: 's',
      })
      if (err) {
        warn('Validation failed for cycleRecord.networkDataHash: ' + err)
        return false
      }
    }
    for (const networkHash of cycleRecord.networkReceiptHash) {
      err = validateTypes(networkHash, {
        cycle: 'n',
        hash: 's',
      })
      if (err) {
        warn('Validation failed for cycleRecord.networkReceiptHash: ' + err)
        return false
      }
    }
    for (const networkHash of cycleRecord.networkSummaryHash) {
      err = validateTypes(networkHash, {
        cycle: 'n',
        hash: 's',
      })
      if (err) {
        warn('Validation failed for cycleRecord.networkSummaryHash: ' + err)
        return false
      }
    }
  }
  return true
}

function info(...msg: unknown[]) {
  const entry = `Sync: ${msg.join(' ')}`
  p2pLogger.info(entry)
}

function warn(...msg: unknown[]) {
  const entry = `Sync: ${msg.join(' ')}`
  p2pLogger.warn(entry)
}

function error(...msg: unknown[]) {
  const entry = `Sync: ${msg.join(' ')}`
  p2pLogger.error(entry)
}
