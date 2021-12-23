import deepmerge from 'deepmerge'
import { Handler } from 'express'
import { isDeepStrictEqual } from 'util'
import { version } from '../../package.json'
import * as http from '../http'
import { logFlags } from '../logger'
import { P2P } from '@shardus/types'
import * as utils from '../utils'
import { validateTypes } from '../utils'
import * as Comms from './Comms'
import { config, crypto, logger, network, shardus } from './Context'
import * as CycleChain from './CycleChain'
import * as CycleCreator from './CycleCreator'
import * as NodeList from './NodeList'
import * as Self from './Self'
import { robustQuery } from './Utils'
import { profilerInstance } from '../utils/profiler'
import { nestedCountersInstance } from '../utils/nestedCounters'

/** STATE */

let p2pLogger

let requests: P2P.JoinTypes.JoinRequest[]
let seen: Set<P2P.P2PTypes.Node['publicKey']>

let lastLoggedCycle = 0

/** ROUTES */

const cycleMarkerRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'cyclemarker',
  handler: (_req, res) => {
    const marker = CycleChain.newest
      ? CycleChain.newest.previous
      : '0'.repeat(64)
    res.json(marker)
  },
}

const joinRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'POST',
  name: 'join',
  handler: (req, res) => {
    const joinRequest = req.body
    if (CycleCreator.currentQuarter < 1) {
      // if currentQuater <= 0 then we are not ready
      res.end()
      return
    }

    //  Validate of joinReq is done in addJoinRequest
    if (addJoinRequest(joinRequest)) {
      Comms.sendGossip('gossip-join', joinRequest, '', null, NodeList.byIdOrder, true)
    }
    res.end()
  },
}

const joinedRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'joined/:publicKey',
  handler: (req, res) => {
    // Respond with id if node's join request was accepted, otherwise undefined
    let err = utils.validateTypes(req, { params: 'o' })
    if (err) {
      warn('joined/:publicKey bad req ' + err)
      res.json()
    }
    err = utils.validateTypes(req.params, { publicKey: 's' })
    if (err) {
      warn('joined/:publicKey bad req.params ' + err)
      res.json()
    }
    const publicKey = req.params.publicKey
    const node = NodeList.byPubKey.get(publicKey)
    res.json({ node })
  },
}

const gossipJoinRoute: P2P.P2PTypes.GossipHandler<P2P.JoinTypes.JoinRequest, P2P.NodeListTypes.Node['id']> = (
  payload,
  sender,
  tracker
) => {
  profilerInstance.scopedProfileSectionStart('gossip-join')
  try {
    // Do not forward gossip after quarter 2
    if (CycleCreator.currentQuarter >= 3) return

    //  Validate of payload is done in addJoinRequest
    if (addJoinRequest(payload)) Comms.sendGossip('gossip-join', payload, tracker, sender, NodeList.byIdOrder, false)
  } finally {
    profilerInstance.scopedProfileSectionEnd('gossip-join')
  }
}

const routes = {
  external: [cycleMarkerRoute, joinRoute, joinedRoute],
  gossip: {
    'gossip-join': gossipJoinRoute,
  },
}

/** FUNCTIONS */

/** CycleCreator Functions */



export function init() {
  p2pLogger = logger.getLogger('p2p')

  // Init state
  reset()

  // Register routes
  for (const route of routes.external) {
    network._registerExternal(route.method, route.name, route.handler)
  }
  for (const [name, handler] of Object.entries(routes.gossip)) {
    Comms.registerGossipHandler(name, handler)
  }
}

export function reset() {
  requests = []
  seen = new Set()
}

export function getNodeRequestingJoin() : P2P.P2PTypes.P2PNode[] {
  let nodes: P2P.P2PTypes.P2PNode[] = []
  for(let request of requests){
    if(request && request.nodeInfo){
      nodes.push(request.nodeInfo)
    }
  }
  return nodes
}


function calculateToAccept() {
  const desired = CycleChain.newest.desired
  const active = CycleChain.newest.active
  let maxJoin = config.p2p.maxJoinedPerCycle // [TODO] allow autoscaling to change this
  const syncing = NodeList.byJoinOrder.length - active
  const expired = CycleChain.newest.expired

  maxJoin = Math.floor(maxJoin * CycleCreator.scaleFactor)
  // If in safetyMode, set syncMax to safetyNum
  let syncMax =
    CycleChain.newest.safetyMode === true
      ? CycleChain.newest.safetyNum
      : Math.floor(config.p2p.maxSyncingPerCycle * CycleCreator.scaleFactor * CycleCreator.scaleFactorSyncBoost)

  //The first batch of nodes to join the network after the seed node server can join at a higher rate if firstCycleJoin is set
  //This first batch will sync the full data range from the seed node, which should be very little data
  //This get the network rolling faster, but also allows us to use a slightly higher base join rate because
  //we are not worrying on how it performs with small networks. < 25 nodes.
  if(active === 0 && config.p2p.firstCycleJoin ){
    maxJoin = Math.max(config.p2p.firstCycleJoin, maxJoin)
    syncMax += config.p2p.firstCycleJoin
  }
  //For a few cycles we can boost the max sync to account for firstCycleJoin nodes.
  if(CycleChain.newest.counter < 10 && config.p2p.firstCycleJoin){
    syncMax += config.p2p.firstCycleJoin
  }

  if(active > 0){
    let syncMaxLimit = 150 //todo make config
    if(syncMax > syncMaxLimit){
      nestedCountersInstance.countEvent('networkSize', `limit syncmax ${syncMax}=>${syncMaxLimit} cyc:${CycleCreator.currentCycle}`)
      syncMax = syncMaxLimit
    }
  }

  const canSync = syncMax - syncing

  let needed = 0

  // Always set needed to (desired - (active + syncing)) if its positive
  if (desired > active + syncing) {
    needed = desired - (active + syncing)
  }

  // If rotation is on, add expired to needed
  if (config.p2p.maxRotatedPerCycle > 0) {
    needed += expired
  }

  // Limit needed by canSync and maxJoin
  if (needed > canSync) {
    needed = canSync
  }
  if (needed > maxJoin) {
    needed = maxJoin
  }
  if (needed < 0) {
    needed = 0
  }

  let cycle = CycleChain.newest.counter
  if(cycle > lastLoggedCycle){
    lastLoggedCycle = cycle
    info('scale dump:' + JSON.stringify({cycle, scaleFactor:CycleCreator.scaleFactor,needed, desired, active, syncing, canSync, syncMax, maxJoin, expired ,scaleFactorSyncBoost:CycleCreator.scaleFactorSyncBoost  })  )
  }
  return needed
}

export function getTxs(): P2P.JoinTypes.Txs {
  // Omar - maybe we don't have to make a copy
  // [IMPORTANT] Must return a copy to avoid mutation
  const requestsCopy = deepmerge({}, requests)

  return {
    join: requestsCopy,
  }
}

export function validateRecordTypes(rec: P2P.JoinTypes.Record): string {
  let err = validateTypes(rec, { syncing: 'n', joinedConsensors: 'a' })
  if (err) return err
  for (const item of rec.joinedConsensors) {
    err = validateTypes(item, {
      activeTimestamp: 'n',
      address: 's',
      externalIp: 's',
      externalPort: 'n',
      internalIp: 's',
      internalPort: 'n',
      joinRequestTimestamp: 'n',
      publicKey: 's',
      cycleJoined: 's',
      counterRefreshed: 'n',
      id: 's',
    })
    if (err) return 'in joinedConsensors array ' + err
  }
  return ''
}

export function dropInvalidTxs(txs: P2P.JoinTypes.Txs): P2P.JoinTypes.Txs {
  const join = txs.join.filter((request) => validateJoinRequest(request))
  return { join }
}

export function updateRecord(
  txs: P2P.JoinTypes.Txs,
  record: P2P.CycleCreatorTypes.CycleRecord,
  _prev: P2P.CycleCreatorTypes.CycleRecord
) {
  const joinedConsensors = txs.join.map((joinRequest) => {
    const { nodeInfo, cycleMarker: cycleJoined } = joinRequest
    const id = computeNodeId(nodeInfo.publicKey, cycleJoined)
    const counterRefreshed = record.counter
    return { ...nodeInfo, cycleJoined, counterRefreshed, id }
  })

  record.syncing = NodeList.byJoinOrder.length - NodeList.activeByIdOrder.length
  record.joinedConsensors = joinedConsensors.sort()
}

export function parseRecord(record: P2P.CycleCreatorTypes.CycleRecord): P2P.CycleParserTypes.Change {
  const added = record.joinedConsensors
  return {
    added,
    removed: [],
    updated: [],
  }
}

/** Not used by Join */
export function sendRequests() {}

/** Not used by Join */
export function queueRequest(request) {}

/** Module Functions */

export async function createJoinRequest(
  cycleMarker
): Promise<P2P.JoinTypes.JoinRequest & P2P.P2PTypes.SignedObject> {
  // Build and return a join request
  const nodeInfo = Self.getThisNodeInfo()
  // TO-DO: Think about if the selection number still needs to be signed
  const proofOfWork = {
    compute: await crypto.getComputeProofOfWork(
      cycleMarker,
      config.p2p.difficulty
    ),
  }
  const joinReq = { nodeInfo, cycleMarker, proofOfWork, version }
  const signedJoinReq = crypto.sign(joinReq)
  if(logFlags.p2pNonFatal) info(`Join request created... Join request: ${JSON.stringify(signedJoinReq)}`)
  return signedJoinReq
}

export function addJoinRequest(joinRequest: P2P.JoinTypes.JoinRequest) {
  //  Validate joinReq
  let err = utils.validateTypes(joinRequest, {
    cycleMarker: 's',
    nodeInfo: 'o',
    sign: 'o',
  })
  if (err) {
    warn('join bad joinRequest ' + err)
    return false
  }
  err = utils.validateTypes(joinRequest.nodeInfo, {
    activeTimestamp: 'n',
    address: 's',
    externalIp: 's',
    externalPort: 'n',
    internalIp: 's',
    internalPort: 'n',
    joinRequestTimestamp: 'n',
    publicKey: 's',
  })
  if (err) {
    warn('join bad joinRequest.nodeInfo ' + err)
    return false
  }
  err = utils.validateTypes(joinRequest.sign, { owner: 's', sig: 's' })
  if (err) {
    warn('join bad joinRequest.sign ' + err)
    return false
  }

  if (joinRequest.version !== version) {
    warn(
      `version number is different. Our node version is ${version}. Join request node version is ${joinRequest.version}`
    )
    return false
  }
  let selectionKey

  if (typeof shardus.app.validateJoinRequest === 'function') {
    try {
      let validationResponse = shardus.app.validateJoinRequest(joinRequest)
      if (validationResponse.success !== true) {
        warn(`Validation of join request data is failed!`)
        return false
      }
      if (typeof validationResponse.data === 'string') {
        selectionKey = validationResponse.data
      }
    } catch (e) {
      warn(`shardus.app.validateJoinRequest failed due to ${e}`)
      return false
    }
  }
  const node = joinRequest.nodeInfo
  if(logFlags.p2pNonFatal) info(`Got join request for ${node.externalIp}:${node.externalPort}`)

  // Check if this node has already been seen this cycle
  if (seen.has(node.publicKey)) {
    if(logFlags.p2pNonFatal) info('Node has already been seen this cycle. Unable to add join request.')
    return false
  }

  // Mark node as seen for this cycle
  seen.add(node.publicKey)

  // Return if we already know about this node
  const ipPort = NodeList.ipPort(node.internalIp, node.internalPort)
  if (NodeList.byIpPort.has(ipPort)) {
    if(logFlags.p2pNonFatal) info('Cannot add join request for this node, already a known node.', JSON.stringify(NodeList.byIpPort.get(ipPort)))
    return false
  }

  // Compute how many join request to accept
  const toAccept = calculateToAccept()

  // Check if we are better than the lowest selectionNum
  const last = requests.length > 0 ? requests[requests.length - 1] : undefined
  /*
    (This is implemented on 22/12/2021 in commit 9bf8b052673d03e7b7ba0e36321bb8d2fee5cc37)
    To calculate selectionNumber, we now use the hash of selectionKey and cycle number
    Selection key is provided by the application , and we can hash that with the cycle number.
    For example the application may want to use the staking address or the POW.
    It should be something that the node cannot easily change to
    guess a high selection number. If we generate a network
    random number we have to be careful that a node inside the network
    does not have an advantage by having access to this info and
    is able to create a stronger selectionNum. If no selectionKey is provided,
    joining node public key and cycle number are hashed to calculate selectionNumber.
  */
  const selectionNum = crypto.hash({
    cycleNumber: CycleChain.newest.counter,
    selectionKey: selectionKey ? selectionKey : node.publicKey,
  })
  if (
    last &&
    requests.length >= toAccept &&
    !crypto.isGreaterHash(selectionNum, last.selectionNum)
  ) {
    if(logFlags.p2pNonFatal) info('Join request not better than lowest, not added.')
    return false
  }

  // TODO: call into application
  // ----- application should decide the ranking order of the join requests
  // ----- if hook doesn't exist, then we go with default order based on selection number
  // ----- hook signature = (currentList, newJoinRequest, numDesired) returns [newOrder, added]
  // ----- should create preconfigured hooks for adding POW, allowing join based on netadmin sig, etc.

  // Check the signature as late as possible since it is expensive
  if (!crypto.verify(joinRequest, joinRequest.nodeInfo.publicKey)) {
    warn('join bad sign ' + JSON.stringify(joinRequest))
    return false
  }
  // Insert sorted into best list if we made it this far
  utils.insertSorted(requests, { ...joinRequest, selectionNum }, (a, b) =>
    a.selectionNum < b.selectionNum
      ? 1
      : a.selectionNum > b.selectionNum
      ? -1
      : 0
  )
  if(logFlags.p2pNonFatal) info(
    `Added join request for ${joinRequest.nodeInfo.externalIp}:${joinRequest.nodeInfo.externalPort}`
  )

  // If we have > maxJoinedPerCycle requests, trim them down
  if(logFlags.p2pNonFatal) info(`Requests: ${requests.length}, toAccept: ${toAccept}`)
  if (requests.length > toAccept) {
    const over = requests.length - toAccept
    requests.splice(-over)
    //    info(`Over maxJoinedPerCycle; removed ${over} requests from join requests`)
  }

  return true
}

export async function firstJoin() {
  // Create join request from 000... cycle marker
  const zeroMarker = '0'.repeat(64)
  const request = await createJoinRequest(zeroMarker)
  // Add own join request
  utils.insertSorted(requests, request)
  // Return node ID
  return computeNodeId(crypto.keypair.publicKey, zeroMarker)
}

export async function fetchCycleMarker(nodes) {
  const queryFn = async (node) => {
    const marker = await http.get(`${node.ip}:${node.port}/cyclemarker`)
    return marker
  }

  function _isSameCycleMarkerInfo(info1, info2) {
    const cm1 = utils.deepCopy(info1)
    const cm2 = utils.deepCopy(info2)
    delete cm1.currentTime
    delete cm2.currentTime
    const equivalent = isDeepStrictEqual(cm1, cm2)
    if(logFlags.p2pNonFatal) info(`Equivalence of the two compared cycle marker infos: ${equivalent}`)
    return equivalent
  }

  const {topResult:marker} = await robustQuery(nodes, queryFn)
  return marker
}

export async function submitJoin(
  nodes: P2P.P2PTypes.Node[],
  joinRequest: P2P.JoinTypes.JoinRequest & P2P.P2PTypes.SignedObject
) {
  // Send the join request to a handful of the active node all at once:w
  const selectedNodes = utils.getRandom(nodes, Math.min(nodes.length, 5))
  const promises = []
  if(logFlags.p2pNonFatal) info(
    `Sending join request to ${selectedNodes.map((n) => `${n.ip}:${n.port}`)}`
  )
  for (const node of selectedNodes) {
    try {
      promises.push(
        http.post(`${node.ip}:${node.port}/join`, joinRequest).catch((err) => {
          error(
            `Join: submitJoin: Error posting join request to ${node.ip}:${node.port}`,
            err
          )
        })
      )
    } catch (err) {
      error(
        `Join: submitJoin: Error posting join request to ${node.ip}:${node.port}`,
        err
      )
    }
  }
  await Promise.all(promises)
}

export async function fetchJoined(activeNodes) {
  const queryFn = async (node) => {
    const publicKey = crypto.keypair.publicKey
    const res = await http.get(`${node.ip}:${node.port}/joined/${publicKey}`)
    return res
  }
  try {
    const {topResult:response, winningNodes:_responders} = await robustQuery(activeNodes, queryFn)
    if (!response) return
    if (!response.node) return
    let err = utils.validateTypes(response, { node: 'o' })
    if (err) {
      warn('fetchJoined invalid response response.node' + err)
      return
    }
    err = validateTypes(response.node, { id: 's' })
    if (err) {
      warn('fetchJoined invalid response response.node.id' + err)
      return
    }
    const node = response.node as P2P.NodeListTypes.Node
    return node.id
  } catch (err) {
    warn('Self: fetchNodeId: robustQuery failed: ', err)
  }
}

function validateJoinRequest(request: P2P.JoinTypes.JoinRequest) {
  // [TODO] Implement this
  return true
}

export function computeNodeId(publicKey, cycleMarker) {
  const nodeId = crypto.hash({ publicKey, cycleMarker })
  if(logFlags.p2pNonFatal) {
    info(
    `Node ID computation: publicKey: ${publicKey}, cycleMarker: ${cycleMarker}`
    )
    info(`Node ID is: ${nodeId}`)
  }
  return nodeId
}

function info(...msg) {
  const entry = `Join: ${msg.join(' ')}`
  p2pLogger.info(entry)
}

function warn(...msg) {
  const entry = `Join: ${msg.join(' ')}`
  p2pLogger.warn(entry)
}

function error(...msg) {
  const entry = `Join: ${msg.join(' ')}`
  p2pLogger.error(entry)
}
