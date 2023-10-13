import deepmerge from 'deepmerge'
import { Logger } from 'log4js'
import { logFlags } from '../logger'
import { P2P } from '@shardus/types'
import { sleep, validateTypes, fastIsPicked } from '../utils'
import * as Comms from './Comms'
import { config, crypto, logger, stateManager } from './Context'
import * as CycleChain from './CycleChain'
import * as CycleCreator from './CycleCreator'
import * as NodeList from './NodeList'
import * as Self from './Self'
import { profilerInstance } from '../utils/profiler'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { enterRecovery, enterSafety } from './Modes'
import { getOurNodeIndex } from './Utils'

/** STATE */

let p2pLogger: Logger

export let scalingRequested: boolean
export let requestedScalingType: string
export let approvedScalingType: string
export let lastScalingType: string

export let scalingRequestsCollector: Map<
  P2P.CycleAutoScaleTypes.ScaleRequest['nodeId'],
  P2P.CycleAutoScaleTypes.SignedScaleRequest
>
export let desiredCount: number
export let targetCount: number

reset()

const gossipScaleRoute: P2P.P2PTypes.GossipHandler<P2P.CycleAutoScaleTypes.SignedScaleRequest> = async (
  payload,
  sender,
  tracker
) => {
  profilerInstance.scopedProfileSectionStart('gossip-scaling')
  try {
    if (logFlags.p2pNonFatal) info(`Got scale request: ${JSON.stringify(payload)}`)
    if (!payload) {
      warn('No payload provided for the `scaling` request.')
      return
    }

    const id = payload.nodeId
    if (_canThisNodeSendScaleRequests(id) !== true) {
      return
    }

    const added = addExtScalingRequest(payload)
    if (!added) return
    Comms.sendGossip('scaling', payload, tracker, sender, NodeList.byIdOrder, false, 2)
  } finally {
    profilerInstance.scopedProfileSectionEnd('gossip-scaling')
  }
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
  /* prettier-ignore */ if (logFlags && logFlags.verbose) console.log( 'Resetting auto-scale module', `Cycle ${CycleCreator.currentCycle}, Quarter: ${CycleCreator.currentQuarter}`)
  scalingRequested = false
  scalingRequestsCollector = new Map()
  requestedScalingType = null
  approvedScalingType = null
}

export function getDesiredCount(): number {
  // having trouble finding a better way to update this!
  if (desiredCount < config.p2p.minNodes) {
    desiredCount = config.p2p.minNodes
  }

  return desiredCount
}

function createScaleRequest(scaleType): P2P.CycleAutoScaleTypes.SignedScaleRequest {
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
  //scalingRequested makes sure we only request scaling on our own once per cycle
  if (!Self.isActive || scalingRequested) return
  const signedRequest: P2P.CycleAutoScaleTypes.SignedScaleRequest = createScaleRequest(upOrDown)
  // await _waitUntilEndOfCycle()
  const isRequestAdded = addExtScalingRequest(signedRequest)
  if (isRequestAdded) {
    info(
      `Our scale request is added. Gossiping our scale request to other nodes. ${JSON.stringify(
        signedRequest
      )}`
    )
    Comms.sendGossip('scaling', signedRequest, '', null, NodeList.byIdOrder, true, 2)
    scalingRequested = true
    requestedScalingType = signedRequest.scale //only set this when our node requests scaling
    nestedCountersInstance.countEvent('p2p', 'initiate gossip: scaling: ' + (upOrDown ? 'up' : 'down'))
  }
}

export function requestNetworkUpsize() {
  if (getDesiredCount() >= config.p2p.maxNodes) {
    return
  }

  if (_canThisNodeSendScaleRequests(Self.id) === false && config.debug.ignoreScaleGossipSelfCheck === false) {
    return
  }

  console.log('DBG', 'UPSIZE!')
  _requestNetworkScaling(P2P.CycleAutoScaleTypes.ScaleType.UP)
}

export function requestNetworkDownsize() {
  if (getDesiredCount() <= config.p2p.minNodes) {
    return
  }

  if (_canThisNodeSendScaleRequests(Self.id) === false && config.debug.ignoreScaleGossipSelfCheck === false) {
    return
  }

  console.log('DBG', 'DOWNSIZE!')
  _requestNetworkScaling(P2P.CycleAutoScaleTypes.ScaleType.DOWN)
}

function addExtScalingRequest(scalingRequest: P2P.CycleAutoScaleTypes.SignedScaleRequest): boolean {
  const added = _addScalingRequest(scalingRequest)
  return added
}

function validateScalingRequest(scalingRequest: P2P.CycleAutoScaleTypes.SignedScaleRequest): boolean {
  // Check existence of fields
  if (
    !scalingRequest.nodeId ||
    !scalingRequest.timestamp ||
    !scalingRequest.counter ||
    !scalingRequest.scale ||
    !scalingRequest.sign
  ) {
    warn(`Invalid scaling request, missing fields. Request: ${JSON.stringify(scalingRequest)}`)
    return false
  }
  // Check if cycle counter matches
  if (scalingRequest.counter !== CycleCreator.currentCycle) {
    warn(
      `Invalid scaling request, not for this cycle. Current cycle:${
        CycleCreator.currentCycle
      }, cycleInScaleRequest: ${scalingRequest.counter} Request: ${JSON.stringify(scalingRequest)}`
    )
    return false
  }
  // Check if we are trying to scale either up or down
  if (
    scalingRequest.scale !== P2P.CycleAutoScaleTypes.ScaleType.UP &&
    scalingRequest.scale !== P2P.CycleAutoScaleTypes.ScaleType.DOWN
  ) {
    warn(`Invalid scaling request, not a valid scaling type. Request: ${JSON.stringify(scalingRequest)}`)
    return false
  }
  // Try to get the node who supposedly signed this request
  let node
  try {
    node = NodeList.nodes.get(scalingRequest.nodeId)
  } catch (e) {
    warn(e)
    warn(`Invalid scaling request, not a known node. Request: ${JSON.stringify(scalingRequest)}`)
    return false
  }
  if (node == null) {
    warn(`Invalid scaling request, not a known node. Request: ${JSON.stringify(scalingRequest)}`)
    return false
  }
  // Return false if fails validation for signature
  if (!crypto.verify(scalingRequest, node.publicKey)) {
    warn(`Invalid scaling request, signature is not valid. Request: ${JSON.stringify(scalingRequest)}`)
    return false
  }
  return true
}

//Protocl security node:
//note we will need the ablity to check if other nodes also meet this requirement
//so that we can reject input from nodes that are not permitted to send a vote
//to do that well we need to make it easy to get the index of a node by ID.
//If the currentCycleShardData is null then we can't do this check and return false
function _canThisNodeSendScaleRequests(_nodeId: string) {
  let scaleVoteLimits = config.p2p.scaleGroupLimit > 0
  if (scaleVoteLimits === false) {
    return true
  }
  if (stateManager.currentCycleShardData == null) {
    return false
  }

  let numActiveNodes = NodeList.activeByIdOrder.length

  if (numActiveNodes < config.p2p.scaleGroupLimit) {
    return true
  }
  let canSendGossip = false
  let offset = CycleChain.newest.counter //todo something more random

  const ourIndex = getOurNodeIndex()
  if (ourIndex == null)
    return false

  canSendGossip = fastIsPicked(ourIndex, numActiveNodes, config.p2p.scaleGroupLimit, offset)

  return canSendGossip
}

function _checkScaling() {
  // Keep a flag if we have changed our metadata.scaling at all
  let changed = false

  lastScalingType = approvedScalingType
  if (approvedScalingType === P2P.CycleAutoScaleTypes.ScaleType.UP) {
    warn('Already set to scale up this cycle. No need to scale up anymore.')
    return
  }
  if (approvedScalingType === P2P.CycleAutoScaleTypes.ScaleType.DOWN) {
    warn('Already set to scale down this cycle. No need to scale down anymore.')
    return
  }

  // lazy init of desiredCount
  // if we have a good value in our cycle chane for desired nodes update our desired count.
  if (CycleChain.newest != null && CycleChain.newest.desired != null) {
    desiredCount = CycleChain.newest.desired
  }

  let numActiveNodes = NodeList.activeByIdOrder.length
  let requiredVotes = Math.max(
    config.p2p.minScaleReqsNeeded,
    config.p2p.scaleConsensusRequired * numActiveNodes
  )

  let scaleUpRequests = getScaleUpRequests()
  let scaleDownRequests = getScaleDownRequests()

  let scaleVoteLimits = config.p2p.scaleGroupLimit > 0 && numActiveNodes > config.p2p.scaleGroupLimit
  if (scaleVoteLimits) {
    //This will reduce the amount of votde required, because scaleGroupLimit will limit the number of nodes actually voting
    requiredVotes = Math.min(requiredVotes, config.p2p.scaleGroupLimit * config.p2p.scaleConsensusRequired)
  }

  // Check up first, but must have more votes than down votes.
  if (scaleUpRequests.length >= requiredVotes && scaleUpRequests.length >= scaleDownRequests.length) {
    approvedScalingType = P2P.CycleAutoScaleTypes.ScaleType.UP
    changed = true
  }

  // If we haven't approved an scale type, check if we should scale down
  if (!changed) {
    // if (approvedScalingType === P2P.CycleAutoScaleTypes.ScaleType.DOWN) {
    //   warn(
    //     'Already set to scale down for this cycle. No need to scale down anymore.'
    //   )
    //   return
    // }
    /* prettier-ignore */ if (logFlags && logFlags.verbose) console.log("CycleAutoScale: scale up not approved")
    if (scaleDownRequests.length >= requiredVotes) {
      approvedScalingType = P2P.CycleAutoScaleTypes.ScaleType.DOWN
      changed = true
    } else {
      /* prettier-ignore */ if (logFlags && logFlags.verbose) console.log("CycleAutoScale: changed is ", changed)
      /* prettier-ignore */ if (logFlags && logFlags.verbose) console.log("CycleAutoScale: won't change desired")
      // Return if we don't change anything
      return
    }
  }

  lastScalingType = approvedScalingType
  // At this point, we have changed our scaling type flag (approvedScalingType)
  let newDesired
  switch (approvedScalingType) {
    case P2P.CycleAutoScaleTypes.ScaleType.UP:
      newDesired = CycleChain.newest.desired + config.p2p.amountToGrow
      // If newDesired more than maxNodes, set newDesired to maxNodes
      if (newDesired > config.p2p.maxNodes) newDesired = config.p2p.maxNodes

      //limit growth to no more than 20% more than active
      let moreThanActiveMax = Math.floor(numActiveNodes * config.p2p.maxDesiredMultiplier)
      if (newDesired > moreThanActiveMax) newDesired = moreThanActiveMax

      setDesiredCount(newDesired)
      break
    case P2P.CycleAutoScaleTypes.ScaleType.DOWN:
      newDesired = CycleChain.newest.desired - config.p2p.amountToGrow
      // If newDesired less than minNodes, set newDesired to minNodes
      if (newDesired < config.p2p.minNodes) newDesired = config.p2p.minNodes

      setDesiredCount(newDesired)
      break
    default:
      error(new Error(`Invalid scaling flag after changing flag. Flag: ${approvedScalingType}`))
      return
  }
  console.log('newDesired', newDesired)
}

function setDesiredCount(count: number) {
  if (count >= config.p2p.minNodes && count <= config.p2p.maxNodes) {
    console.log('Setting desired count to', count)
    desiredCount = count
  }
}

function setAndGetTargetCount(prevRecord: P2P.CycleCreatorTypes.CycleRecord): number {
  const active = NodeList.activeByIdOrder.length

  if (prevRecord && prevRecord.mode !== undefined) {
    // For now, we are using the desired value from the previous cycle. In the future, we should look at using the next desired value
    const desired = prevRecord.desired

    if (prevRecord.mode === 'forming') {
      /* prettier-ignore */ if (logFlags && logFlags.verbose) console.log("CycleAutoScale: in forming")
      if (active != desired) {
        if (active < desired) {
          /* prettier-ignore */ if (logFlags && logFlags.verbose) console.log("CycleAutoScale: entered active < desired")
          let add = ~~(0.5 * active)
          if (add < 7) { 
            add = 7
          }
          targetCount = active + add
          if (targetCount > desired) { 
            targetCount = desired 
          }
        }
        if (active > desired) {
          /* prettier-ignore */ if (logFlags && logFlags.verbose) console.log("CycleAutoScale: entered active > desired")
          let sub = ~~(0.3 * active)
          if (sub < 1) { 
            sub = 1 
          }
          targetCount = active - sub
          if (targetCount < desired) { 
            targetCount = desired 
          }
        }
      }
    } else if (prevRecord.mode === 'processing') {
      /* prettier-ignore */ if (logFlags && logFlags.verbose) console.log("CycleAutoScale: in processing")
      if (enterSafety(active, prevRecord) === false && enterRecovery(active) === false) {
        /* prettier-ignore */ if (logFlags && logFlags.verbose) console.log("CycleAutoScale: not in safety")
        let addRem = (desired - prevRecord.target) * 0.1
        /* prettier-ignore */ if (logFlags && logFlags.verbose) console.log(`addRem: ${addRem}, desired: ${desired}, prevTarget: ${prevRecord.target}`)
        if (addRem > active * 0.01) {
          addRem = active * 0.01
        } 
        if (addRem < 0 - active * 0.005) { 
          addRem = 0 - active * 0.005
        }
        /* prettier-ignore */ if (logFlags && logFlags.verbose) console.log(`CycleAutoScale: prev target is ${prevRecord.target} and addRem is ${addRem}`)
        targetCount = prevRecord.target + addRem
        // may want to swap config values to values from cycle record
        if (targetCount < config.p2p.minNodes) { 
          targetCount = config.p2p.minNodes 
        }
        if (targetCount > config.p2p.maxNodes) { 
          targetCount = config.p2p.maxNodes 
        }
      }
    }
  } else if(Self.isFirst && active < 1) {
    /* prettier-ignore */ if (logFlags && logFlags.verbose) console.log("CycleAutoScale: in Self.isFirst condition")
    targetCount = 7
  }
  /* prettier-ignore */ if (logFlags && logFlags.verbose) console.log("CycleAutoScale: target count is ", targetCount)
  return targetCount
}

export function configUpdated() {
  if (desiredCount < config.p2p.minNodes) {
    desiredCount = config.p2p.minNodes
    //requestNetworkUpsize updates desiredCount internally
    //we may still want this, but need some special testing to be sure
    //requestNetworkUpsize()
  }
  // if (desiredCount > config.p2p.maxNodes) {
  //   desiredCount = config.p2p.maxNodes
  //   //we may still want this, but need some special testing to be sure
  //   //requestNetworkDownsize()
  // }
}

export function queueRequest(request) {}

export function sendRequests() {}

//TODO please review this.  It seems we get consensus on scale up/down, but then
//are not using the autoscaling list for the subsequent operations?
//maybe that is ok?
export function getTxs(): P2P.CycleAutoScaleTypes.Txs {
  // [IMPORTANT] Must return a copy to avoid mutation
  const requestsCopy = deepmerge({}, [...Object.values(scalingRequestsCollector)])
  return {
    autoscaling: requestsCopy,
  }
}

export function validateRecordTypes(rec: P2P.CycleAutoScaleTypes.Record): string {
  let err = validateTypes(rec, { desired: 'n' })
  if (err) return err
  return ''
}

export function updateRecord(txs: P2P.CycleAutoScaleTypes.Txs,
  record: P2P.CycleCreatorTypes.CycleRecord,
  prevRecord: P2P.CycleCreatorTypes.CycleRecord) {
  //just in time scaling vote count.
  _checkScaling()
  record.desired = getDesiredCount()
  record.target = setAndGetTargetCount(prevRecord)

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

function getScaleUpRequests(): P2P.CycleAutoScaleTypes.SignedScaleRequest[] {
  let requests = []
  for (let [nodeId, request] of scalingRequestsCollector) {
    if (request.scale === P2P.CycleAutoScaleTypes.ScaleType.UP) requests.push(request)
  }
  return requests
}

function getScaleDownRequests(): P2P.CycleAutoScaleTypes.SignedScaleRequest[] {
  let requests = []
  for (let [nodeId, request] of scalingRequestsCollector) {
    if (request.scale === P2P.CycleAutoScaleTypes.ScaleType.DOWN) requests.push(request)
  }
  return requests
}

function _addToScalingRequests(scalingRequest): boolean {
  switch (scalingRequest.scale) {
    case P2P.CycleAutoScaleTypes.ScaleType.UP:
      // This was blocking other votes from comming in.. need to check this in _requestNetworkScaling
      // if (requestedScalingType === P2P.CycleAutoScaleTypes.ScaleType.DOWN) {
      //   warn('Already scaling down this cycle. Cannot add scaling up request.')
      //   return false
      // }

      // Check if we have exceeded the limit of scaling requests
      if (scalingRequestsCollector.size >= config.p2p.maxScaleReqs) {
        warn('Max scale up requests already exceeded. Cannot add request.')
        return true // return true because this should not short circuit gossip
      }
      scalingRequestsCollector.set(scalingRequest.nodeId, scalingRequest)
      // requestedScalingType = P2P.CycleAutoScaleTypes.ScaleType.UP //this was locking out votes for scale down
      // console.log(`Added scale request in cycle ${CycleCreator.currentCycle}, quarter ${CycleCreator.currentQuarter}`, requestedScalingType, scalingRequest)

      //_checkScaling() //Wait till later to calculate this.  Not for perf reasons, but to get the max possible votes considered
      return true
    case P2P.CycleAutoScaleTypes.ScaleType.DOWN:
      // This was blocking other votes from comming in.. need to check this in _requestNetworkScaling
      // Check if we are already voting scale up, don't add in that case
      // if (requestedScalingType === P2P.CycleAutoScaleTypes.ScaleType.UP) {
      //   warn('Already scaling up this cycle. Cannot add scaling down request.')
      //   return false
      // }
      // Check if we have exceeded the limit of scaling requests
      if (scalingRequestsCollector.size >= config.p2p.maxScaleReqs) {
        warn('Max scale down requests already exceeded. Cannot add request.')
        return true // return true because this should not short circuit gossip
      }
      scalingRequestsCollector.set(scalingRequest.nodeId, scalingRequest)
      // requestedScalingType = P2P.CycleAutoScaleTypes.ScaleType.DOWN //this was locking out votes for scale up

      //_checkScaling() //Wait till later to calculate this.  Not for perf reasons, but to get the max possible votes considered
      return true
    default:
      warn(`Invalid scaling type in _addToScalingRequests(). Request: ${JSON.stringify(scalingRequest)}`)
      return false
  }
}

function _addScalingRequest(scalingRequest: P2P.CycleAutoScaleTypes.SignedScaleRequest): boolean {
  // Check existence of node
  if (!scalingRequest.nodeId) return false

  // Check scaling seen for this node
  if (scalingRequestsCollector.has(scalingRequest.nodeId)) return false

  const valid = validateScalingRequest(scalingRequest)
  if (!valid) return false

  // If we pass validation, add to current cycle
  const added = _addToScalingRequests(scalingRequest)
  return added
}

//TODO: we need to consider using _waitUntilEndOfCycle to schedule voting times
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
  if (logFlags.p2pNonFatal) info(`Waiting for ${timeToWait} ms before next cycle marker creation...`)
  await sleep(timeToWait)
}

function info(...msg) {
  const entry = `CycleAutoScale: ${msg.join(' ')}`
  p2pLogger.info(entry)
}

function warn(...msg) {
  const entry = `CycleAutoScale: ${msg.join(' ')}`
  p2pLogger.warn(entry)
}

function error(...msg) {
  const entry = `CycleAutoScale: ${msg.join(' ')}`
  p2pLogger.error(entry)
}
