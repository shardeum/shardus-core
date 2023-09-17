import deepmerge from 'deepmerge'
import { Handler } from 'express'
import { version } from '../../package.json'
import * as http from '../http'
import { logFlags } from '../logger'
import { P2P } from '@shardus/types'
import * as utils from '../utils'
import { validateTypes, isEqualOrNewerVersion } from '../utils'
import * as Comms from './Comms'
import { config, crypto, logger, network, shardus } from './Context'
import * as CycleChain from './CycleChain'
import * as CycleCreator from './CycleCreator'
import * as NodeList from './NodeList'
import * as Self from './Self'
import { robustQuery } from './Utils'
import { isBogonIP, isInvalidIP, isIPv6 } from '../utils/functions/checkIP'
import { profilerInstance } from '../utils/profiler'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { isPortReachable } from '../utils/isPortReachable'
import { Logger } from 'log4js'
import { calculateToAcceptV2 } from './ModeSystemFuncs'

/** STATE */

let p2pLogger: Logger
let mainLogger: Logger

let requests: P2P.JoinTypes.JoinRequest[]
let seen: Set<P2P.P2PTypes.Node['publicKey']>

let lastLoggedCycle = 0

export let allowBogon = false

/** ROUTES */

const cycleMarkerRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'GET',
  name: 'cyclemarker',
  handler: (_req, res) => {
    const marker = CycleChain.newest ? CycleChain.newest.previous : '0'.repeat(64)
    res.json(marker)
  },
}

const joinRoute: P2P.P2PTypes.Route<Handler> = {
  method: 'POST',
  name: 'join',
  handler: async (req, res) => {
    const joinRequest = req.body
    if (CycleCreator.currentQuarter < 1) {
      // if currentQuarter <= 0 then we are not ready
      res.end()
      return
    }

    if (
      NodeList.activeByIdOrder.length === 1 &&
      Self.isFirst &&
      isBogonIP(joinRequest.nodeInfo.externalIp) &&
      config.p2p.forceBogonFilteringOn === false
    ) {
      allowBogon = true
    }
    nestedCountersInstance.countEvent('p2p', `join-allow-bogon-firstnode:${allowBogon}`)

    const externalIp = joinRequest.nodeInfo.externalIp
    const externalPort = joinRequest.nodeInfo.externalPort
    const internalIp = joinRequest.nodeInfo.internalIp
    const internalPort = joinRequest.nodeInfo.internalPort

    const externalPortReachable = await isPortReachable({ host: externalIp, port: externalPort })
    const internalPortReachable = await isPortReachable({ host: internalIp, port: internalPort })

    if (!externalPortReachable || !internalPortReachable) {
      return res.json({
        success: false,
        fatal: true,
        reason: `IP or Port is not reachable. ext:${externalIp}:${externalPort} int:${internalIp}:${internalPort}}`,
      })
    }

    //  Validate of joinReq is done in addJoinRequest
    const validJoinRequest = addJoinRequest(joinRequest)

    if (validJoinRequest.success) {
      Comms.sendGossip('gossip-join', joinRequest, '', null, NodeList.byIdOrder, true)
      nestedCountersInstance.countEvent('p2p', 'initiate gossip-join')
    }
    return res.json(validJoinRequest)
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
    if (addJoinRequest(payload).success)
      Comms.sendGossip('gossip-join', payload, tracker, sender, NodeList.byIdOrder, false)
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

export function init(): void {
  p2pLogger = logger.getLogger('p2p')
  mainLogger = logger.getLogger('main')
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

export function reset(): void {
  requests = []
  seen = new Set()
}

export function getNodeRequestingJoin(): P2P.P2PTypes.P2PNode[] {
  const nodes: P2P.P2PTypes.P2PNode[] = []
  for (const request of requests) {
    if (request && request.nodeInfo) {
      nodes.push(request.nodeInfo)
    }
  }
  return nodes
}

/** calculateToAccept - calculates the number of nodes to accept into the network */
function calculateToAccept(): number {
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
      : Math.floor(
          config.p2p.maxSyncingPerCycle * CycleCreator.scaleFactor * CycleCreator.scaleFactorSyncBoost
        )

  //The first batch of nodes to join the network after the seed node server can join at a higher rate if firstCycleJoin is set.
  //This first batch will sync the full data range from the seed node, which should be very little data.
  //This gets the network rolling faster, but also allows us to use a slightly higher base join rate because
  //we are not worrying on how it performs with small networks. < 25 nodes.
  if (active === 0 && config.p2p.firstCycleJoin) {
    maxJoin = Math.max(config.p2p.firstCycleJoin, maxJoin)
    syncMax += config.p2p.firstCycleJoin
  }
  //For a few cycles we can boost the max sync to account for firstCycleJoin nodes.
  if (CycleChain.newest.counter < 10 && config.p2p.firstCycleJoin) {
    syncMax += config.p2p.firstCycleJoin
  }

  if (active > 0) {
    const syncMaxLimit = 150 //todo make config
    if (syncMax > syncMaxLimit) {
      /* prettier-ignore */ nestedCountersInstance.countEvent('networkSize', `limit syncmax ${syncMax}=>${syncMaxLimit} cyc:${CycleCreator.currentCycle}`)
      syncMax = syncMaxLimit
    }
  }

  const canSync = syncMax - syncing

  let needed = 0

  // Always set needed to (desired - (active + syncing)) if its positive
  //if (desired > active + syncing) {
  // updating to make sure this math gets applied all the time
  if (desired > 0) {
    needed = desired - (active + syncing)
  }

  // If rotation is on, add expired to needed
  if (config.p2p.maxRotatedPerCycle > 0) {
    //only can accept as many as could actually rotate out in one cycle
    const maxToLeave = Math.min(expired, config.p2p.maxRotatedPerCycle)
    needed += maxToLeave
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

  const cycle = CycleChain.newest.counter
  if (cycle > lastLoggedCycle) {
    lastLoggedCycle = cycle
    info(
      'scale dump:' +
        JSON.stringify({
          cycle,
          scaleFactor: CycleCreator.scaleFactor,
          needed,
          desired,
          active,
          syncing,
          canSync,
          syncMax,
          maxJoin,
          expired,
          scaleFactorSyncBoost: CycleCreator.scaleFactorSyncBoost,
        })
    )
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
  const join = txs.join.filter(() => validateJoinRequest())
  return { join }
}

export function updateRecord(txs: P2P.JoinTypes.Txs, record: P2P.CycleCreatorTypes.CycleRecord): void {
  const joinedConsensors = txs.join.map((joinRequest) => {
    const { nodeInfo, cycleMarker: cycleJoined } = joinRequest
    const id = computeNodeId(nodeInfo.publicKey, cycleJoined)
    const counterRefreshed = record.counter
    return { ...nodeInfo, cycleJoined, counterRefreshed, id }
  })
  console.log("new desired count: ", record.desired)
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
export function sendRequests(): void {
  return
}

/** Not used by Join */
export function queueRequest(): void {
  return
}

/** Module Functions */

export async function createJoinRequest(
  cycleMarker: string
): Promise<P2P.JoinTypes.JoinRequest & P2P.P2PTypes.SignedObject> {
  // Build and return a join request
  const nodeInfo = Self.getThisNodeInfo()
  // TO-DO: Think about if the selection number still needs to be signed
  const proofOfWork = {
    compute: await crypto.getComputeProofOfWork(cycleMarker, config.p2p.difficulty),
  }
  const joinReq = {
    nodeInfo,
    cycleMarker,
    proofOfWork: JSON.stringify(proofOfWork),
    version,
    selectionNum: undefined,
  }
  if (typeof shardus.app.getJoinData === 'function') {
    try {
      const appJoinData = shardus.app.getJoinData()
      if (appJoinData) {
        joinReq['appJoinData'] = appJoinData
      }
    } catch (e) {
      warn(`shardus.app.getJoinData failed due to ${e}`)
      return
    }
  }
  const signedJoinReq = crypto.sign(joinReq)
  if (logFlags.p2pNonFatal) info(`Join request created... Join request: ${JSON.stringify(signedJoinReq)}`)
  return signedJoinReq
}

export interface JoinRequestResponse {
  success: boolean
  reason: string
  fatal: boolean
}
export function addJoinRequest(joinRequest: P2P.JoinTypes.JoinRequest): JoinRequestResponse {
  if (Self.p2pIgnoreJoinRequests === true) {
    if (logFlags.p2pNonFatal) info(`Join request ignored. p2pIgnoreJoinRequests === true`)
    return {
      success: false,
      fatal: false,
      reason: `Join request ignored. p2pIgnoreJoinRequests === true`,
    }
  }

  //  Validate joinReq
  let err = utils.validateTypes(joinRequest, {
    cycleMarker: 's',
    nodeInfo: 'o',
    sign: 'o',
    version: 's',
  })
  if (err) {
    warn('join bad joinRequest ' + err)
    return {
      success: false,
      reason: `Bad join request object structure`,
      fatal: true,
    }
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
    return {
      success: false,
      reason: 'Bad nodeInfo object structure within join request',
      fatal: true,
    }
  }
  err = utils.validateTypes(joinRequest.sign, { owner: 's', sig: 's' })
  if (err) {
    warn('join bad joinRequest.sign ' + err)
    return {
      success: false,
      reason: 'Bad signature object structure within join request',
      fatal: true,
    }
  }
  if (config.p2p.checkVersion && !isEqualOrNewerVersion(version, joinRequest.version)) {
    /* prettier-ignore */ warn( `version number is old. Our node version is ${version}. Join request node version is ${joinRequest.version}` )
    nestedCountersInstance.countEvent('p2p', `join-reject-version ${joinRequest.version}`)
    return {
      success: false,
      reason: `Old shardus core version, please statisfy at least ${version}`,
      fatal: true,
    }
  }

  //If the node that signed the request is not the same as the node that is joining
  if (joinRequest.sign.owner != joinRequest.nodeInfo.publicKey) {
    /* prettier-ignore */ warn(`join-reject owner != publicKey ${{sign:joinRequest.sign.owner, info:joinRequest.nodeInfo.publicKey}}`)
    nestedCountersInstance.countEvent('p2p', `join-reject owner != publicKey`)
    return {
      success: false,
      reason: `Bad signature, sign owner and node attempted joining mismatched`,
      fatal: true,
    }
  }

  if (isIPv6(joinRequest.nodeInfo.externalIp)) {
    warn('Got join request from IPv6')
    nestedCountersInstance.countEvent('p2p', `join-reject-ipv6`)
    return {
      success: false,
      reason: `Bad ip version, IPv6 are not accepted`,
      fatal: true,
    }
  }

  try {
    //test or bogon IPs and reject the join request if they appear
    if (allowBogon === false) {
      if (isBogonIP(joinRequest.nodeInfo.externalIp)) {
        warn('Got join request from Bogon IP')
        nestedCountersInstance.countEvent('p2p', `join-reject-bogon`)
        return {
          success: false,
          reason: `Bad ip, bogon ip not accepted`,
          fatal: true,
        }
      }
    } else {
      //even if not checking bogon still reject other invalid IPs that would be unusable
      if (isInvalidIP(joinRequest.nodeInfo.externalIp)) {
        warn('Got join request from invalid reserved IP')
        nestedCountersInstance.countEvent('p2p', `join-reject-reserved`)
        return {
          success: false,
          reason: `Bad ip, reserved ip not accepted`,
          fatal: true,
        }
      }
    }
  } catch (er) {
    nestedCountersInstance.countEvent('p2p', `join-reject-bogon-ex:${er}`)
  }

  let selectionKey: unknown

  if (typeof shardus.app.validateJoinRequest === 'function') {
    try {
      const validationResponse = shardus.app.validateJoinRequest(joinRequest)
      if (validationResponse.success !== true) {
        error(`Validation of join request data is failed due to ${validationResponse.reason || 'unknown reason'}`)
        nestedCountersInstance.countEvent('p2p', `join-reject-dapp`)
        return {
          success: validationResponse.success,
          reason: validationResponse.reason,
          fatal: validationResponse.fatal,
        }
      }
      if (typeof validationResponse.data === 'string') {
        selectionKey = validationResponse.data
      }
    } catch (e) {
      warn(`shardus.app.validateJoinRequest failed due to ${e}`)
      nestedCountersInstance.countEvent('p2p', `join-reject-ex ${e}`)
      return {
        success: false,
        reason: `Could not validate join request due to Error`,
        fatal: true,
      }
    }
  }
  const node = joinRequest.nodeInfo
  if (logFlags.p2pNonFatal) info(`Got join request for ${node.externalIp}:${node.externalPort}`)

  // Check if this node has already been seen this cycle
  if (seen.has(node.publicKey)) {
    if (logFlags.p2pNonFatal) nestedCountersInstance.countEvent('p2p', `join-skip-seen-pubkey`)
    if (logFlags.p2pNonFatal) info('Node has already been seen this cycle. Unable to add join request.')
    return {
      success: false,
      reason: 'Node has already been seen this cycle. Unable to add join request.',
      fatal: false,
    }
  }

  // Mark node as seen for this cycle
  seen.add(node.publicKey)

  // Return if we already know about this node
  if (NodeList.byPubKey.has(joinRequest.nodeInfo.publicKey)) {
    const message = 'Cannot add join request for this node, already a known node (by public key).'
    if (logFlags.p2pNonFatal) warn(message)
    return {
      success: false,
      reason: message,
      fatal: false,
    }
  }
  const ipPort = NodeList.ipPort(node.internalIp, node.internalPort)
  if (NodeList.byIpPort.has(ipPort)) {
    const message = 'Cannot add join request for this node, already a known node (by IP address).'
    /* prettier-ignore */ if (logFlags.p2pNonFatal) info(message, JSON.stringify(NodeList.byIpPort.get(ipPort)))
    if (logFlags.p2pNonFatal) nestedCountersInstance.countEvent('p2p', `join-skip-already-known`)
    return {
      success: false,
      reason: message,
      fatal: true,
    }
  }

  //TODO - figure out why joinRequest is send with previous cycle marker instead of current cycle marker
  /*
   CONTEXT: when node create join request the cycleMarker is (current - 1).
   The reason join request didn't use current cycleMarker is most likely the the current cycle is potential not agreed upon yet.
   but the joinRequestTimestamp is Date.now
   so checking if the timestamp is within its cycleMarker is gurantee to fail
   let request cycle marker be X, then X+1 is current cycle, then we check if the timestamp is in the current cycleMarker
  */
  // const cycleThisJoinRequestBelong = CycleChain.cyclesByMarker[joinRequest.cycleMarker]
  // const cycleStartedAt = cycleThisJoinRequestBelong.start
  // const cycleWillEndsAt = cycleStartedAt + cycleDuration
  const joinRequestTimestamp = joinRequest.nodeInfo.joinRequestTimestamp
  const cycleDuration = CycleChain.newest.duration
  const cycleStarts = CycleChain.newest.start
  const requestValidUpperBound = cycleStarts + cycleDuration
  const requestValidLowerBound = cycleStarts - cycleDuration

  if(joinRequestTimestamp < requestValidLowerBound){
    if (logFlags.p2pNonFatal) nestedCountersInstance.countEvent('p2p', `join-skip-timestamp-not-meet-lowerbound`)
    if (logFlags.p2pNonFatal) warn('Cannot add join request for this node, timestamp is earlier than allowed cycle range')
    return {
      success: false,
      reason: 'Cannot add join request, timestamp is earlier than allowed cycle range',
      fatal: false,
    }
  }

  if(joinRequestTimestamp > requestValidUpperBound){
    if (logFlags.p2pNonFatal) nestedCountersInstance.countEvent('p2p', `join-skip-timestamp-beyond-upperbound`)
    if (logFlags.p2pNonFatal) warn('Cannot add join request for this node, its timestamp exceeds allowed cycle range')
    return {
      success: false,
      reason: 'Cannot add join request, timestamp exceeds allowed cycle range',
      fatal: false,
    }
  }

  // Compute how many join request to accept
  let toAccept = calculateToAccept()
  nestedCountersInstance.countEvent('p2p', `results of calculateToAccept: toAccept: ${toAccept}`)
  console.log("results of calculateToAccept: ", toAccept)
  const { add, remove } = calculateToAcceptV2(CycleChain.newest)
  nestedCountersInstance.countEvent('p2p', `results of calculateToAcceptV2: add: ${add}, remove: ${remove}`)
  console.log("results of calculateToAcceptV2: ", add, remove)
  toAccept = add

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
  const obj = {
    cycleNumber: CycleChain.newest.counter,
    selectionKey: selectionKey ? selectionKey : node.publicKey,
  }
  const selectionNum = crypto.hash(obj)
  if (last && requests.length >= toAccept && !crypto.isGreaterHash(selectionNum, last.selectionNum)) {
    if (logFlags.p2pNonFatal) info('Join request not better than lowest, not added.')
    if (logFlags.p2pNonFatal) nestedCountersInstance.countEvent('p2p', `join-skip-hash-not-good-enough`)
    return {
      success: false,
      reason: 'Join request not better than lowest, not added',
      fatal: false,
    }
  }

  // TODO: call into application
  // ----- application should decide the ranking order of the join requests
  // ----- if hook doesn't exist, then we go with default order based on selection number
  // ----- hook signature = (currentList, newJoinRequest, numDesired) returns [newOrder, added]
  // ----- should create preconfigured hooks for adding POW, allowing join based on netadmin sig, etc.

  // Check the signature as late as possible since it is expensive
  if (!crypto.verify(joinRequest, joinRequest.nodeInfo.publicKey)) {
    warn('join bad sign ' + JSON.stringify(joinRequest))
    nestedCountersInstance.countEvent('p2p', `join-reject-bad-sign`)
    return {
      success: false,
      reason: 'Bad signature',
      fatal: true,
    }
  }
  // Insert sorted into best list if we made it this far
  utils.insertSorted(requests, { ...joinRequest, selectionNum }, (a, b) =>
    a.selectionNum < b.selectionNum ? 1 : a.selectionNum > b.selectionNum ? -1 : 0
  )
  if (logFlags.p2pNonFatal)
    info(`Added join request for ${joinRequest.nodeInfo.externalIp}:${joinRequest.nodeInfo.externalPort}`)

  // If we have > maxJoinedPerCycle requests, trim them down
  if (logFlags.p2pNonFatal) info(`Requests: ${requests.length}, toAccept: ${toAccept}`)
  if (requests.length > toAccept) {
    const over = requests.length - toAccept
    requests.splice(-over)
    //    info(`Over maxJoinedPerCycle; removed ${over} requests from join requests`)
  }

  return {
    success: true,
    reason: 'Join request accepted',
    fatal: false,
  }
}

export async function firstJoin(): Promise<string> {
  // Create join request from 000... cycle marker
  const zeroMarker = '0'.repeat(64)
  const request = await createJoinRequest(zeroMarker)
  // Add own join request
  utils.insertSorted(requests, request)
  // Return node ID
  return computeNodeId(crypto.keypair.publicKey, zeroMarker)
}

export async function submitJoin(
  nodes: P2P.P2PTypes.Node[],
  joinRequest: P2P.JoinTypes.JoinRequest & P2P.P2PTypes.SignedObject
): Promise<void> {
  // Send the join request to a handful of the active node all at once:w
  const selectedNodes = utils.getRandom(nodes, Math.min(nodes.length, 5))
  const promises = []
  if (logFlags.p2pNonFatal) info(`Sending join request to ${selectedNodes.map((n) => `${n.ip}:${n.port}`)}`)

  // Check if network allows bogon IPs, set our own flag accordingly
  if (config.p2p.dynamicBogonFiltering && config.p2p.forceBogonFilteringOn === false) {
    if (nodes.some((node) => isBogonIP(node.ip))) {
      allowBogon = true
    }
  }
  nestedCountersInstance.countEvent('p2p', `join-allow-bogon-submit:${allowBogon}`)

  //Check for bad IPs before a join request is sent out
  if (config.p2p.rejectBogonOutboundJoin || config.p2p.forceBogonFilteringOn) {
    if (allowBogon === false) {
      if (isBogonIP(joinRequest.nodeInfo.externalIp)) {
        throw new Error(`Fatal: Node cannot join with bogon external IP: ${joinRequest.nodeInfo.externalIp}`)
      }
    } else {
      //even if not checking bogon still reject other invalid IPs that would be unusable
      if (isInvalidIP(joinRequest.nodeInfo.externalIp)) {
        throw new Error(
          `Fatal: Node cannot join with invalid external IP: ${joinRequest.nodeInfo.externalIp}`
        )
      }
    }
  }

  for (const node of selectedNodes) {
    try {
      promises.push(http.post(`${node.ip}:${node.port}/join`, joinRequest))
    } catch (err) {
      throw new Error(
        `Fatal: submitJoin: Error posting join request to ${node.ip}:${node.port}: Error: ${err}`
      )
    }
  }

  return Promise.all(promises).then((responses: JoinRequestResponse[]) => {
    for (const res of responses) {
      mainLogger.info(`Join Request Response: ${JSON.stringify(res)}`)
      if (res.fatal) {
        throw new Error(`Fatal: Join request Reason: ${res.reason}`)
      }
    }
  })
}

export async function fetchJoined(activeNodes: P2P.P2PTypes.Node[]): Promise<string> {
  const queryFn = async (node: P2P.P2PTypes.Node): Promise<{ node: P2P.NodeListTypes.Node }> => {
    const publicKey = crypto.keypair.publicKey
    const res: { node: P2P.NodeListTypes.Node } = await http.get(`${node.ip}:${node.port}/joined/${publicKey}`)
    return res
  }
  try {
    const { topResult: response } = await robustQuery<P2P.P2PTypes.Node, { node: P2P.NodeListTypes.Node }>(activeNodes, queryFn)
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
    return response.node.id
  } catch (err) {
    warn('Self: fetchNodeId: robustQuery failed: ', err)
  }
}

function validateJoinRequest(): boolean {
  // [TODO] Implement this
  return true
}

export function computeNodeId(publicKey: string, cycleMarker: string): string {
  const obj = { publicKey, cycleMarker }
  const nodeId = crypto.hash(obj)
  if (logFlags.p2pNonFatal) {
    info(`Node ID computation: publicKey: ${publicKey}, cycleMarker: ${cycleMarker}`)
    info(`Node ID is: ${nodeId}`)
  }
  return nodeId
}

function info(...msg: string[]): void {
  const entry = `Join: ${msg.join(' ')}`
  p2pLogger.info(entry)
}

function warn(...msg: string[]): void {
  const entry = `Join: ${msg.join(' ')}`
  p2pLogger.warn(entry)
}

function error(...msg: string[]): void {
  const entry = `Join: ${msg.join(' ')}`
  p2pLogger.error(entry)
}
