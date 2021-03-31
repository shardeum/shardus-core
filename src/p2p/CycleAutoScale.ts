import { Logger } from 'log4js'
import { crypto, logger, config, network } from './Context'
import * as CycleCreator from './CycleCreator'
import * as CycleChain from './CycleChain'
import * as CycleParser from './CycleParser'
import * as Rotation from './Rotation'
import * as Self from './Self'
import * as NodeList from './NodeList'
import { LooseObject } from './Types'
import * as Types from './Types'
import { validateTypes, sleep } from '../utils'
import * as Comms from './Comms'
import * as Utils from './Utils'
import * as Network from '../network'
import deepmerge from 'deepmerge'
import { request } from 'express'
import {logFlags} from '../logger'

/** TYPES */
enum ScaleType {
  UP = 'up',
  DOWN = 'down',
}

export interface Record {
  desired: number
}
export interface ScaleRequest {
  nodeId: string
  timestamp: number
  counter: number
  scale: string
}

export interface Txs {
  autoscaling: SignedScaleRequest[]
}

export type SignedScaleRequest = ScaleRequest & Types.SignedObject

interface ScaleRequestMap {
  [nodeId: string]: SignedScaleRequest
}
/** STATE */

let p2pLogger: Logger

export let scalingRequested: boolean
export let requestedScalingType: string
export let approvedScalingType: string

export let scalingRequestsCollector: Map<
  ScaleRequest['nodeId'],
  SignedScaleRequest
>
export let desiredCount: number

reset()

const gossipScaleRoute: Types.GossipHandler<SignedScaleRequest> = async (
  payload,
  sender,
  tracker
) => {
  if(logFlags.p2pNonFatal) info(`Got scale request: ${JSON.stringify(payload)}`)
  if (!payload) {
    warn('No payload provided for the `scaling` request.')
    return
  }
  const added = await addExtScalingRequest(payload)
  if (!added) return
  Comms.sendGossip('scaling', payload, tracker)
}

const scalingTestRoute: Types.GossipHandler<SignedScaleRequest> = async (
  payload,
  sender,
  tracker
) => {
  if(logFlags.p2pNonFatal) info(`Got scale test gossip: ${JSON.stringify(payload)}`)
  if (!payload) {
    warn('No payload provided for the `scaling` request.')
    return
  }
  Comms.sendGossip('scalingTest', 'UP')
  requestNetworkUpsize()
}

const routes = {
  internal: {},
  gossip: {
    scaling: gossipScaleRoute
  },
}

/** FUNCTIONS */

export function init () {
  p2pLogger = logger.getLogger('p2p')
  desiredCount = config.p2p.minNodes

  for (const [name, handler] of Object.entries(routes.gossip)) {
    Comms.registerGossipHandler(name, handler)
  }
}

export function reset () {
  console.log('Resetting auto-scale module', `Cycle ${CycleCreator.currentQuarter}, Quarter: ${CycleCreator.currentQuarter}`)
  scalingRequested = false
  scalingRequestsCollector = new Map()
  requestedScalingType = null
  approvedScalingType = null
}

export function getDesiredCount (): number {
  console.log('getting desired count', desiredCount)
  return desiredCount
}

function createScaleRequest (scaleType) {
  const request: ScaleRequest = {
    nodeId: Self.id,
    timestamp: Date.now(),
    counter: CycleCreator.currentCycle,
    scale: undefined,
  }
  switch (scaleType) {
    case ScaleType.UP:
      request.scale = ScaleType.UP
      break
    case ScaleType.DOWN:
      request.scale = ScaleType.DOWN
      break
    default:
      const err = new Error(`Invalid scaling request type: ${scaleType}`)
      error(err)
      throw err
  }
  const signedReq = crypto.sign(request)
  return signedReq
}

async function _requestNetworkScaling (upOrDown) {
  if (!Self.isActive || scalingRequested) return
  const request = createScaleRequest(upOrDown)
  // await _waitUntilEndOfCycle()
  await addExtScalingRequest(request)
  await Comms.sendGossip('scaling', request)
  scalingRequested = true
}

export async function requestNetworkUpsize () {
  if (getDesiredCount() >= config.p2p.maxNodes) {
    return
  }
  console.log('DBG', 'UPSIZE!')
  await _requestNetworkScaling(ScaleType.UP)
}

export async function requestNetworkDownsize () {
  if (getDesiredCount() <= config.p2p.minNodes) {
    return
  }
  console.log('DBG', 'DOWNSIZE!')
  await _requestNetworkScaling(ScaleType.DOWN)
}

async function addExtScalingRequest (scalingRequest) {
  const added = await _addScalingRequest(scalingRequest)
  return added
}

function validateScalingRequest (scalingRequest: SignedScaleRequest) {
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
    scalingRequest.scale !== ScaleType.UP &&
    scalingRequest.scale !== ScaleType.DOWN
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

async function _checkScaling () {
  // Keep a flag if we have changed our metadata.scaling at all
  let changed = false

  if (approvedScalingType === ScaleType.UP) {
    warn('Already set to scale up this cycle. No need to scale up anymore.')
    return
  }

  // Check up first
  if (getScaleUpRequests().length >= config.p2p.scaleReqsNeeded) {
    approvedScalingType = ScaleType.UP
    changed = true
  }

  // If we haven't approved an scale type, check if we should scale down
  if (!changed) {
    if (approvedScalingType === ScaleType.DOWN) {
      warn(
        'Already set to scale down for this cycle. No need to scale down anymore.'
      )
      return
    }
    if (getScaleDownRequests().length >= config.p2p.scaleReqsNeeded) {
      approvedScalingType = ScaleType.DOWN
      changed = true
    } else {
      // Return if we don't change anything
      return
    }
  }

  // At this point, we have changed our scaling type flag (approvedScalingType)
  let newDesired
  switch (approvedScalingType) {
    case ScaleType.UP:
      newDesired = CycleChain.newest.desired + config.p2p.amountToScale
      // If newDesired more than maxNodes, set newDesired to maxNodes
      if (newDesired > config.p2p.maxNodes) newDesired = config.p2p.maxNodes
      setDesireCount(newDesired)
      break
    case ScaleType.DOWN:
      newDesired = CycleChain.newest.desired - config.p2p.amountToScale
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

export function getTxs(): Txs {
  // [IMPORTANT] Must return a copy to avoid mutation
  const requestsCopy = deepmerge({}, [...Object.values(scalingRequestsCollector)])
  return {
    autoscaling: requestsCopy,
  }
}

export function validateRecordTypes(rec: Record): string {
  let err = validateTypes(rec, { desired: 'n' })
  if (err) return err
  return ''
}

export function updateRecord(txs: Txs, record: CycleCreator.CycleRecord) {
  record.desired = getDesiredCount()
  reset()
}

export function parseRecord(
  record: CycleCreator.CycleRecord
): CycleParser.Change {
  // Since we don't touch the NodeList, return an empty Change
  return {
    added: [],
    removed: [],
    updated: [],
  }
}

function getScaleUpRequests () {
  let requests = []
  for (let [nodeId, request] of scalingRequestsCollector) {
    if (request.scale === ScaleType.UP) requests.push(request)
  }
  return requests
}

function getScaleDownRequests () {
  let requests = []
  for (let [nodeId, request] of scalingRequestsCollector) {
    if (request.scale === ScaleType.DOWN) requests.push(request)
  }
  return requests
}

async function _addToScalingRequests (scalingRequest) {
  switch (scalingRequest.scale) {
    case ScaleType.UP:
      if (requestedScalingType === ScaleType.DOWN) {
        warn('Already scaling down this cycle. Cannot add scaling up request.')
        return false
      }

      // Check if we have exceeded the limit of scaling requests
      if (getScaleUpRequests().length >= config.p2p.maxScaleReqs) {
        warn('Max scale up requests already exceeded. Cannot add request.')
        return false
      }
      scalingRequestsCollector.set(scalingRequest.nodeId, scalingRequest)
      requestedScalingType = ScaleType.UP
      // console.log(`Added scale request in cycle ${CycleCreator.currentCycle}, quarter ${CycleCreator.currentQuarter}`, requestedScalingType, scalingRequest)
      await _checkScaling()
      return true
    case ScaleType.DOWN:
      // Check if we are already voting scale up, don't add in that case
      if (requestedScalingType === ScaleType.UP) {
        warn('Already scaling up this cycle. Cannot add scaling down request.')
        return false
      }
      // Check if we have exceeded the limit of scaling requests
      if (getScaleUpRequests().length >= config.p2p.maxScaleReqs) {
        warn('Max scale down requests already exceeded. Cannot add request.')
        return false
      }
      scalingRequestsCollector.set(scalingRequest.nodeId, scalingRequest)
      requestedScalingType = ScaleType.DOWN
      await _checkScaling()
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

async function _addScalingRequest (scalingRequest: SignedScaleRequest) {
  // Check existence of node
  if (!scalingRequest.nodeId) return

  // Check scaling seen for this node
  if (scalingRequestsCollector.has(scalingRequest.nodeId)) return

  const valid = validateScalingRequest(scalingRequest)
  if (!valid) return false

  // If we pass validation, add to current cycle
  const added = await _addToScalingRequests(scalingRequest)
  return added
}

async function _waitUntilEndOfCycle () {
  const currentTime = Date.now()
  const nextQ1Start = CycleCreator.nextQ1Start
  if(logFlags.p2pNonFatal) info(`Current time is: ${currentTime}`)
  if(logFlags.p2pNonFatal) info(`Next cycle will start at: ${nextQ1Start}`)

  let timeToWait
  if (currentTime < nextQ1Start) {
    timeToWait = nextQ1Start - currentTime + config.p2p.queryDelay * 1000
  } else {
    timeToWait = 0
  }
  if(logFlags.p2pNonFatal) info(`Waiting for ${timeToWait} ms before next cycle marker creation...`)
  await sleep(timeToWait)
}

function info (...msg) {
  const entry = `Active: ${msg.join(' ')}`
  p2pLogger.info(entry)
}

function warn (...msg) {
  const entry = `Active: ${msg.join(' ')}`
  p2pLogger.warn(entry)
}

function error (...msg) {
  const entry = `Active: ${msg.join(' ')}`
  p2pLogger.error(entry)
}
