/*
Nodes can be lost at anytime without notifiying the network. This is different than Apoptosis where
the node sends a message to peers before exiting. When a node notifies the network that it is exiting,
the peers can remove it from their node list within 2 cycles. If a node does not notifiy the network
before exiting it will take the peers about 3 cycles to remove the node from their node list.
The lost node detection process is described in the "Lost Node Detection" Google doc under Shardus
internal documents.
*/

import * as shardusCrypto from '@shardus/crypto-utils'
import { P2P } from '@shardus/types'
import { SignedObject } from '@shardus/types/build/src/p2p/P2PTypes'
import { Handler } from 'express'
import * as http from '../http'
import { logFlags } from '../logger'
import * as utils from '../utils'
import { binarySearch, logNode, validateTypes } from '../utils'
import getCallstack from '../utils/getCallstack'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { profilerInstance } from '../utils/profiler'
import { isApopMarkedNode, nodeDownString } from './Apoptosis'
import * as Comms from './Comms'
import { config, p2p, crypto, logger, network, stateManager, shardus } from './Context'
import { currentCycle, currentQuarter } from './CycleCreator'
import { cycles } from './CycleChain'
import * as NodeList from './NodeList'
import { activeByIdOrder, byIdOrder, byPubKey, nodes } from './NodeList'
import * as Self from './Self'
import { generateUUID } from './Utils'
import { CycleData } from '@shardus/types/build/src/p2p/CycleCreatorTypes'
import { shardusGetTime } from '../network'
import { ApoptosisProposalResp, deserializeApoptosisProposalResp } from '../types/ApoptosisProposalResp'
import { ApoptosisProposalReq, serializeApoptosisProposalReq } from '../types/ApoptosisProposalReq'
import { ShardusEvent, Node } from '../shardus/shardus-types'
import { HashTrieReq, ProxyRequest, ProxyResponse } from '../state-manager/state-manager-types'
import { GetTrieHashesRequest, serializeGetTrieHashesReq } from '../types/GetTrieHashesReq'
import { GetTrieHashesResponse, deserializeGetTrieHashesResp } from '../types/GetTrieHashesResp'
import { InternalRouteEnum } from '../types/enum/InternalRouteEnum'
import { safeStringify } from '../utils'

/** TYPES */

export type ScheduledLostReport<Target> = {
  targetNode: Target
  reason: string
  timestamp: number
  scheduledInCycle: number
  requestId: string
}

export type ScheduledRemoveByApp<Target> = {
  target: Target
  reason: string
  timestamp: number
  certificate: P2P.LostTypes.RemoveCertificate
}

type ScheduledLostNodeReport = ScheduledLostReport<P2P.NodeListTypes.Node>
type ScheduledRemoveNodeByApp = ScheduledRemoveByApp<P2P.NodeListTypes.Node>

/** STATE */

// [TODO] - This enables the /kill /killother debug route and should be set to false after testing
const allowKillRoute = false

let p2pLogger

let lostReported = new Map<string, P2P.LostTypes.LostReport>()
let receivedLostRecordMap = new Map<string, Map<string, P2P.LostTypes.LostRecord>>()
let checkedLostRecordMap = new Map<string, P2P.LostTypes.LostRecord>()
let upGossipMap = new Map<string, P2P.LostTypes.SignedUpGossipMessage>()
let appRemoved = new Map<string, P2P.LostTypes.RemoveByAppMessage>()
export let isDown = {}
let isUp = {}
let isUpTs = {}
let stopReporting = {}
let sendRefute = -1
// map of <node_id-cycle_counter>
let scheduledForLostReport: Map<string, ScheduledLostNodeReport> = new Map<string, ScheduledLostNodeReport>()
let scheduledRemoveApp: Map<string, ScheduledRemoveNodeByApp> = new Map<string, ScheduledRemoveNodeByApp>()

//const CACHE_CYCLES = 10 replaced by multiple configs

interface PingMessage {
  m: string
}

export declare type SignedPingMessage = PingMessage & SignedObject

/** ROUTES */

const killExternalRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'kill',
  handler: (_req, res) => {
    if (allowKillRoute) {
      res.send(safeStringify({ status: 'left the network without telling any peers' }))
      killSelf(
        'Apoptosis being called killExternalRoute()->killSelf()->emitter.emit(`apoptosized`) at src/p2p/Lost.ts'
      )
    }
  },
}

const killOtherExternalRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'killother',
  handler: (_req, res) => {
    if (allowKillRoute) {
      res.send(safeStringify({ status: 'killing another node' }))
      killOther()
    }
  },
}

const isDownCheckRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'down-check',
  handler: async (_req, res) => {
    const nodeId = _req.query.nodeId
    const node = nodes.get(nodeId.toString())
    const result = await isDownCheck(node)
    res.send(safeStringify({ status: result }))
  },
}

const lostReportRoute: P2P.P2PTypes.Route<P2P.P2PTypes.InternalHandler<P2P.LostTypes.SignedLostReport>> = {
  name: 'lost-report',
  handler: lostReportHandler,
}

/**
note: we are not using the SignedObject part yet
FUTURE-SLASHING
we would not want to blindly check signatures, and may later need
a way to mark a node as bad if it spams the ping endpoint too much
 */
const pingNodeRoute: P2P.P2PTypes.Route<P2P.P2PTypes.InternalHandler<SignedPingMessage>> = {
  name: 'ping-node',
  handler: (payload, response, sender) => {
    profilerInstance.scopedProfileSectionStart('ping-node')
    try {
      //used by isNodeDown to test if a node can be reached on the internal protocol
      if (payload?.m === 'ping') {
        response({ s: 'ack', r: 1 })
      }
    } finally {
      profilerInstance.scopedProfileSectionEnd('ping-node')
    }
  },
}

const lostDownRoute: P2P.P2PTypes.GossipHandler = (
  payload: P2P.LostTypes.SignedDownGossipMessage,
  sender,
  tracker
) => {
  profilerInstance.scopedProfileSectionStart('lost-down')
  try {
    downGossipHandler(payload, sender, tracker)
  } finally {
    profilerInstance.scopedProfileSectionStart('lost-down')
  }
}

const lostUpRoute: P2P.P2PTypes.GossipHandler = (
  payload: P2P.LostTypes.SignedUpGossipMessage,
  sender,
  tracker
) => {
  profilerInstance.scopedProfileSectionStart('lost-up')
  try {
    upGossipHandler(payload, sender, tracker)
  } finally {
    profilerInstance.scopedProfileSectionStart('lost-up')
  }
}

const removeByAppRoute: P2P.P2PTypes.GossipHandler = (
  payload: P2P.LostTypes.RemoveCertificate,
  sender,
  tracker
) => {
  profilerInstance.scopedProfileSectionStart('remove-by-app')
  try {
    removeByAppHandler(payload, sender, tracker)
  } finally {
    profilerInstance.scopedProfileSectionStart('remove-by-app')
  }
}

const routes = {
  external: [killExternalRoute, killOtherExternalRoute],
  internal: [lostReportRoute, pingNodeRoute],
  gossip: {
    'lost-down': lostDownRoute,
    'lost-up': lostUpRoute,
    'remove-by-app': removeByAppRoute,
  },
}

/** FUNCTIONS */

export function init() {
  // p2pLogger = logger.getLogger('p2p')
  p2pLogger = logger.getLogger('p2p')

  p2pLogger.info('HELLO')

  // Init state
  reset()

  // Register routes
  for (const route of routes.external) {
    // [TODO] - Add Comms.registerExternalGet and Post that pass through to network.*
    //          so that we can always just use Comms.* instead of network.*
    network._registerExternal(route.method, route.name, route.handler)
  }
  for (const route of routes.internal) {
    Comms.registerInternal(route.name, route.handler)
  }
  for (const [name, handler] of Object.entries(routes.gossip)) {
    Comms.registerGossipHandler(name, handler)
  }
  p2p.registerInternal(
    'proxy',
    async (
      payload: ProxyRequest,
      respond: (arg0: ProxyResponse) => Promise<number>,
      _sender: string,
      _tracker: string,
      msgSize: number
    ) => {
      profilerInstance.scopedProfileSectionStart('proxy')
      let proxyRes: ProxyResponse = {
        success: false,
        response: null,
      }
      try {
        let targetNode = nodes.get(payload.nodeId)
        if (targetNode == null) {
          error(`proxy handler targetNode is null`)
          await respond(proxyRes)
          return
        }
        let res = null
        if (
          payload.route === 'get_trie_hashes' &&
          this.p2p.useBinarySerializedEndpoints &&
          this.p2p.getTrieHashesBinary
        ) {
          nestedCountersInstance.countEvent('p2p', 'getTrieHashesBinary', 1)
          res = await Comms.askBinary<GetTrieHashesRequest, GetTrieHashesResponse>(
            targetNode,
            InternalRouteEnum.binary_get_trie_hashes,
            payload.message,
            serializeGetTrieHashesReq,
            deserializeGetTrieHashesResp,
            {}
          )
        } else {
          res = await Comms.ask(targetNode, payload.route, payload.message)
        }
        proxyRes = {
          success: true,
          response: res,
        }
        await respond(proxyRes)
      } catch (e) {
        error(`proxy handler error: ${e.message}`)
        await respond(proxyRes)
      } finally {
        profilerInstance.scopedProfileSectionEnd('proxy')
      }
    }
  )
}

// This gets called before start of Q1
export function reset() {
  const lostCacheCycles = config.p2p.lostMapPruneCycles
  for (let [key, lostRecordItems] of receivedLostRecordMap) {
    let shouldRemove = false
    for (let [checker, report] of lostRecordItems) {
      // delete old lost reports
      if (report.cycle < currentCycle - lostCacheCycles) {
        shouldRemove = true
        break
      }
      // delete once the target is removed from the node list
      if (nodes.get(report.target) == null) {
        shouldRemove = true
        break
      }
    }
    if (shouldRemove) {
      lostReported.delete(key)
      checkedLostRecordMap.delete(key)
      receivedLostRecordMap.delete(key)
      upGossipMap.delete(key)
    }
  }
  appRemoved.clear()
  pruneIsDown() // prune isUp and isDown status cache
  pruneStopReporting() // prune stopReporting cache
}

// This gets called at the start of Q3
export function getTxs(): P2P.LostTypes.Txs {
  let lostTxs = []
  let refutedTxs = []
  let removedByAppTxs = []
  // Check if the node in the lost list is in the apop list; remove it if there is one
  for (const [key, lostRecordItems] of receivedLostRecordMap) {
    if (lostRecordItems == null || lostRecordItems.size === 0) continue
    let target: string
    for (const [checker, record] of lostRecordItems) {
      if (record.target != null) {
        target = record.target
        break
      }
    }
    if (target && isApopMarkedNode(target)) {
      receivedLostRecordMap.delete(key)
    }
  }

  // get winning item for each target from the array of lost records
  let seen = {} // used to make sure we don't add the same node twice
  for (const [key, lostRecordItems] of receivedLostRecordMap) {
    if (lostRecordItems == null || lostRecordItems.size === 0) continue
    let downMsgCount = 0
    let downRecord: P2P.LostTypes.LostRecord
    for (const [checker, record] of lostRecordItems) {
      if (seen[record.target]) continue
      // if (record.cycle !== currentCycle) continue
      if (record.status === 'down') {
        downMsgCount++
        downRecord = record
      }
    }
    if (downMsgCount >= config.p2p.numCheckerNodes) {
      lostTxs.push(downRecord.message)
      seen[downRecord.target] = true
      if (logFlags.verbose) info(`Adding lost record for ${downRecord.target} to lostTxs`)
    } else {
      if (logFlags.verbose)
        info(`Not enough down messages to be considered lost: ${JSON.stringify(downRecord)}`)
    }
  }

  // include up gossip messages that we received
  for (const [key, upGossipMsg] of upGossipMap) {
    let { target, cycle, status } = upGossipMsg
    if (cycle == currentCycle) {
      refutedTxs.push(upGossipMsg)
      if (logFlags.verbose) info(`Adding up gossip message for ${target} to refutedTxs`)
    }
  }
  seen = {}
  for (const [key, obj] of appRemoved) {
    if (seen[obj.target]) continue
    removedByAppTxs.push(obj)
    seen[obj.target] = true
  }
  return {
    lost: [...lostTxs],
    refuted: [...refutedTxs],
    removedByApp: [...removedByAppTxs],
  }
}

export function validateRecordTypes(rec: P2P.LostTypes.Record): string {
  let err = validateTypes(rec, { lost: 'a', refuted: 'a', appRemoved: 'a' })
  if (err) return err
  for (const item of rec.lost) {
    if (typeof item !== 'string') return 'items of lost array must be strings'
  }
  for (const item of rec.refuted) {
    if (typeof item !== 'string') return 'items of refuted array must be strings'
  }
  for (const item of rec.appRemoved) {
    if (typeof item !== 'string') return 'items of appRemoved array must be strings'
  }
  return ''
}

// This gets called during Q3 after getTxs
export function dropInvalidTxs(txs: P2P.LostTypes.Txs): P2P.LostTypes.Txs {
  const validLost = txs.lost.filter((request) => checkDownMsg(request, currentCycle)[0])
  const validRefuted = txs.refuted.filter((request) => checkUpMsg(request, currentCycle)[0])
  const validRemovedByApp = txs.removedByApp.filter(
    (request) => checkRemoveByAppMsg(request, currentCycle)[0]
  )
  return { lost: validLost, refuted: validRefuted, removedByApp: validRemovedByApp }
}

/*
Given the txs and prev cycle record mutate the referenced record
*/
// This gets called during Q3 after dropInvalidTxs
export function updateRecord(
  txs: P2P.LostTypes.Txs,
  record: P2P.CycleCreatorTypes.CycleRecord,
  prev: P2P.CycleCreatorTypes.CycleRecord
) {
  const lostNodeIds = []
  const lostSyncingNodeIds = []
  const refutedNodeIds = []
  const removedByAppNodeIds = []
  let seen = {} // used to make sure we don't add the same node twice
  for (const request of txs.lost) {
    if (seen[request.report.target]) continue
    lostNodeIds.push(request.report.target)
    seen[request.report.target] = true
  }
  seen = {}
  for (const request of txs.refuted) {
    if (seen[request.target]) continue
    refutedNodeIds.push(request.target)
    seen[request.target] = true
  }
  seen = {}
  for (const request of txs.removedByApp) {
    if (seen[request.target]) continue
    removedByAppNodeIds.push(request.target)
    seen[request.target] = true
  }
  // remove activated nodes from syncing by id order
  /*
  we already remove from nodelist in updateNode, so this is redundant
  for (const nodeId of record.activated) {
    NodeList.removeSyncingNode(nodeId)
    NodeList.removeReadyNode(nodeId)
  }
  */

  if (config.p2p.detectLostSyncing) {
    const syncingNodes = NodeList.syncingByIdOrder
    const now = Math.floor(shardusGetTime() / 1000)
    for (const syncingNode of syncingNodes) {
      const syncTime = now - syncingNode.syncingTimestamp
      /* prettier-ignore */ if (logFlags.p2pNonFatal) console.log('syncTime vs maxSyncTime', syncTime, record.maxSyncTime)
      if (record.maxSyncTime && syncTime > record.maxSyncTime) {
        if (logFlags.verbose) {
          info(`Syncing time for node ${syncingNode.id}`, syncTime)
          info(`Max sync time from record`, record.maxSyncTime)
          info(`Sync time is longer than max sync time. Reporting as lost`)
          info('adding node to lost syncing list', syncingNode.id, `${syncTime} > ${record.maxSyncTime}`)
        }
        //todo remove this later after we feel good about the system.. it wont really be that rare, so we dont want to swamp rare counters
        /* prettier-ignore */ nestedCountersInstance.countRareEvent('lost', 'sync timeout ' + `${utils.stringifyReduce(syncingNode.id)} ${syncTime} > ${record.maxSyncTime}`)
        lostSyncingNodeIds.push(syncingNode.id)
        NodeList.emitSyncTimeoutEvent(syncingNode, record)
        if (config.p2p.removeLostSyncingNodeFromList) NodeList.removeSyncingNode(syncingNode.id)
      }
    }
  }

  record.lost = lostNodeIds.sort()
  record.lostSyncing = lostSyncingNodeIds.sort()
  record.refuted = refutedNodeIds.sort()
  record.appRemoved = removedByAppNodeIds.sort()

  if (prev) {
    let apop = prev.lost.filter((id) => nodes.has(id)) // remove nodes that are no longer in the network
    apop = apop.filter((id) => !prev.appRemoved.includes(id))

    let apopSyncing = []
    if (config.p2p.detectLostSyncing) {
      apopSyncing = prev.lostSyncing.filter((id) => nodes.has(id))
    }
    // neglect nodes that are refuted
    apop = apop.filter((id) => !refutedNodeIds.includes(id)) // remove nodes that refuted

    // filter adding nodes that are already in the apop record
    if (config.p2p.uniqueRemovedIds) {
      apop = apop.filter((id) => !record.apoptosized.includes(id))
      apopSyncing = apopSyncing.filter((id) => !record.apoptosized.includes(id))
    }
    // If the apop nodes are in the removed record also, clear them from the removed record
    if (config.p2p.uniqueRemovedIdsUpdate) {
      const nodesInRemoved = apop.filter((id) => record.removed.includes(id))
      record.removed = record.removed.filter((id) => !nodesInRemoved.includes(id))
    }
    record.apoptosized = [...apop, ...apopSyncing, ...record.apoptosized].sort()
  }
}

// This gets called before Q1 when a new cycle is created or fetched
export function parseRecord(record: P2P.CycleCreatorTypes.CycleRecord): P2P.CycleParserTypes.Change {
  // If we see our node in the refute field clear flag to send an 'up' message at start of next cycle
  //   We ndded to do this check before checking the lost field for our node.
  for (const id of record.refuted) {
    const node = NodeList.nodes.get(id)
    if (node == null) {
      error(`Refuted node ${id} is not in the network`)
      continue
    }
    const emitParams: Omit<ShardusEvent, 'type'> = {
      nodeId: node.id,
      reason: 'Node refuted',
      time: record.start,
      publicKey: node.publicKey,
      cycleNumber: record.counter,
    }
    Self.emitter.emit('node-refuted', emitParams)
    if (id === Self.id) sendRefute = -1
  }
  // Once we see any node in the lost field of the cycle record, we should stop
  //   sending lost reports for it to reduce the amount of network messages caused by the lost node
  // If we see our node in the lost field set flag to send an 'up' message at start of next cycle
  for (const id of record.lost) {
    stopReporting[id] = record.counter
    if (id === Self.id) {
      sendRefute = record.counter + 1
      warn(`self-schedule refute currentC:${currentCycle} inCycle:${record.counter} refuteat:${sendRefute}`)
      /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `self-schedule refute currentC:${currentCycle} inCycle:${record.counter}`, 1)
    }
  }

  if (record.lostSyncing.includes(Self.id)) {
    // This could happen if we take longer than maxSyncTime to sync
    error(`We got marked as lostSyncing. Being nice and leaving.`)
    Self.emitter.emit(
      'invoke-exit',
      'lostSyncing',
      getCallstack(),
      'invoke-exit being called at parseRecord() => src/p2p/Lost.ts'
    )
  }

  // Look at the app removed id's and make Self emit 'removed' if your own id is there
  if (record.appRemoved.includes(Self.id)) {
    /* prettier-ignore */
    nestedCountersInstance.countEvent("p2p", `app-removed c:${currentCycle}`, 1);
    Self.emitter.emit('app-removed', Self.id)
  }

  // We don't actually have to set removed because the Apoptosis module will do it.
  // Make sure the Lost module is listed after Apoptosis in the CycleCreator submodules list
  return {
    added: [],
    removed: [...record.appRemoved],
    updated: [],
  }
}

// This is called once per cycle at the start of Q1 by CycleCreator
export function sendRequests() {
  if (config.p2p.aggregateLostReportsTillQ1) {
    scheduledForLostReport.forEach((value: ScheduledLostNodeReport, key: string) => {
      if (value.scheduledInCycle < currentCycle - config.p2p.delayLostReportByNumOfCycles) {
        /* prettier-ignore */ if (logFlags.verbose) info(`Reporting lost: requestId: ${value.requestId}, scheduled in cycle: ${value.scheduledInCycle}, reporting in cycle ${currentCycle}, originally reported at ${value.timestamp}`)
        reportLost(value.targetNode, value.reason, value.requestId)
        scheduledForLostReport.delete(key)
      }
    })
  }

  for (const [key, obj] of scheduledRemoveApp) {
    removeByApp(obj.target, obj.certificate)
    scheduledRemoveApp.delete(key)
  }

  // we will gossip the "down" lost records that we already checked for this cycle
  for (const [key, record] of checkedLostRecordMap) {
    if (record.status !== 'down') continue // TEST
    if (record.message && record.checker && record.checker === Self.id) {
      if (record.gossiped) continue
      if (record.status !== 'down') continue
      if (stopReporting[record.message.target]) continue // TEST // this node already appeared in the lost field of the cycle record, we dont need to keep reporting
      let msg = { report: record.message, cycle: currentCycle, status: 'down' }
      msg = crypto.sign(msg)
      record.message = msg
      record.gossiped = true
      if (logFlags.verbose)
        info(
          `Gossiping node down message for node: ${record.target} payload.cycle ${
            record.cycle
          }: ${JSON.stringify(msg)}`
        )
      /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', 'send-lost-down', 1)
      //this next line is probably too spammy to leave in forever (but ok to comment out and keep)
      /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `send-lost-down c:${currentCycle}`, 1)
      Comms.sendGossip('lost-down', msg, '', null, byIdOrder, true)
      // we add to our own map
      if (!receivedLostRecordMap.has(key)) {
        receivedLostRecordMap.set(key, new Map<string, P2P.LostTypes.LostRecord>())
        receivedLostRecordMap.get(key).set(record.checker, record)
      }
    }
  }
  // We cannot count on the lost node seeing the gossip and refuting based on that.
  //   It has to be based on the lost node seeing it's node id in the lost field of the cycle record.
  //   Send refute is set to the cycle counter + 1 of the cycle record where we saw our id in the lost field
  //   We cannot create a message which has the down message since we may not have received that gossip
  if (sendRefute > 0) {
    warn(`pending sendRefute:${sendRefute} currentCycle:${currentCycle}`)
  }
  if (sendRefute === currentCycle) {
    let upGossipMsg = { target: Self.id, status: 'up', cycle: currentCycle }
    warn(`Gossiping node up message: ${JSON.stringify(upGossipMsg)}`)
    let signedUpGossipMsg: P2P.LostTypes.SignedUpGossipMessage = crypto.sign(upGossipMsg)
    /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', 'self-refute', 1)
    //this next line is probably too spammy to leave in forever (but ok to comment out and keep)
    /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `self-refute c:${currentCycle}`, 1)
    Comms.sendGossip('lost-up', signedUpGossipMsg, '', null, byIdOrder, true)
    upGossipMap.set(`${Self.id}-${currentCycle}`, signedUpGossipMsg)
  }
}

/* Module functions */

async function killSelf(message: string) {
  error(`In killSelf`)
  Self.emitter.emit('invoke-exit', 'killSelf', getCallstack(), message)
  error(`I have been killed, will not restart.`)
}

async function killOther() {
  const requestId = generateUUID()
  if (logFlags.verbose) info(`Explicitly injecting reportLost, requestId: ${requestId}`)
  let target = activeByIdOrder[0]
  if (target.id === Self.id) target = activeByIdOrder[1]
  scheduleLostReport(target, 'killother', requestId)
}

export function scheduleLostReport(target: P2P.NodeListTypes.Node, reason: string, requestId: string) {
  if (!config.p2p.aggregateLostReportsTillQ1) return reportLost(target, reason, requestId)
  if (requestId.length == 0) requestId = generateUUID()
  if (logFlags.verbose) {
    info(`Scheduling lost report for ${target.id}, requestId: ${requestId}.`)
    info(`Target node details for requestId: ${requestId}: ${logNode(target)}`)
    info(`Scheduled lost report in ${currentCycle} for requestId: ${requestId}.`)
  }

  const key = `${target.id}-${currentCycle}`

  if (scheduledForLostReport.has(key)) {
    const previousScheduleValue = scheduledForLostReport.get(key)
    if (logFlags.verbose) {
      /* prettier-ignore */ info(`Target node ${target.id} already scheduled for lost report. requestId: ${previousScheduleValue.requestId}.`)
      /* prettier-ignore */ info(`Previous scheduled lost report details for ${target.id}: ${utils.stringify(previousScheduleValue)}`)
    }
  }
  scheduledForLostReport.set(key, {
    reason: reason,
    targetNode: target,
    timestamp: shardusGetTime(),
    scheduledInCycle: currentCycle,
    requestId: requestId,
  })
}

/**
 * This gets called from Shardus when network module emits timeout or error
 *
 * This code will call 'lost-report' on another node which will help it do the actual down check
 *
 * currently this down check is a bit of a hack as it uses the 'apoptosize' route with a param
 * to indicate that it is not a normal apoptosize action
 *
 * @param target
 * @param reason
 * @param requestId
 * @returns
 */
function reportLost(target, reason: string, requestId: string) {
  try {
    /* prettier-ignore */ if (logFlags.verbose) info(`Reporting lost for ${target.id}, requestId: ${requestId}.`)
    /* prettier-ignore */ if (logFlags.verbose) info(`Target node details for requestId: ${requestId}: ${logNode(target)}`)
    if (target.id === Self.id) {
      nestedCountersInstance.countEvent('p2p', 'reportLost skip: self')
      return // don't report self
    }
    if (stopReporting[target.id]) {
      nestedCountersInstance.countEvent('p2p', 'reportLost skip: already stopped reporting')
      return // this node already appeared in the lost field of the cycle record, we dont need to keep reporting
    }
    if (nodes.get(target.id)?.status === 'syncing') {
      nestedCountersInstance.countEvent('p2p', 'reportLost skip: node syncing')
      return // don't report syncing nodes
    }
    if (nodes.get(target.id)?.status === 'selected') {
      nestedCountersInstance.countEvent('p2p', 'reportLost skip: node selected')
      return // don't report selected nodes
    }
    // we set isDown cache to the cycle number here; to speed up deciding if a node is down
    isDown[target.id] = currentCycle
    const key = `${target.id}-${currentCycle}`
    const lostRec = lostReported.get(key)
    if (lostRec) return // we have already seen this node for this cycle
    let obj = { target: target.id, status: 'reported', cycle: currentCycle }
    let lostCycle = currentCycle
    let checkerNodes = getMultipleCheckerNodes(target.id, lostCycle, Self.id)
    for (let checker of checkerNodes) {
      // const checker = getCheckerNode(target.id, currentCycle)
      if (checker.id === Self.id && activeByIdOrder.length >= 3) return // we cannot be reporter and checker if there is 3 or more nodes in the network
      let report: P2P.LostTypes.LostReport = {
        target: target.id,
        checker: checker.id,
        reporter: Self.id,
        cycle: currentCycle,
      }
      // [TODO] - remove the following line after testing killother
      if (allowKillRoute && reason === 'killother') report.killother = true
      if (logFlags.verbose) {
        /* prettier-ignore */ info(`Sending investigate request. requestId: ${requestId}, reporter: ${Self.ip}:${Self.port} id: ${Self.id}`)
        /* prettier-ignore */ info(`Sending investigate request. requestId: ${requestId}, checker: ${checker.internalIp}:${checker.internalPort} node details: ${logNode(checker)}`)
        /* prettier-ignore */ info(`Sending investigate request. requestId: ${requestId}, target: ${target.internalIp}:${target.internalPort} cycle: ${report.cycle} node details: ${logNode(target)}`)
        /* prettier-ignore */ info(`Sending investigate request. requestId: ${requestId}, msg: ${JSON.stringify(report)}`)
      }

      const msgCopy = JSON.parse(shardusCrypto.stringify(report))
      msgCopy.timestamp = shardusGetTime()
      msgCopy.requestId = requestId
      report = crypto.sign(msgCopy)
      lostReported.set(key, report)
      Comms.tell([checker], 'lost-report', report)
    }
  } catch (ex) {
    nestedCountersInstance.countEvent('p2p', `reportLost error ${shardusGetTime()}`)
    error('reportLost: ' + utils.formatErrorMessage(ex))
  }
}

function getMultipleCheckerNodes(
  target: string,
  lostCycle: number,
  reporter: string
): P2P.NodeListTypes.Node[] {
  let checkerNodes: Map<string, P2P.NodeListTypes.Node> = new Map()
  let obj = { target, cycle: lostCycle }
  let key = crypto.hash(obj)
  const firstFourBytesOfMarker = key.slice(0, 8)
  const offset = parseInt(firstFourBytesOfMarker, 16)
  let pickedIndexes = utils.getIndexesPicked(activeByIdOrder.length, config.p2p.numCheckerNodes, offset)
  for (let i = 0; i < pickedIndexes.length; i++) {
    let pickedIndex = pickedIndexes[i]
    if (activeByIdOrder[pickedIndex].id === reporter) {
      pickedIndex += 1
      pickedIndex = pickedIndex % activeByIdOrder.length // make sure we dont go out of bounds
    }
    if (activeByIdOrder[pickedIndex].id === target) {
      pickedIndex += 1
      pickedIndex = pickedIndex % activeByIdOrder.length // make sure we dont go out of bounds
    }
    if (checkerNodes.has(activeByIdOrder[pickedIndex].id)) {
      pickedIndex += 1
      pickedIndex = pickedIndex % activeByIdOrder.length // make sure we dont go out of bounds
    }
    checkerNodes.set(activeByIdOrder[pickedIndex].id, activeByIdOrder[pickedIndex])
  }
  let selectedNodes = [...checkerNodes.values()]
  if (logFlags.verbose)
    info(
      `in getMultipleCheckerNodes checkerNodes for target: ${target}, reporter: ${reporter}, cycle: ${lostCycle}: ${JSON.stringify(
        selectedNodes
      )}`
    )
  return selectedNodes
}

function removeByApp(target: P2P.NodeListTypes.Node, certificate: P2P.LostTypes.RemoveCertificate) {
  if (logFlags.verbose) info(`Gossip remove for ${target}`)
  if (target.id === Self.id) {
    nestedCountersInstance.countEvent('p2p', 'removeByApp skip: self')
    return // don't report self
  }
  // we set isDown cache to the cycle number here; to speed up deciding if a node is down
  isDown[target.id] = currentCycle

  const removedRec = appRemoved.get(target.id)
  if (removedRec) return // we have already removed this node for this cycle
  appRemoved.set(target.id, { certificate, target: target.id })
  Comms.sendGossip('remove-by-app', certificate, '', Self.id, byIdOrder, true)
}

function getCheckerNode(id, cycle) {
  const obj = { id, cycle }
  const near = crypto.hash(obj)
  function compareNodes(i, r) {
    return i > r.id ? 1 : i < r.id ? -1 : 0
  }
  let idx = binarySearch(activeByIdOrder, near, compareNodes)
  const oidx = idx
  if (idx < 0) idx = (-1 - idx) % activeByIdOrder.length
  const foundNode = activeByIdOrder[idx]
  if (foundNode == null) {
    throw new Error(`activeByIdOrder idx:${idx} length: ${activeByIdOrder.length}`)
  }
  if (foundNode.id === id) idx = (idx + 1) % activeByIdOrder.length // skip to next node if the selected node is target
  if (logFlags.verbose) {
    info(`in getCheckerNode oidx:${oidx} idx:${idx} near:${near}  cycle:${cycle}  id:${id}`)
    info(`${JSON.stringify(activeByIdOrder.map((n) => n.id))}`)
  }
  return activeByIdOrder[idx]
}

async function lostReportHandler(payload, response, sender) {
  profilerInstance.scopedProfileSectionStart('lost-report')
  try {
    let requestId = generateUUID()
    /* prettier-ignore */ if (logFlags.verbose) info(`Got investigate request requestId: ${requestId}, req: ${JSON.stringify(payload)} from ${logNode(sender)}`)
    let err = ''
    // for request tracing
    err = validateTypes(payload, { timestamp: 'n', requestId: 's' })
    if (!err) {
      /* prettier-ignore */ if (logFlags.verbose) info(`Lost report tracing, requestId: ${payload.requestId}, timestamp: ${payload.timestamp}, sender: ${logNode(sender)}`)
      requestId = payload.requestId
    }
    err = validateTypes(payload, { target: 's', reporter: 's', checker: 's', cycle: 'n', sign: 'o' })
    if (err) {
      warn(`requestId: ${requestId} bad input ${err}`)
      return
    }
    err = validateTypes(payload.sign, { owner: 's', sig: 's' })
    if (err) {
      warn(`requestId: ${requestId} bad input ${err}`)
      return
    }
    if (stopReporting[payload.target]) return // this node already appeared in the lost field of the cycle record, we dont need to keep reporting
    const key = `${payload.target}-${payload.cycle}`
    if (checkedLostRecordMap.get(key)) return // we have already seen this node for this cycle
    const [valid, reason] = checkReport(payload, currentCycle + 1)
    if (!valid) {
      warn(`Got bad investigate request. requestId: ${requestId}, reason: ${reason}`)
      return
    }
    if (sender !== payload.reporter) return // sender must be same as reporter
    if (payload.checker !== Self.id) return // the checker should be our node id
    let record: P2P.LostTypes.LostRecord = {
      target: payload.target,
      cycle: payload.cycle,
      status: 'checking',
      message: payload,
      reporter: payload.reporter,
      checker: payload.checker,
    }
    // check if we already know that this node is down
    if (isDown[payload.target]) {
      record.status = 'down'
      return
    }
    let result = await isDownCache(nodes.get(payload.target), requestId)
    /* prettier-ignore */ if (logFlags.verbose) info(`isDownCache for requestId: ${requestId}, result ${result}`)
    if (allowKillRoute && payload.killother) result = 'down'
    if (record.status === 'checking') record.status = result
    if (logFlags.verbose)
      info(
        `Status after checking for node ${payload.target} payload cycle: ${payload.cycle}, currentCycle: ${currentCycle} is ` +
          record.status
      )
    if (!checkedLostRecordMap.has(key)) {
      checkedLostRecordMap.set(key, record)
    }
    // At start of Q1 of the next cycle sendRequests() will start a gossip if the node was found to be down
  } finally {
    profilerInstance.scopedProfileSectionEnd('lost-report')
  }
}

function checkReport(report, expectCycle) {
  if (!report || typeof report !== 'object') return [false, 'no report given']
  if (!report.reporter || typeof report.reporter !== 'string') return [false, 'no reporter field']
  if (!report.checker || typeof report.checker !== 'string') return [false, 'no checker field']
  if (!report.target || typeof report.target !== 'string') return [false, 'no target field']
  if (!report.cycle || typeof report.cycle !== 'number') return [false, 'no cycle field']
  if (!report.sign || typeof report.sign !== 'object') return [false, 'no sign field']
  if (report.target == Self.id) return [false, 'target is self'] // Don' accept if target is our node
  const cyclediff = expectCycle - report.cycle
  if (cyclediff < 0) return [false, 'reporter cycle is not as expected; too new']
  if (cyclediff >= 2) return [false, 'reporter cycle is not as expected; too old']
  if (report.target === report.reporter) return [false, 'target cannot be reporter'] // the target should not be the reporter
  if (report.checker === report.target) return [false, 'target cannot be checker'] // the target should not be the reporter
  if (report.checker === report.reporter) {
    if (activeByIdOrder.length >= 3) return [false, 'checker cannot be reporter']
  }
  if (!nodes.has(report.target)) return [false, 'target not in network']
  if (!nodes.has(report.reporter)) return [false, 'reporter not in network']
  if (!nodes.has(report.checker)) return [false, 'checker not in network']
  try {
    let checkerNodes = getMultipleCheckerNodes(report.target, report.cycle, report.reporter)
    let checkNodeIds = checkerNodes.map((node) => node.id)
    if (!checkNodeIds.includes(report.checker)) {
      error(`checkReport: report.checker ${report.checker} is not one of the valid checkers ${checkNodeIds}`)
      return [
        false,
        `report.checker ${report.checker} is not part of eligible checkers: ${utils.stringifyReduce(
          checkNodeIds
        )}`,
      ]
    }
  } catch (ex) {
    error('checkReport: ' + utils.formatErrorMessage(ex))
    return [false, `checker node look up fail ${report.checker}`] // we should be the checker based on our own calculations
  }
  if (!crypto.verify(report, nodes.get(report.reporter).publicKey)) return [false, 'bad sign from reporter'] // the report should be properly signed
  return [true, '']
}

/*
This cache uses two lookup tables: isUp and isDown
The tables map a node id to the cycle counter when the node up/down status was checked
When we check a node and find it to be up we set isUp[node_id] = current_cycle_counter
When we check a node and find it to be down we set isDown[node_id] = current_cycle_counter
At the start of each cycle we delete entries in the tables that are older than 5 cycles.
A conditional check for an entry that is not in the table has a result of false
and a conditional check for a nonzero entry has a result of true.
We export the isDown table so that other modules can easily check if a node is down.
However, if isDown returns false it does not mean that a node is not actually down.
But if it returns true it means that the node was found to be down recently.
Also if isUp returns false it does not mean that a node is actually not up, but if it
returns true it means that it was found to be up recently.
*/
async function isDownCache(node, requestId: string) {
  // First check the isUp isDown caches to see if we already checked this node before
  const id = node.id

  if (config.p2p.isDownCacheEnabled) {
    if (isDown[id]) {
      /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', 'isDownCheck-skipped-down', 1)
      if (logFlags.verbose) info(`node with id ${node.id} found in isDown for requestId: ${requestId}`)
      return 'down'
    }
    if (isUp[id]) {
      /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', 'isDownCheck-skipped-up', 1)
      if (logFlags.verbose) info(`node with id ${node.id} found in isUp for requestId: ${requestId}`)
      return 'up'
    }
  }
  const status = await isDownCheck(node)
  if (logFlags.verbose)
    info(`isDownCheck for requestId: ${requestId} on node with id ${node.id} is ${status}`)
  if (status === 'down') {
    isDown[id] = currentCycle
  } else {
    isUp[id] = currentCycle
  }
  return status
}

export function setIsUpTs(nodeId: string) {
  let timestamp = shardusGetTime()
  isUpTs[nodeId] = timestamp
}

export function isNodeUpRecent(
  nodeId: string,
  maxAge: number
): { upRecent: boolean; state: string; age: number } {
  let lastCheck = isUpTs[nodeId]
  let age = shardusGetTime() - lastCheck

  if (isNaN(age)) {
    return { upRecent: false, state: 'noLastState', age }
  }

  if (age < maxAge) return { upRecent: true, state: 'up', age }
  return { upRecent: false, state: 'noLastState', age }
}

export function isNodeDown(nodeId: string): { down: boolean; state: string } {
  // First check the isUp isDown caches to see if we already checked this node before
  if (isDown[nodeId]) return { down: true, state: 'down' }
  if (isUp[nodeId]) return { down: false, state: 'up' }
  return { down: false, state: 'noLastState' }
}

export function isNodeLost(nodeId: string): boolean {
  // First check the isUp isDown caches to see if we already checked this node before
  const key = `${nodeId}-${currentCycle}`
  const lostRec = receivedLostRecordMap.get(key)
  if (lostRec != null) {
    return true
  }
  return false
}

export function removeNodeWithCertificiate(certificate: P2P.LostTypes.RemoveCertificate): void {
  const [success, message] = verifyRemoveCertificate(certificate, currentCycle - 1)
  if (!success) {
    error(`Bad certificate. reason:${message}`)
    return
  }
  const node = byPubKey.get(certificate.nodePublicKey)
  if (node == null) {
    /* prettier-ignore */
    error(`Target remove node ${certificate.nodePublicKey} is not found in the activeList`);
    return
  }
  if (scheduledRemoveApp.has(certificate.nodePublicKey)) {
    const previousScheduleValue = scheduledRemoveApp.get(certificate.nodePublicKey)
    if (logFlags.verbose) {
      /* prettier-ignore */ info(`Target node ${certificate.nodePublicKey} already scheduled for removing.`)
      /* prettier-ignore */ info(`Previous scheduled lost report details for ${certificate.nodePublicKey}: ${utils.stringify(previousScheduleValue)}`)
    }
    return
  }
  scheduledRemoveApp.set(certificate.nodePublicKey, {
    target: node,
    reason: 'remove-by-app',
    certificate,
    timestamp: shardusGetTime(),
  })
}

// This is called once per cycle by reset
function pruneIsDown() {
  const cachePruneAge = config.p2p.isDownCachePruneCycles

  for (const [key, value] of Object.entries(isDown)) {
    if (typeof value === 'number' && value < currentCycle - cachePruneAge) delete isDown[key]
  }
  for (const [key, value] of Object.entries(isUp)) {
    if (typeof value === 'number' && value < currentCycle - cachePruneAge) delete isUp[key]
  }
}

function pruneStopReporting() {
  const stopReportingPruneCycles = config.p2p.stopReportingLostPruneCycles

  for (const [key, value] of Object.entries(stopReporting)) {
    if ((value as number) < currentCycle - stopReportingPruneCycles) delete stopReporting[key]
  }
}

// Make sure that both the external and internal ports are working
//   if either is not working then the node is considered down.
// If internal and external are both on the same IP then only need to check one.
// This function has some deep knowledge from Sync and Apoptosis APIs
//    and could break if they are changed.
// [TODO] - create our own APIs to test the internal and external connection.
//          Although this could allow a rouge node to more easily fool checks.
async function isDownCheck(node) {
  // Check the internal route
  // The timeout for this is controled by the network.timeout paramater in server.json
  if (logFlags.verbose) info(`Checking internal connection for ${node.id}, cycle: ${currentCycle}`)

  try {
    if (config.p2p.useProxyForDownCheck) {
      //using the 'apoptosize' route to check if the node is up.
      let obj = { counter: currentCycle, checker: Self.id, target: node.id, timestamp: shardusGetTime() }
      let hash = crypto.hash(obj)
      let closestNodes = stateManager.getClosestNodes(hash, 5, true)
      let proxyNode: P2P.NodeListTypes.Node
      for (let closetNode of closestNodes) {
        if (closetNode.id !== node.id) {
          proxyNode = closetNode
          break
        }
      }
      if (proxyNode == null) {
        throw new Error(`isDownCheck unable to get proxy node to check the target node`)
      }
      let hashTrieReq: HashTrieReq = {
        radixList: ['0'],
      }

      let proxyRequest: ProxyRequest = {
        nodeId: node.id,
        route: 'get_trie_hashes',
        message: hashTrieReq,
      }
      const res = await Comms.ask(proxyNode, 'proxy', proxyRequest, true, '', 3000)
      if (logFlags.verbose)
        info(`lost check result for node ${node.id} cycle ${currentCycle} is ${utils.stringifyReduce(res)}`)
      if (res == null || res.success === false || res.response == null || res.response.isResponse == null) {
        /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', 'isDownCheck-down-proxy-fail', 1)
        return 'down'
      }
      let nodeHashes = res.response.nodeHashes
      if (nodeHashes == null || nodeHashes.length === 0) {
        /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', 'isDownCheck-down-via-proxy-empty-hashes', 1)
        return 'down'
      }
    } else {
      //using the 'apoptosize' route to check if the node is up.
      const res = await Comms.askBinary<ApoptosisProposalReq, ApoptosisProposalResp>(
        node,
        'apoptosize',
        {
          id: 'isDownCheck',
          when: 1,
        },
        serializeApoptosisProposalReq,
        deserializeApoptosisProposalResp,
        {}
      )
      if (res == null) {
        /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', 'isDownCheck-down-0', 1)
        return 'down'
      }
      if (typeof res.s !== 'string') {
        /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', 'isDownCheck-down-1', 1)
        return 'down'
      }
      //adding this check so that a node can repond that is is down. aka, realizes it is not funcitonal and wants to be removed from the network
      if (res.s === nodeDownString) {
        /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', 'isDownCheck-down-self-reported-zombie', 1)
        return 'down'
      }
    }
  } catch (e) {
    /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', 'isDownCheck-down-2', 1)
    return 'down'
  }

  //Note 20230630:  the code below here has not likely had any coverage for a few years due to an upstream issue

  if (node.externalIp === node.internalIp) return 'up'
  if (logFlags.verbose) info(`Checking external connection for ${node.id}`)
  // Check the external route if ip is different than internal
  const queryExt = async (node) => {
    const ip = node.ip ? node.ip : node.externalIp
    const port = node.port ? node.port : node.externalPort
    // the queryFunction must return null if the given node is our own
    // while syncing nodeList we dont have node.id, so use ip and port
    if (ip === Self.ip && port === Self.port) return null
    const resp: { newestCycle: CycleData } = await http.get(`${ip}:${port}/sync-newest-cycle`)
    return resp
  }
  const resp = await queryExt(node) // if the node is down, reportLost() will set status to 'down'
  try {
    if (typeof resp.newestCycle.counter !== 'number') return 'down'
  } catch {
    /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', 'isDownCheck-down-3', 1)
    return 'down'
  }
  /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', 'isDownCheck-up-1', 1)
  return 'up'
}

function downGossipHandler(payload: P2P.LostTypes.SignedDownGossipMessage, sender, tracker) {
  if (logFlags.verbose) info(`Got downGossip: ${JSON.stringify(payload)}`)
  let err = ''
  err = validateTypes(payload, { cycle: 'n', report: 'o', status: 's', sign: 'o' })
  if (err) {
    warn('bad input ' + err)
    return
  }
  err = validateTypes(payload.report, { target: 's', reporter: 's', checker: 's', cycle: 'n', sign: 'o' })
  if (err) {
    warn('bad input report ' + err)
    return
  }
  err = validateTypes(payload.report.sign, { owner: 's', sig: 's' })
  if (err) {
    warn('bad input report sign ' + err)
    return
  }
  err = validateTypes(payload.sign, { owner: 's', sig: 's' })
  if (err) {
    warn('bad input sign ' + err)
    return
  }
  const key = `${payload.report.target}-${payload.report.cycle}`
  const checkedRecord = checkedLostRecordMap.get(key)
  if (checkedRecord && ['up', 'down'].includes(checkedRecord.status)) {
    return // we have already gossiped this node for this cycle
  }
  const alreadyProcessedLostRecord = receivedLostRecordMap.get(key)
    ? receivedLostRecordMap.get(key).get(payload.report.checker)
    : null
  if (alreadyProcessedLostRecord && ['up', 'down'].includes(alreadyProcessedLostRecord.status)) {
    return // we have already gossiped this node for this cycle
  }
  let [valid, reason] = checkQuarter(payload.report.checker, sender)
  if (!valid) {
    warn(`Bad downGossip message. reason:${reason} message:${JSON.stringify(payload)}`)
    warn(`cycle:${currentCycle} quarter:${currentQuarter} sender:${sender}`)
    return
  }
  ;[valid, reason] = checkDownMsg(payload, currentCycle)
  if (!valid) {
    warn(`Bad downGossip message. reason:${reason}. message:${JSON.stringify(payload)}`)
    warn(`cycle:${currentCycle} quarter:${currentQuarter} sender:${sender}`)
    return
  }
  let receivedRecord: P2P.LostTypes.LostRecord = {
    target: payload.report.target,
    cycle: payload.report.cycle,
    status: 'down',
    message: payload,
    checker: payload.report.checker,
    reporter: payload.report.reporter,
  }
  if (receivedLostRecordMap.has(key) && receivedLostRecordMap.get(key).has(payload.report.checker)) {
    if (logFlags.verbose)
      info(`downGossip already seen and processed. report ${JSON.stringify(payload.report)}`)
    return
  }
  if (receivedLostRecordMap.has(key)) {
    receivedLostRecordMap.get(key).set(payload.report.checker, receivedRecord)
  } else {
    receivedLostRecordMap.set(key, new Map())
    receivedLostRecordMap.get(key).set(payload.report.checker, receivedRecord)
  }
  if (logFlags.verbose)
    info(
      `downGossip for target ${payload.report.target} at cycle ${
        payload.report.cycle
      } is processed. Total received: ${receivedLostRecordMap.get(key).size}`
    )
  Comms.sendGossip('lost-down', payload, tracker, Self.id, byIdOrder, false)
  // After message has been gossiped in Q1 and Q2 we wait for getTxs() to be invoked in Q3
}

// Fn is used to limit gossip to Q1 and Q2 of the cycle and stop originator from gossiping in Q2
function checkQuarter(source, sender) {
  if (![1, 2].includes(currentQuarter)) return [false, 'not in Q1 or Q2']
  if (sender === source && currentQuarter === 2) return [false, 'originator cannot gossip in Q2']
  return [true, '']
}

function checkDownMsg(payload: P2P.LostTypes.SignedDownGossipMessage, expectedCycle: number) {
  if (payload.cycle !== expectedCycle) return [false, 'checker cycle is not as expected']
  const [valid, reason] = checkReport(payload.report, expectedCycle - 1)
  if (!valid) return [valid, reason]
  if (!crypto.verify(payload, nodes.get(payload.report.checker).publicKey))
    return [false, `bad sign from checker.`]
  return [true, '']
}

function upGossipHandler(payload, sender, tracker) {
  if (logFlags.verbose) info(`Got upGossip: ${JSON.stringify(payload)}`)
  let err = ''
  err = validateTypes(payload, { cycle: 'n', target: 's', status: 's', sign: 'o' })
  if (err) {
    warn('bad input ' + err)
    return
  }
  err = validateTypes(payload.sign, { owner: 's', sig: 's' })
  if (err) {
    warn('bad input sign ' + err)
    return
  }
  if (!stopReporting[payload.target]) {
    warn('Bad upGossip. We did not see this node in the lost field, but got a up msg from it; ignoring it')
    return
  }
  let [valid, reason] = checkQuarter(payload.target, sender)
  if (!valid) {
    warn(`Bad upGossip message. reason:${reason} message:${JSON.stringify(payload)}`)
    return
  }
  const key = `${payload.target}-${payload.cycle}`
  const rec = upGossipMap.get(key)
  if (rec && rec.status === 'up') return // we have already gossiped this node for this cycle
  ;[valid, reason] = checkUpMsg(payload, currentCycle)
  if (!valid) {
    warn(`Bad upGossip message. reason:${reason} message:${JSON.stringify(payload)}`)
    return
  }
  upGossipMap.set(key, payload)
  Comms.sendGossip('lost-up', payload, tracker, Self.id, byIdOrder, false)
  // the getTxs() function will loop through the lost object to make txs in Q3 and build the cycle record from them
}

function removeByAppHandler(payload: P2P.LostTypes.RemoveCertificate, sender, tracker) {
  const [success, message] = verifyRemoveCertificate(payload, currentCycle - 2)
  if (!success) {
    error(`Bad certificate. reason:${message}`)
    return
  }
  const target = byPubKey.get(payload.nodePublicKey).id
  const rec = appRemoved.get(target)
  if (rec) return // we have already gossiped this node for this cycle
  let [valid, reason] = checkQuarter(target, sender)
  if (!valid) {
    warn(`Bad downGossip message. reason:${reason} message:${JSON.stringify(payload)}`)
    warn(`cycle:${currentCycle} quarter:${currentQuarter} sender:${sender}`)
    return
  }
  appRemoved.set(target, { target: target, certificate: payload })
  Comms.sendGossip('remove-by-app', payload, tracker, Self.id, byIdOrder, false)
}

function checkUpMsg(payload: P2P.LostTypes.SignedUpGossipMessage, expectedCycle) {
  if (!nodes.has(payload.target))
    return [false, `target is not an active node  ${payload.target}  ${JSON.stringify(activeByIdOrder)}`]
  if (!crypto.verify(payload, nodes.get(payload.target).publicKey)) return [false, 'bad sign from target']
  return [true, '']
}

function checkRemoveByAppMsg(payload: P2P.LostTypes.RemoveByAppMessage, expectedCycle) {
  if (!nodes.has(payload.target))
    return [false, `target is not an active node  ${payload.target}  ${JSON.stringify(activeByIdOrder)}`]
  // todo: verify signature
  // if (!crypto.verify(payload, nodes.get(payload.target).publicKey)) return [false, 'bad sign from target']
  return [true, '']
}

function verifyRemoveCertificate(certificate: P2P.LostTypes.RemoveCertificate, cycle: number) {
  if (!certificate) return [false, 'no certificate given']
  if (!certificate.nodePublicKey || typeof certificate.nodePublicKey !== 'string')
    return [false, 'no nodePublicKey field']
  const node = byPubKey.get(certificate.nodePublicKey)
  if (!node) return [false, 'nodePublicKey not in network']
  if (node.publicKey !== certificate.nodePublicKey) return [false, 'nodePublicKey does not match node']
  // the cycle should be the previous cycle when processing
  if (certificate.cycle !== cycle)
    return [false, `cycle is not as expected. certificate.cycle: ${certificate.cycle} expected: ${cycle}`]

  const { success, reason } = shardus.validateClosestActiveNodeSignatures(
    certificate,
    certificate.signs,
    4,
    5,
    2
  )
  if (!success) return [false, reason]
  return [true, '']
}

function info(...msg) {
  const entry = `Lost: ${msg.join(' ')}`
  p2pLogger.info(entry)
}

function warn(...msg) {
  const entry = `Lost: ${msg.join(' ')}`
  p2pLogger.warn(entry)
}

function error(...msg) {
  const entry = `Lost: ${msg.join(' ')}`
  p2pLogger.error(entry)
}
