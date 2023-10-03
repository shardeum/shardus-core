import { Logger } from 'log4js'
import { logFlags } from '../logger'
import { P2P } from '@shardus/types'
import * as utils from '../utils'
import { validateTypes } from '../utils'
import * as Comms from './Comms'
import { config, crypto, logger } from './Context'
import * as CycleCreator from './CycleCreator'
import * as CycleChain from './CycleChain'
import * as NodeList from './NodeList'
import * as Self from './Self'
import { profilerInstance } from '../utils/profiler'
import { NodeStatus } from '@shardus/types/build/src/p2p/P2PTypes'

let syncTimes = []
let lastCheckedCycleForSyncTimes = 0
/** ROUTES */

const gossipActiveRoute: P2P.P2PTypes.GossipHandler<P2P.ActiveTypes.SignedActiveRequest> = (
  payload,
  sender,
  tracker
) => {
  profilerInstance.scopedProfileSectionStart('gossip-active', true)
  try {
    if (logFlags.p2pNonFatal) info(`Got active request: ${JSON.stringify(payload)}`)
    let err = ''
    err = validateTypes(payload, {
      nodeId: 's',
      status: 's',
      timestamp: 'n',
      sign: 'o',
    })
    if (err) {
      warn('bad input ' + err)
      return
    }
    err = validateTypes(payload.sign, { owner: 's', sig: 's' })
    if (err) {
      warn('bad input sign ' + err)
      return
    }

    const signer = NodeList.byPubKey.get(payload.sign.owner)
    if (!signer) {
      warn('Got active request from unknown node')
    }
    const isOrig = signer.id === sender

    // Only accept original txs in quarter 1
    if (isOrig && CycleCreator.currentQuarter > 1) return

    // Do not forward gossip after quarter 2
    if (!isOrig && CycleCreator.currentQuarter > 2) return

    if (addActiveTx(payload))
      Comms.sendGossip('gossip-active', payload, tracker, sender, NodeList.byIdOrder, false)
  } finally {
    profilerInstance.scopedProfileSectionEnd('gossip-active')
  }
}

const routes = {
  internal: {},
  gossip: {
    'gossip-active': gossipActiveRoute,
  },
}

/** STATE */

let p2pLogger: Logger

let activeRequests: Map<P2P.NodeListTypes.Node['publicKey'], P2P.ActiveTypes.SignedActiveRequest>
let queuedRequest: P2P.ActiveTypes.ActiveRequest

/** FUNCTIONS */

/** CycleCreator Functions */

export function init() {
  // Init logger
  p2pLogger = logger.getLogger('p2p')

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

export function reset() {
  activeRequests = new Map()
}

export function getTxs(): P2P.ActiveTypes.Txs {
  return {
    active: [...activeRequests.values()],
  }
}

export function validateRecordTypes(rec: P2P.ActiveTypes.Record): string {
  let err = validateTypes(rec, {
    active: 'n',
    activated: 'a',
    activatedPublicKeys: 'a',
  })
  if (err) return err
  for (const item of rec.activated) {
    if (typeof item !== 'string') return 'items of activated array must be strings'
  }
  for (const item of rec.activatedPublicKeys) {
    if (typeof item !== 'string') return 'items of activatedPublicKeys array must be strings'
  }
  return ''
}

export function dropInvalidTxs(txs: P2P.ActiveTypes.Txs): P2P.ActiveTypes.Txs {
  const active = txs.active.filter((request) => validateActiveRequest(request))
  return { active }
}

export function updateRecord(
  txs: P2P.ActiveTypes.Txs,
  record: P2P.CycleCreatorTypes.CycleRecord,
  _prev: P2P.CycleCreatorTypes.CycleRecord
) {
  const active = NodeList.activeByIdOrder.length
  const activated = []
  const activatedPublicKeys = []

  for (const request of txs.active) {
    const publicKey = request.sign.owner
    const node = NodeList.byPubKey.get(publicKey)
    if (node) {
      activated.push(node.id)
      activatedPublicKeys.push(node.publicKey)
    }
  }

  record.active = active
  record.activated = activated.sort()
  record.activatedPublicKeys = activatedPublicKeys.sort()

  try {
    let cycleCounter = CycleChain.newest ? CycleChain.newest.counter : 0
    let loopCount = 0
    let addedCount = 0
    const maxLoopCount = 1000 // to prevent unexpected infinite loops
    const cycles = CycleChain.cycles
    let index = cycles.length - 1

    // loop through cycle chain and collect sync times
    while (cycles.length > 0 && cycleCounter > lastCheckedCycleForSyncTimes && loopCount < maxLoopCount) {
      loopCount++
      const cycle = cycles[index]
      if (cycle) {
        // collect sync time from recently activated nodes
        for (const nodeId of cycle.activated) {
          const node = NodeList.nodes.get(nodeId)
          const included = syncTimes.filter(
            (item) => item.nodeId === node.id && item.activeTimestamp === node.activeTimestamp
          )
          if (included && included.length > 0) continue
          const syncTime = node.activeTimestamp - node.joinRequestTimestamp

          syncTimes.push({
            nodeId: node.id,
            activeTimestamp: node.activeTimestamp,
            joinTimestamp: node.joinRequestTimestamp,
            syncTime,
            refreshedCounter: cycle.counter,
          })
          addedCount += 1
        }

        // collect sync time from refreshed active nodes
        for (const node of cycle.refreshedConsensors) {
          const included = syncTimes.filter(
            (item) => item.nodeId === node.id && item.activeTimestamp === node.activeTimestamp
          )
          if (included && included.length > 0) continue
          const syncTime = node.activeTimestamp - node.joinRequestTimestamp

          syncTimes.push({
            nodeId: node.id,
            activeTimestamp: node.activeTimestamp,
            joinTimestamp: node.joinRequestTimestamp,
            syncTime,
            refreshedCounter: cycle.counter,
          })
          addedCount += 1
        }
      } else {
        error(`Found no cycle for counter ${cycleCounter}`)
      }
      cycleCounter--
      index--
    }
    if (addedCount > 0) {
      syncTimes = syncTimes.sort((a, b) => b.activeTimestamp - a.activeTimestamp)
      if (syncTimes.length > config.p2p.maxNodeForSyncTime) {
        syncTimes = syncTimes.slice(0, config.p2p.maxNodeForSyncTime)
      }
    }
    if (syncTimes.length > 0) lastCheckedCycleForSyncTimes = syncTimes[0].refreshedCounter // updated last checked cycle
    const syncDurations = syncTimes
      .map((syncTime) => syncTime.activeTimestamp - syncTime.joinTimestamp)
      .sort((a, b) => a - b)
    const medianIndex = Math.floor(syncDurations.length / 2)
    const medianSyncTime = syncDurations[medianIndex]

    info('Sync time records sorted', syncTimes.length, JSON.stringify(syncTimes))

    if (CycleChain.newest)
      info(`Median sync time at cycle ${CycleChain.newest.counter} is ${medianSyncTime} s.`)

    let maxSyncTime = medianSyncTime ? medianSyncTime * 2 : 0
    if (maxSyncTime < config.p2p.maxSyncTimeFloor) {
      maxSyncTime = config.p2p.maxSyncTimeFloor
    }
    record.maxSyncTime = maxSyncTime
    // record.maxSyncTime = Math.min(config.p2p.maxSyncTimeFloor, maxSyncTime)
  } catch (e) {
    record.maxSyncTime = config.p2p.maxSyncTimeFloor
    error(`calculateMaxSyncTime: Unable to calculate max sync time`, e)
  }
}

export function parseRecord(record: P2P.CycleCreatorTypes.CycleRecord): P2P.CycleParserTypes.Change {
  // Look at the activated id's and make Self emit 'active' if your own id is there
  if (record.activated.includes(Self.id)) {
    Self.setActive()
    Self.emitter.emit('active', Self.id)
    Self.updateNodeState(P2P.P2PTypes.NodeStatus.ACTIVE)
  }

  // For all nodes described by activated, make an update to change their status to active
  const updated = record.activated.map((id) => ({
    id,
    activeTimestamp: record.start,
    status: P2P.P2PTypes.NodeStatus.ACTIVE,
  }))

  return {
    added: [],
    removed: [],
    updated,
  }
}

export function sendRequests() {
  if (queuedRequest) {
    const activeTx = crypto.sign(queuedRequest)
    queuedRequest = undefined

    if (logFlags.p2pNonFatal) info(`Gossiping active request: ${JSON.stringify(activeTx)}`)
    addActiveTx(activeTx)
    Comms.sendGossip('gossip-active', activeTx, '', null, NodeList.byIdOrder, true)

    // Check if we went active and try again if we didn't in 1 cycle duration
    const activeTimeout = setTimeout(requestActive, config.p2p.cycleDuration * 1000 + 500)

    Self.emitter.once('active', () => {
      info(`Went active!`)
      clearTimeout(activeTimeout)
    })
  }
}

export function queueRequest(request: P2P.ActiveTypes.ActiveRequest) {
  queuedRequest = request
}

/** Module Functions */

export function requestActive() {
  // Create an active request and queue it to be sent
  const request = createActiveRequest()
  queueRequest(request)
}

function createActiveRequest(): P2P.ActiveTypes.ActiveRequest {
  const request = {
    nodeId: Self.id,
    status: 'active',
    timestamp: utils.getTime(),
  }
  return request
}

function addActiveTx(request: P2P.ActiveTypes.SignedActiveRequest) {
  if (!request) return false
  if (!validateActiveRequest(request)) return false
  if (activeRequests.has(request.sign.owner)) return false

  activeRequests.set(request.sign.owner, request)
  return true
}

function validateActiveRequest(request: P2P.ActiveTypes.SignedActiveRequest) {
  const node = NodeList.nodes.get(request.nodeId)
  if (!node) {
    warn(`validateActiveRequest: node not found, nodeId: ${request.nodeId}`)
    return false
  }
  if (!crypto.verify(request, node.publicKey)) {
    warn(`validateActiveRequest: bad signature, request: ${JSON.stringify(request)}`)
    return false
  }
  if (config.p2p.validateActiveRequests === true) {
    // Do not accept active request if node is already active
    const existing = NodeList.nodes.get(request.nodeId)
    if (existing && existing.status === NodeStatus.ACTIVE) return false
    // [TODO] Discuss and implement more active request validation
  }
  return true
}

function info(...msg) {
  const entry = `Active: ${msg.join(' ')}`
  p2pLogger.info(entry)
}

function warn(...msg) {
  const entry = `Active: ${msg.join(' ')}`
  p2pLogger.warn(entry)
}

function error(...msg) {
  const entry = `Active: ${msg.join(' ')}`
  p2pLogger.error(entry)
}
