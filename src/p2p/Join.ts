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

/** TYPES */

export interface JoinedArchiver {
  curvePk: string
  ip: string
  port: number
  publicKey: string
}

export interface JoinedConsensor extends Types.P2PNode {
  cycleJoined: string
  id: string
}

export interface JoinRequest {
  nodeInfo: Types.P2PNode
  cycleMarker: string
  proofOfWork: string
  selectionNum: string
}

export interface Txs {
  join: JoinRequest[]
}

export interface Record {
  joinedConsensors: JoinedConsensor[]
}

/** STATE */

let p2pLogger

let toAccept: number
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
    // [TODO] Validate joinReq

    // Dont accept join requests if you're not active
    if (Self.isActive === false) {
      res.end()
      return
    }

    // If not in quarter 1 of cycle, reply with resubmit time
    if (CycleCreator.currentQuarter !== 1) {
      const resubmit = CycleCreator.nextQ1Start
      res.json(resubmit)
      return
    }

    const joinRequest = req.body
    if (addJoinRequest(joinRequest)) {
      Comms.sendGossip('gossip-join', joinRequest)
    }
    res.end()
  },
}

const joinedRoute: Types.Route<Handler> = {
  method: 'GET',
  name: 'joined/:publicKey',
  handler: (req, res) => {
    // Respond with id if node's join request was accepted, otherwise undefined
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
  toAccept = config.p2p.maxNodesPerCycle
  requests = []
  seen = new Set()
}

export function getTxs(): Txs {
  return {
    join: requests,
  }
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
    const nodeInfo = node
    const cycleJoined = joinRequest.cycleMarker
    const id = computeNodeId(nodeInfo.publicKey, cycleJoined)
    return { ...nodeInfo, cycleJoined, id }
  })

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

export function addJoinRequest(joinRequest) {
  const node = joinRequest.nodeInfo

  // Check if this node has already been seen this cycle
  if (seen.has(node.publicKey)) {
    warn('Node has already been seen this cycle. Unable to add join request.')
    return false
  }

  // Mark node as seen for this cycle
  seen.add(node.publicKey)

  // Return if we already know about this node
  const ipPort = NodeList.ipPort(node.internalIp, node.internalPort)
  if (NodeList.byIpPort.has(ipPort)) {
    warn('Cannot add join request for this node, already a known node.')
    return false
  }

  // Check if we are better than the lowest selectionNum
  const last = requests.length - 1
  if (
    !crypto.isGreaterHash(joinRequest.selectionNum, requests[last].selectionNum)
  ) {
    warn('Join request not better than lowest, not added.')
    return false
  }

  // TODO: call into application
  // ----- application should decide the ranking order of the join requests
  // ----- if hook doesn't exist, then we go with default order based on selection number
  // ----- hook signature = (currentList, newJoinRequest, numDesired) returns [newOrder, added]
  // ----- should create preconfigured hooks for adding POW, allowing join based on netadmin sig, etc.

  // Insert sorted into best list if we made it this far
  utils.insertSorted(requests, joinRequest, (a, b) =>
    a.selectionNum < b.selectionNum
      ? 1
      : a.selectionNum > b.selectionNum
      ? -1
      : 0
  )

  // If we have > maxNodesPerCycle requests, trim them down
  if (requests.length > config.p2p.maxNodesPerCycle) {
    const over = requests.length - config.p2p.maxNodesPerCycle
    requests.splice(-over)
    info(`Over maxNodesPerCycle; removed ${over} requests from join requests`)
  }

  return true
}

export async function firstJoin() {
  // Create join request from 000... cycle marker
  const zeroMarker = '0'.repeat(64)
  const request = await createJoinRequest(zeroMarker)
  // Add own join request
  addJoinRequest(request)
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

  const [marker] = await robustQuery(
    nodes,
    queryFn,
    _isSameCycleMarkerInfo.bind(this)
  )
  return marker
}

export async function submitJoin(nodes, joinRequest) {
  for (const node of nodes) {
    info(`Sending join request to ${node.ip}:${node.port}`)
    const resubmit = await http.post(
      `${node.ip}:${node.port}/join`,
      joinRequest
    )
    if (resubmit) return resubmit
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
