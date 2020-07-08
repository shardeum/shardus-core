import deepmerge from 'deepmerge'
import { Handler } from 'express'
import { isDeepStrictEqual } from 'util'
import * as http from '../http'
import * as utils from '../utils'
import * as Comms from './Comms'
import { config, crypto, logger, network } from './Context'
import * as CycleChain from './CycleChain'
import * as CycleCreator from './CycleCreator'
import { Change } from './CycleParser'
import * as NodeList from './NodeList'
import * as Self from './Self'
import * as Types from './Types'
import { robustQuery } from './Utils'
import { validateTypes } from '../utils'

/** TYPES */

export interface JoinedConsensor extends Types.P2PNode {
  cycleJoined: CycleCreator.CycleMarker
  counterRefreshed: CycleCreator.CycleRecord['counter']
  id: string
}

export interface JoinRequest {
  nodeInfo: Types.P2PNode
  cycleMarker: CycleCreator.CycleMarker
  proofOfWork: string
  selectionNum: string
  sign: Sign
}

export interface Txs {
  join: JoinRequest[]
}

export interface Record {
  syncing: number
  joinedConsensors: JoinedConsensor[]
}

/** STATE */

let p2pLogger

let requests: JoinRequest[]
let seen: Set<Types.Node['publicKey']>

/** ROUTES */

const cycleMarkerRoute: Types.Route<Handler> = {
  method: 'GET',
  name: 'cyclemarker',
  handler: (_req, res) => {
    const marker = CycleChain.newest
      ? CycleChain.newest.previous
      : '0'.repeat(64)
    res.json(marker)
  },
}

const joinRoute: Types.Route<Handler> = {
  method: 'POST',
  name: 'join',
  handler: (req, res) => {

    // Dont accept join requests if you're not active
    // if (Self.isActive === false) {
    //   res.end()
    //   return
    // }

    // Omar - [TODO] - if currentQuater <= 0 then we are not ready
    //        just gossip this request to one other node
    if (CycleCreator.currentQuarter < 1) {
      //      Comms.sendGossipOne('gossip-join', joinRequest)
      res.end()
      return
    }

    // If not in quarter 1 of cycle, reply with resubmit time
    if (CycleCreator.currentQuarter !== 1) {
      const resubmit = CycleCreator.nextQ1Start
      res.json(resubmit)
      return
    }

    //  Validate of joinReq is done in addJoinRequest
    const joinRequest = req.body
    if (addJoinRequest(joinRequest)) {
      Comms.sendGossip('gossip-join', joinRequest)
    }
    res.end()
  }
}

const joinedRoute: Types.Route<Handler> = {
  method: 'GET',
  name: 'joined/:publicKey',
  handler: (req, res) => {
    // Respond with id if node's join request was accepted, otherwise undefined
    let err = utils.validateTypes(req,{params:'o'})
    if (err){
      warn('joined/:publicKey bad req '+err)
      res.json()
    }
    err = utils.validateTypes(req.params,{publicKey:'s'})
    if (err){
      warn('joined/:publicKey bad req.params '+err)
      res.json()
    }
    const publicKey = req.params.publicKey
    // [TODO] Validate input
    const node = NodeList.byPubKey.get(publicKey)
    res.json({ node })
  },
}

const gossipJoinRoute: Types.GossipHandler<JoinRequest, NodeList.Node['id']> = (
  payload,
  _sender
) => {
  // [TODO] Validate joinReq

  // Do not forward gossip after quarter 2
  if (CycleCreator.currentQuarter >= 3) return

    //  Validate of payload is done in addJoinRequest
  if (addJoinRequest(payload)) Comms.sendGossip('gossip-join', payload)
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

function calculateToAccept() {
  const desired = CycleChain.newest.desired
  const active = CycleChain.newest.active
  const maxJoin = config.p2p.maxJoinedPerCycle // [TODO] allow autoscaling to change this
  const syncing = NodeList.byJoinOrder.length - active
  const expired = CycleChain.newest.expired
  const syncMax = config.p2p.maxSyncingPerCycle // we dont want more than this many nodes to sync at the same stime
  const canSync = syncMax - syncing
  let needed = 0
  if (active < desired) {
    needed = desired - active
  } else {
    needed = expired
  }
  if (needed > canSync) {
    needed = canSync
  }
  if (needed > maxJoin) {
    needed = maxJoin
  }
  if (needed < 0) {
    needed = 0
  }
  return needed
}

export function getTxs(): Txs {
  // Omar - maybe we don't have to make a copy 
  // [IMPORTANT] Must return a copy to avoid mutation
  const requestsCopy = deepmerge({}, requests)

  return {
    join: requestsCopy,
  }
}

export function validateRecordTypes(rec: Record): string{
  let err = validateTypes(rec,{syncing:'n',joinedConsensors:'a'})
  if (err) return err
  for(const item of rec.joinedConsensors){
    err = validateTypes(item,{activeTimestamp:'n',address:'s',externalIp:'s',externalPort:'n',
      internalIp:'s',internalPort:'n',joinRequestTimestamp:'n',publicKey:'s',
      cycleJoined:'s',counterRefreshed:'n',id:'s'
    })
    if (err) return 'in joinedConsensors array '+err
  }
  return ''
}

export function dropInvalidTxs(txs: Txs): Txs {
  const join = txs.join.filter(request => validateJoinRequest(request))
  return { join }
}

export function updateRecord(
  txs: Txs,
  record: CycleCreator.CycleRecord,
  _prev: CycleCreator.CycleRecord
) {
  const joinedConsensors = txs.join.map(joinRequest => {
    const { nodeInfo, cycleMarker: cycleJoined } = joinRequest
    const id = computeNodeId(nodeInfo.publicKey, cycleJoined)
    const counterRefreshed = record.counter
    return { ...nodeInfo, cycleJoined, counterRefreshed, id }
  })

  record.syncing = NodeList.byJoinOrder.length - NodeList.activeByIdOrder.length
  record.joinedConsensors = joinedConsensors.sort()
}

export function parseRecord(record: CycleCreator.CycleRecord): Change {
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
): Promise<JoinRequest & Types.SignedObject> {
  // Build and return a join request
  const nodeInfo = Self.getThisNodeInfo()
  // Omar - [TODO] the join request should not have the selectionNum
  //        in it. It is calculated on the server.
  const selectionNum = crypto.hash({ cycleMarker, address: nodeInfo.address })
  // TO-DO: Think about if the selection number still needs to be signed
  const proofOfWork = {
    compute: await crypto.getComputeProofOfWork(
      cycleMarker,
      config.p2p.difficulty
    ),
  }
  // TODO: add a version number at some point
  // version: '0.0.0'
  const joinReq = { nodeInfo, cycleMarker, proofOfWork, selectionNum }
  const signedJoinReq = crypto.sign(joinReq)
  info(`Join request created... Join request: ${JSON.stringify(signedJoinReq)}`)
  return signedJoinReq
}

export function addJoinRequest(joinRequest: JoinRequest) {
  //  Validate joinReq
  let err = utils.validateTypes(joinRequest,{cycleMarker:'s',nodeInfo:'o',sign:'o'})
  if (err){
    warn('join bad joinRequest '+err)
    return false
  }
  err = utils.validateTypes(joinRequest.nodeInfo,{activeTimestamp:'n',address:'s',
    externalIp:'s',externalPort:'n',internalIp:'s',internalPort:'n',
    joinRequestTimestamp:'n',publicKey:'s'
  })
  if (err){
    warn('join bad joinRequest.nodeInfo '+err)
    return false
  }
  err = utils.validateTypes(joinRequest.sign,{owner:'s',sig:'s'})
  if (err){
    warn('join bad joinRequest.sign '+err)
    return false
  }

  const node = joinRequest.nodeInfo
  info(`Got join request for ${node.externalPort}`)

  // Check if this node has already been seen this cycle
  if (seen.has(node.publicKey)) {
    info('Node has already been seen this cycle. Unable to add join request.')
    return false
  }

  // Mark node as seen for this cycle
  seen.add(node.publicKey)

  // Return if we already know about this node
  const ipPort = NodeList.ipPort(node.internalIp, node.internalPort)
  if (NodeList.byIpPort.has(ipPort)) {
    info('Cannot add join request for this node, already a known node.')
    return false
  }

  // Check if we are better than the lowest selectionNum
  const last = requests.length > 0 ? requests[requests.length - 1] : undefined
  // Omar - [TODO] we need to calculate the selection based on the join
  //        request info and don't allow joining node to specify it.
  //        for now we can use the hash of node public key and cycle number
  //        but in the future the application will provide what to use
  //        and we can hash that with the cycle number. For example the
  //        application may want to use the steaking address or the POW.
  //        It should be something that the node cannot easily change to
  //        guess a high selection number. If we generate a network
  //        random number we have to be careful that a node inside the network
  //        does not have an advantage by having access to this info and
  //        is able to create a stronger selectionNum.
  if (
    last &&
    !crypto.isGreaterHash(joinRequest.selectionNum, last.selectionNum)
  ) {
//    info('Join request not better than lowest, not added.')
    return false
  }

  // TODO: call into application
  // ----- application should decide the ranking order of the join requests
  // ----- if hook doesn't exist, then we go with default order based on selection number
  // ----- hook signature = (currentList, newJoinRequest, numDesired) returns [newOrder, added]
  // ----- should create preconfigured hooks for adding POW, allowing join based on netadmin sig, etc.

  // Check the signature as late as possible since it is expensive
  if (! crypto.verify(joinRequest, joinRequest.nodeInfo.publicKey)){
    warn('join bad sign '+JSON.stringify(joinRequest))
    return false
  }

  // Insert sorted into best list if we made it this far
  utils.insertSorted(requests, joinRequest, (a, b) =>
    a.selectionNum < b.selectionNum
      ? 1
      : a.selectionNum > b.selectionNum
      ? -1
      : 0
  )
  info(`Added join request for ${joinRequest.nodeInfo.externalPort}`)

  // If we have > maxJoinedPerCycle requests, trim them down
  const toAccept = calculateToAccept()
  info(`Requests: ${requests.length}, toAccept: ${toAccept}`)
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
  const queryFn = async node => {
    const marker = await http.get(`${node.ip}:${node.port}/cyclemarker`)
    return marker
  }

  function _isSameCycleMarkerInfo(info1, info2) {
    const cm1 = utils.deepCopy(info1)
    const cm2 = utils.deepCopy(info2)
    delete cm1.currentTime
    delete cm2.currentTime
    const equivalent = isDeepStrictEqual(cm1, cm2)
    info(`Equivalence of the two compared cycle marker infos: ${equivalent}`)
    return equivalent
  }

  const [marker] = await robustQuery(nodes, queryFn)
  return marker
}

export async function submitJoin(nodes, joinRequest) {
  for (const node of nodes) {
    info(`Sending join request to ${node.ip}:${node.port}`)
    try {
      const resubmit = await http.post(
        `${node.ip}:${node.port}/join`,
        joinRequest
      )
      if (resubmit) return resubmit
    } catch (err) {
      error(`Join: submitJoin: Error posting join request to ${node.ip}:${node.port}`, err)
    }
  }
}

export async function fetchJoined(activeNodes) {
  const queryFn = async node => {
    const publicKey = crypto.keypair.publicKey
    const res = await http.get(`${node.ip}:${node.port}/joined/${publicKey}`)
    return res
  }
  try {
    const [response, _responders] = await robustQuery(activeNodes, queryFn)
    if (!response) return
    if (!response.node) return
    // [TODO] Validate response
    const node = response.node as NodeList.Node
    return node.id
  } catch (err) {
    warn(`Self: fetchNodeId: robustQuery failed: `, err)
  }
}

function validateJoinRequest(request: JoinRequest) {
  // [TODO] Implement this
  return true
}

export function computeNodeId(publicKey, cycleMarker) {
  const nodeId = crypto.hash({ publicKey, cycleMarker })
  info(
    `Node ID computation: publicKey: ${publicKey}, cycleMarker: ${cycleMarker}`
  )
  info(`Node ID is: ${nodeId}`)
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
