import * as utils from '../utils'
import { logger, crypto, config, network } from './Context'
import * as NodeList from './NodeList'
import * as Self from './Self'
import * as Types from './Types'
import * as CycleChain from './CycleChain'
import { Handler } from 'express'
import { robustQuery } from './Utils'
import * as http from '../http'
import { isDeepStrictEqual } from 'util'
import { CycleRecord } from './CycleCreator'

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

let mainLogger

let toAccept
let bestJoinRequests: JoinRequest[]
let updateSeen: Set<Types.Node['publicKey']>

/** ROUTES */

const cycleMarkerRoute: Types.Route<Handler> = {
  method: 'GET',
  name: 'cyclemarker',
  handler: (_req, res) => {
    const marker = CycleChain.newest ? CycleChain.newest.previous : '0'.repeat(64)
    res.json(marker)
  }
}

const joinRoute: Types.Route<Handler> = {
  method: 'POST',
  name: 'join',
  handler: (req, res) => {
    // Dont accept join requests if you're not active
    if (Self.isActive === false) res.end()
    // [TODO] Tell how long to wait before trying again

    const joinRequest = req.body
    addJoinRequest(joinRequest)
    res.end()
  }
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
  }
}

const gossipJoinedRoute: Types.GossipHandler<JoinRequest> = payload => {
  // [TODO] Need to gossip received joinRequests to network
}

const routes = {
  external: [cycleMarkerRoute, joinRoute, joinedRoute],
  gossip: {
    'gossip-joined': gossipJoinedRoute
  }
}

/** FUNCTIONS */

export function init() {
  mainLogger = logger.getLogger('main')

  // Init state
  reset()

  // Register routes
  for (const route of routes.external) network._registerExternal(route.method, route.name, route.handler)
}

export function reset() {
  toAccept = config.p2p.maxNodesPerCycle
  bestJoinRequests = []
  updateSeen = new Set()
}

export function getCycleTxs(): Txs {
  return {
    join: bestJoinRequests,
  }
}

export function updateCycleRecord(txs: Txs, record: CycleRecord, _prev: CycleRecord) {
  const joinedConsensors = txs.join.map(joinRequest => {
    const nodeInfo = joinRequest.nodeInfo
    const cycleJoined = joinRequest.cycleMarker
    const id = computeNodeId(nodeInfo.publicKey, cycleJoined)
    return { ...nodeInfo, cycleJoined, id }
  })

  record.joinedConsensors = joinedConsensors
}

export function sortCycleRecord(record: CycleRecord) {
  record.joinedConsensors.sort()
}

export async function createJoinRequest(
  cycleMarker
): Promise<JoinRequest & Types.SignedObject> {
  // Build and return a join request
  const nodeInfo = Self._getThisNodeInfo()
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
  mainLogger.debug(
    `Join request created... Join request: ${JSON.stringify(signedJoinReq)}`
  )
  return signedJoinReq
}

export function addJoinRequest(joinRequest) {
  const { nodeInfo } = joinRequest

  // Check if this node has already been seen this cycle
  if (wasSeenThisCycle(nodeInfo.publicKey)) {
    mainLogger.debug(
      'Node has already been seen this cycle. Unable to add join request.'
    )
    return false
  }

  // Mark node as seen for this cycle
  markNodeAsSeen(nodeInfo.publicKey)

  // Return if we already know about this node
  if (isKnownNode(nodeInfo)) {
    mainLogger.info(
      'Cannot add join request for this node, already a known node.'
    )
    return false
  }

  // Get the list of best requests
  const bestRequests = getBestJoinRequests()

  // If length of array is bigger, do this precheck
  const competing = toAccept > 0 && bestRequests.length >= toAccept
  if (competing) {
    const lastIndex = bestRequests.length - 1
    const lowest = bestRequests[lastIndex]

    // TODO: call into application
    // ----- application should decide the ranking order of the join requests
    // ----- if hook doesn't exist, then we go with default order based on selection number
    // ----- hook signature = (currentList, newJoinRequest, numDesired) returns [newOrder, added]
    // ----- should create preconfigured hooks for adding POW, allowing join based on netadmin sig, etc.

    // Check if we are better than the lowest best
    if (!isBetterThanLowestBest(joinRequest, lowest)) {
      mainLogger.debug(
        `${joinRequest.selectionNum} is not better than ${lowest.selectionNum}. Node ${joinRequest.nodeInfo.publicKey} not added to this cycle.`
      )
      return false
    }
  }

  // Insert sorted into best list if we made it this far
  utils.insertSorted(bestRequests, joinRequest, (a, b) =>
    a.selectionNum < b.selectionNum
      ? 1
      : a.selectionNum > b.selectionNum
      ? -1
      : 0
  )

  // If we were competing for a spot, we have to get rid of the weakest link
  if (competing) {
    const removedRequest = bestRequests.pop()
    const removedNode = removedRequest.nodeInfo
    mainLogger.debug(
      `Removing the following node from this cycle's join requests: ${JSON.stringify(
        removedNode
      )}`
    )
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

export async function fetchCycleMarker (nodes) {
  const queryFn = async (node) => {
    const marker = await http.get(`${node.ip}:${node.port}/cyclemarker`)
    return marker
  }

  function _isSameCycleMarkerInfo (info1, info2) {
    const cm1 = utils.deepCopy(info1)
    const cm2 = utils.deepCopy(info2)
    delete cm1.currentTime
    delete cm2.currentTime
    const equivalent = isDeepStrictEqual(cm1, cm2)
    mainLogger.debug(`Equivalence of the two compared cycle marker infos: ${equivalent}`)
    return equivalent
  }

  const [marker] = await robustQuery(nodes, queryFn, _isSameCycleMarkerInfo.bind(this))
  return marker
}

export async function submitJoin (nodes, joinRequest) {
  for (const node of nodes) {
    mainLogger.debug(`Sending join request to ${node.ip}:${node.port}`)
    await http.post(`${node.ip}:${node.port}/join`, joinRequest)
  }
}

export async function fetchJoined (activeNodes) {
  const queryFn = async (node) => {
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
    mainLogger.error(`Self: fetchNodeId: robustQuery failed: `, err)
  }
}

function getBestJoinRequests() {
  return bestJoinRequests
}

function wasSeenThisCycle(key) {
  return updateSeen.has(key)
}

function markNodeAsSeen(key) {
  updateSeen.add(key)
}

function isKnownNode(node) {
  const ipPort = NodeList.ipPort(node.internalIp, node.internalPort)
  return NodeList.byIpPort.has(ipPort)
}

function isBetterThanLowestBest(request, lowest) {
  return crypto.isGreaterHash(request.selectionNum, lowest.selectionNum)
}

export function computeNodeId(publicKey, cycleMarker) {
  const nodeId = crypto.hash({ publicKey, cycleMarker })
  mainLogger.debug(
    `Node ID computation: publicKey: ${publicKey}, cycleMarker: ${cycleMarker}`
  )
  mainLogger.debug(`Node ID is: ${nodeId}`)
  return nodeId
}
