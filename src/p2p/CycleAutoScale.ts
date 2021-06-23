import deepmerge from 'deepmerge'
import { Logger } from 'log4js'
import { logFlags } from '../logger'
import { P2P } from '../types'
import { sleep, validateTypes } from '../utils'
import * as Comms from './Comms'
import { config, crypto, logger } from './Context'
import * as CycleChain from './CycleChain'
import * as CycleCreator from './CycleCreator'
import * as NodeList from './NodeList'
import * as Self from './Self'

/** STATE */

let p2pLogger: Logger

export let scalingRequested: boolean
export let requestedScalingType: string
export let approvedScalingType: string

export let scalingRequestsCollector: Map<
  P2P.CycleAutoScaleTypes.ScaleRequest['nodeId'],
  P2P.CycleAutoScaleTypes.SignedScaleRequest
>
export let desiredCount: number

reset()

const gossipScaleRoute: P2P.P2PTypes.GossipHandler<P2P.CycleAutoScaleTypes.SignedScaleRequest> = async (
  payload,
  sender,
  tracker
) => {
  if (logFlags.p2pNonFatal)
    info(`Got scale request: ${JSON.stringify(payload)}`)
  if (!payload) {
    warn('No payload provided for the `scaling` request.')
    return
  }
  const added = await addExtScalingRequest(payload)
  if (!added) return
  Comms.sendGossip('scaling', payload, tracker, sender, NodeList.byIdOrder, false)
}

const routes = {
  internal: {},
  gossip: {
    scaling: gossipScaleRoute,
  },
}

/** FUNCTIONS */

export function init() {
  p2pLogger = logger.getLogger('p2p')
  desiredCount = config.p2p.minNodes

  for (const [name, handler] of Object.entries(routes.gossip)) {
    Comms.registerGossipHandler(name, handler)
  }
}

export function reset() {
  console.log(
    'Resetting auto-scale module',
    `Cycle ${CycleCreator.currentQuarter}, Quarter: ${CycleCreator.currentQuarter}`
  )
  scalingRequested = false
  scalingRequestsCollector = new Map()
  requestedScalingType = null
  approvedScalingType = null
}

export function getDesiredCount(): number {
  return desiredCount
}

function createScaleRequest(scaleType) {
  const request: P2P.CycleAutoScaleTypes.ScaleRequest = {
    nodeId: Self.id,
    timestamp: Date.now(),
    counter: CycleCreator.currentCycle,
    scale: undefined,
  }
  switch (scaleType) {
    case P2P.CycleAutoScaleTypes.ScaleType.UP:
      request.scale = P2P.CycleAutoScaleTypes.ScaleType.UP
      break
    case P2P.CycleAutoScaleTypes.ScaleType.DOWN:
      request.scale = P2P.CycleAutoScaleTypes.ScaleType.DOWN
      break
    default:
      const err = new Error(`Invalid scaling request type: ${scaleType}`)
      error(err)
      throw err
  }
  const signedReq = crypto.sign(request)
  return signedReq
}

function _requestNetworkScaling(upOrDown) {
  if (!Self.isActive || scalingRequested) return
  const request = createScaleRequest(upOrDown)
  const signedRequest = crypto.sign(request)
  // await _waitUntilEndOfCycle()
  addExtScalingRequest(signedRequest)
  Comms.sendGossip('scaling', signedRequest, '', null, NodeList.byIdOrder, true)
  scalingRequested = true
}

export function requestNetworkUpsize() {
  if (getDesiredCount() >= config.p2p.maxNodes) {
    return
  }
  console.log('DBG', 'UPSIZE!')
  _requestNetworkScaling(P2P.CycleAutoScaleTypes.ScaleType.UP)
}

export function requestNetworkDownsize() {
  if (getDesiredCount() <= config.p2p.minNodes) {
    return
  }
  console.log('DBG', 'DOWNSIZE!')
  _requestNetworkScaling(P2P.CycleAutoScaleTypes.ScaleType.DOWN)
}

function addExtScalingRequest(scalingRequest) {
  const added = _addScalingRequest(scalingRequest)
  return added
}

function validateScalingRequest(scalingRequest: P2P.CycleAutoScaleTypes.SignedScaleRequest) {
  // Check existence of fields
  if (
    !scalingRequest.nodeId ||
    !scalingRequest.timestamp ||
    !scalingRequest.counter ||
    !scalingRequest.scale ||
    !scalingRequest.sign
  ) {
    warn(
      `Invalid scaling request, missing fields. Request: ${JSON.stringify(
        scalingRequest
      )}`
    )
    return false
  }
  // Check if cycle counter matches
  if (scalingRequest.counter !== CycleCreator.currentCycle) {
    warn(
      `Invalid scaling request, not for this cycle. Request: ${JSON.stringify(
        scalingRequest
      )}`
    )
    return false
  }
  // Check if we are trying to scale either up or down
  if (
    scalingRequest.scale !== P2P.CycleAutoScaleTypes.ScaleType.UP &&
    scalingRequest.scale !== P2P.CycleAutoScaleTypes.ScaleType.DOWN
  ) {
    warn(
      `Invalid scaling request, not a valid scaling type. Request: ${JSON.stringify(
        scalingRequest
      )}`
    )
    return false
  }
  // Try to get the node who supposedly signed this request
  let node
  try {
    node = NodeList.nodes.get(scalingRequest.nodeId)
  } catch (e) {
    warn(e)
    warn(
      `Invalid scaling request, not a known node. Request: ${JSON.stringify(
        scalingRequest
      )}`
    )
    return false
  }
  if (node == null) {
    warn(
      `Invalid scaling request, not a known node. Request: ${JSON.stringify(
        scalingRequest
      )}`
    )
    return false
  }
  // Return false if fails validation for signature
  if (!crypto.verify(scalingRequest, node.publicKey)) {
    warn(
      `Invalid scaling request, signature is not valid. Request: ${JSON.stringify(
        scalingRequest
      )}`
    )
    return false
  }
  return true
}

function _checkScaling() {
  // Keep a flag if we have changed our metadata.scaling at all
  let changed = false

  if (approvedScalingType === P2P.CycleAutoScaleTypes.ScaleType.UP) {
    warn('Already set to scale up this cycle. No need to scale up anymore.')
    return
  }

  // Check up first
  if (getScaleUpRequests().length >= config.p2p.scaleReqsNeeded) {
    approvedScalingType = P2P.CycleAutoScaleTypes.ScaleType.UP
    changed = true
  }

  // If we haven't approved an scale type, check if we should scale down
  if (!changed) {
    if (approvedScalingType === P2P.CycleAutoScaleTypes.ScaleType.DOWN) {
      warn(
        'Already set to scale down for this cycle. No need to scale down anymore.'
      )
      return
    }
    if (getScaleDownRequests().length >= config.p2p.scaleReqsNeeded) {
      approvedScalingType = P2P.CycleAutoScaleTypes.ScaleType.DOWN
      changed = true
    } else {
      // Return if we don't change anything
      return
    }
  }

  // At this point, we have changed our scaling type flag (approvedScalingType)
  let newDesired
  switch (approvedScalingType) {
    case P2P.CycleAutoScaleTypes.ScaleType.UP:
      newDesired = CycleChain.newest.desired + config.p2p.amountToGrow
      // If newDesired more than maxNodes, set newDesired to maxNodes
      if (newDesired > config.p2p.maxNodes) newDesired = config.p2p.maxNodes
      setDesireCount(newDesired)
      break
    case P2P.CycleAutoScaleTypes.ScaleType.DOWN:
      newDesired = CycleChain.newest.desired - config.p2p.amountToGrow
      // If newDesired less than minNodes, set newDesired to minNodes
      if (newDesired < config.p2p.minNodes) newDesired = config.p2p.minNodes
      setDesireCount(newDesired)
      break
    default:
      error(
        new Error(
          `Invalid scaling flag after changing flag. Flag: ${approvedScalingType}`
        )
      )
      return
  }
  console.log('newDesired', newDesired)
}

function setDesireCount(count: number) {
  if (count >= config.p2p.minNodes && count <= config.p2p.maxNodes) {
    console.log('Setting desired count to', count)
    desiredCount = count
  }
}

export function queueRequest(request) {}

export function sendRequests() {}

export function getTxs(): P2P.CycleAutoScaleTypes.Txs {
  // [IMPORTANT] Must return a copy to avoid mutation
  const requestsCopy = deepmerge({}, [
    ...Object.values(scalingRequestsCollector),
  ])
  return {
    autoscaling: requestsCopy,
  }
}

export function validateRecordTypes(rec: P2P.CycleAutoScaleTypes.Record): string {
  let err = validateTypes(rec, { desired: 'n' })
  if (err) return err
  return ''
}

export function updateRecord(txs: P2P.CycleAutoScaleTypes.Txs, record: P2P.CycleCreatorTypes.CycleRecord) {
  record.desired = getDesiredCount()
  reset()
}

export function parseRecord(record: P2P.CycleCreatorTypes.CycleRecord): P2P.CycleParserTypes.Change {
  // Since we don't touch the NodeList, return an empty Change
  return {
    added: [],
    removed: [],
    updated: [],
  }
}

function getScaleUpRequests() {
  let requests = []
  for (let [nodeId, request] of scalingRequestsCollector) {
    if (request.scale === P2P.CycleAutoScaleTypes.ScaleType.UP) requests.push(request)
  }
  return requests
}

function getScaleDownRequests() {
  let requests = []
  for (let [nodeId, request] of scalingRequestsCollector) {
    if (request.scale === P2P.CycleAutoScaleTypes.ScaleType.DOWN) requests.push(request)
  }
  return requests
}

function _addToScalingRequests(scalingRequest) {
  switch (scalingRequest.scale) {
    case P2P.CycleAutoScaleTypes.ScaleType.UP:
      if (requestedScalingType === P2P.CycleAutoScaleTypes.ScaleType.DOWN) {
        warn('Already scaling down this cycle. Cannot add scaling up request.')
        return false
      }

      // Check if we have exceeded the limit of scaling requests
      if (getScaleUpRequests().length >= config.p2p.maxScaleReqs) {
        warn('Max scale up requests already exceeded. Cannot add request.')
        return false
      }
      scalingRequestsCollector.set(scalingRequest.nodeId, scalingRequest)
      requestedScalingType = P2P.CycleAutoScaleTypes.ScaleType.UP
      // console.log(`Added scale request in cycle ${CycleCreator.currentCycle}, quarter ${CycleCreator.currentQuarter}`, requestedScalingType, scalingRequest)
      _checkScaling()
      return true
    case P2P.CycleAutoScaleTypes.ScaleType.DOWN:
      // Check if we are already voting scale up, don't add in that case
      if (requestedScalingType === P2P.CycleAutoScaleTypes.ScaleType.UP) {
        warn('Already scaling up this cycle. Cannot add scaling down request.')
        return false
      }
      // Check if we have exceeded the limit of scaling requests
      if (getScaleUpRequests().length >= config.p2p.maxScaleReqs) {
        warn('Max scale down requests already exceeded. Cannot add request.')
        return false
      }
      scalingRequestsCollector.set(scalingRequest.nodeId, scalingRequest)
      requestedScalingType = P2P.CycleAutoScaleTypes.ScaleType.DOWN
      _checkScaling()
      return true
    default:
      warn(
        `Invalid scaling type in _addToScalingRequests(). Request: ${JSON.stringify(
          scalingRequest
        )}`
      )
      return false
  }
}

function _addScalingRequest(scalingRequest: P2P.CycleAutoScaleTypes.SignedScaleRequest) {
  // Check existence of node
  if (!scalingRequest.nodeId) return

  // Check scaling seen for this node
  if (scalingRequestsCollector.has(scalingRequest.nodeId)) return

  const valid = validateScalingRequest(scalingRequest)
  if (!valid) return false

  // If we pass validation, add to current cycle
  const added = _addToScalingRequests(scalingRequest)
  return added
}

async function _waitUntilEndOfCycle() {
  const currentTime = Date.now()
  const nextQ1Start = CycleCreator.nextQ1Start
  if (logFlags.p2pNonFatal) info(`Current time is: ${currentTime}`)
  if (logFlags.p2pNonFatal) info(`Next cycle will start at: ${nextQ1Start}`)

  let timeToWait
  if (currentTime < nextQ1Start) {
    timeToWait = nextQ1Start - currentTime + config.p2p.queryDelay * 1000
  } else {
    timeToWait = 0
  }
  if (logFlags.p2pNonFatal)
    info(`Waiting for ${timeToWait} ms before next cycle marker creation...`)
  await sleep(timeToWait)
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
