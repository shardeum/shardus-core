import { Logger } from 'log4js'
import { logFlags } from '../logger'
import { P2P } from '@shardus/types'
import * as utils from '../utils'
import { validateTypes } from '../utils'
import * as Comms from './Comms'
import { config, crypto, logger, network } from './Context'
import * as CycleCreator from './CycleCreator'
import * as CycleChain from './CycleChain'
import * as NodeList from './NodeList'
import * as Self from './Self'
import { profilerInstance } from '../utils/profiler'
import { NodeStatus } from '@shardus/types/build/src/p2p/P2PTypes'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { getSortedStandbyJoinRequests } from './Join/v2'
import { selectNodesFromReadyList } from './Join/v2/syncFinished'
import { isDebugModeMiddleware } from '../network/debugMiddleware'
import { safeStringify } from '../utils'
import { validateGossipPayload, verifyOriginalSenderAndQuarter } from '../utils/GossipValidation'

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
    // Ignore gossip outside of Q1 and Q2
    if (
      !validateGossipPayload(
        payload,
        { nodeId: 's', status: 's', timestamp: 'n', sign: 'o' },
        'gossip-active'
      )
    ) {
      return
    }

    if (logFlags.p2pNonFatal) info(`Got active request: ${JSON.stringify(payload)}`)

    // Check if the sender is the original sender. If so check if in Q1 to accept the request
    if (!verifyOriginalSenderAndQuarter(payload, sender as string, 'gossip-active')) {
      return
    }

    if (addActiveTx(payload)) {
      Comms.sendGossip('gossip-active', payload, tracker, sender, NodeList.byIdOrder, false)
    }
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
let neverGoActive = false

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

  network.registerExternalGet('debug-neverGoActive', isDebugModeMiddleware, (req, res) => {
    neverGoActive = !neverGoActive
    res.send(safeStringify({ status: 'ok', neverGoActive: neverGoActive }))
  })
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

  if (NodeList.readyByTimeAndIdOrder.length > 0) {
    const selectedNodes = selectNodesFromReadyList(_prev.mode)
    for (const node of selectedNodes) {
      /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `active:updateRecord node added to activated`)
      activated.push(node.id)
      activatedPublicKeys.push(node.publicKey)
    }
  }

  // for (const request of txs.active) {
  //   const publicKey = request.sign.owner
  //   const node = NodeList.byPubKey.get(publicKey)
  //   // Check if the node is the onReadyList and one of N of oldest node on the list
  //   const isNodeSelected = isNodeSelectedReadyList(node?.id)
  //   if (isNodeSelected) {
  //     /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `active:updateRecord node added to activated`)
  //     activated.push(node.id)
  //     activatedPublicKeys.push(node.publicKey)
  //   } else {
  //     /* prettier-ignore */ if(logFlags.important_as_error) warn(`active:updateRecord: node not found or not ready: ${publicKey}`)
  //     /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `active:updateRecord node not found or not ready`)
  //   }
  // }

  record.active = active
  record.activated = activated.sort()
  record.activatedPublicKeys = activatedPublicKeys.sort()
  record.standby = getSortedStandbyJoinRequests().length

  try {
    let cycleCounter = CycleChain.newest ? CycleChain.newest.counter : 0
    let addedCount = 0

    for (const node of NodeList.activeByIdOrder) {
      if (node.id === Self.id) continue
      const included = syncTimes.filter(
        (item) => item.nodeId === node.id && item.activeTimestamp === node.activeTimestamp
      )
      if (included && included.length > 0) continue
      const syncTime = node.activeTimestamp - node.syncingTimestamp

      syncTimes.push({
        nodeId: node.id,
        activeTimestamp: node.activeTimestamp,
        syncStartTimestamp: node.syncingTimestamp,
        syncTime,
        refreshedCounter: cycleCounter,
      })
      addedCount += 1
    }

    if (addedCount > 0) {
      syncTimes = syncTimes.sort((a, b) => b.activeTimestamp - a.activeTimestamp)
      if (syncTimes.length > config.p2p.maxNodeForSyncTime) {
        syncTimes = syncTimes.slice(0, config.p2p.maxNodeForSyncTime)
      }
    }
    if (syncTimes.length > 0) lastCheckedCycleForSyncTimes = syncTimes[0].refreshedCounter // updated last checked cycle
    const syncDurations = syncTimes
      .map((syncTime) => syncTime.activeTimestamp - syncTime.syncStartTimestamp)
      .sort((a, b) => a - b)
    const medianIndex = Math.floor(syncDurations.length / 2)
    const medianSyncTime = syncDurations[medianIndex]

    /* prettier-ignore */ if (logFlags.p2pNonFatal) info('Sync time records sorted', syncTimes.length, JSON.stringify(syncTimes))

    if (CycleChain.newest) {
      /* prettier-ignore */ if (logFlags.p2pNonFatal) info(`Median sync time at cycle ${cycleCounter} is ${medianSyncTime} s.`)
    }
    let maxSyncTime = medianSyncTime ? medianSyncTime * 2 : 0

    if (maxSyncTime < config.p2p.maxSyncTimeFloor) {
      maxSyncTime = config.p2p.maxSyncTimeFloor
    }
    record.maxSyncTime = maxSyncTime
    // record.maxSyncTime = Math.min(config.p2p.maxSyncTimeFloor, maxSyncTime)

    //higher pri on this log so we can analyze it and correct as needed
    /* prettier-ignore */ if (logFlags.important_as_error) info(`maxSyncTime ${cycleCounter} is ${maxSyncTime} medianSyncTime*2: ${medianSyncTime}`)
  } catch (e) {
    record.maxSyncTime = config.p2p.maxSyncTimeFloor
    /* prettier-ignore */ if (logFlags.error) error(`calculateMaxSyncTime: Unable to calculate max sync time`, e)
  }
}

export function parseRecord(record: P2P.CycleCreatorTypes.CycleRecord): P2P.CycleParserTypes.Change {
  // Look at the activated id's and make Self emit 'active' if your own id is there
  if (record.activated.includes(Self.id) && !neverGoActive) {
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
  if (queuedRequest && !neverGoActive) {
    const activeTx = crypto.sign(queuedRequest)
    queuedRequest = undefined

    if (logFlags.important_as_fatal) info(`Gossiping active request: ${JSON.stringify(activeTx)}`)
    nestedCountersInstance.countEvent('p2p', `p2p:sendRequests Gossiping active request`)

    if (addActiveTx(activeTx) === false) {
      /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `active:sendRequests failed to add our own request`)
    }
    Comms.sendGossip('gossip-active', activeTx, '', null, NodeList.byIdOrder, true)

    // Check if we went active and try again if we didn't in 1 cycle duration
    const activeTimeout = setTimeout(requestActive, config.p2p.cycleDuration * 1000 + 500)

    Self.emitter.once('active', () => {
      info(`Went active!`)
      nestedCountersInstance.countEvent('p2p', `p2p:sendRequests went active`)
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
  if (!request) {
    return false
  }
  if (!validateActiveRequest(request)) {
    return false
  }
  if (activeRequests.has(request.sign.owner)) {
    return false
  }

  activeRequests.set(request.sign.owner, request)
  return true
}

function validateActiveRequest(request: P2P.ActiveTypes.SignedActiveRequest) {
  const node = NodeList.nodes.get(request.nodeId)
  if (!node) {
    /* prettier-ignore */ if(logFlags.important_as_error) warn(`validateActiveRequest: node not found, nodeId: ${request.nodeId}`)
    /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `active:validateActiveRequest node not found`)
    return false
  }
  if (!crypto.verify(request, node.publicKey)) {
    /* prettier-ignore */ if(logFlags.important_as_error) warn(`validateActiveRequest: bad signature, request: ${JSON.stringify(request)} ${request.nodeId}`)
    /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `active:validateActiveRequests bad signature`)
    return false
  }
  if (config.p2p.validateActiveRequests === true) {
    // Do not accept active request if node is already active
    const existing = NodeList.nodes.get(request.nodeId)
    if (existing && existing.status === NodeStatus.ACTIVE) {
      /* prettier-ignore */ if(logFlags.important_as_error) warn(`validateActiveRequest: already active , nodeId: ${request.nodeId}`)
      /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `active:validateActiveRequest already active`)
      return false
    }
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
