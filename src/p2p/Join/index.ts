import deepmerge from 'deepmerge'
import { version } from '../../../package.json'
import * as http from '../../http'
import { logFlags } from '../../logger'
import { hexstring, P2P } from '@shardus/types'
import * as utils from '../../utils'
import { validateTypes, isEqualOrNewerVersion } from '../../utils'
import * as Comms from '../Comms'
import { config, crypto, logger, network, shardus } from '../Context'
import * as CycleChain from '../CycleChain'
import * as CycleCreator from '../CycleCreator'
import * as NodeList from '../NodeList'
import * as Self from '../Self'
import { robustQuery } from '../Utils'
import { isBogonIP, isInvalidIP, isIPv6 } from '../../utils/functions/checkIP'
import { nestedCountersInstance } from '../../utils/nestedCounters'
import { Logger } from 'log4js'
import { calculateToAcceptV2 } from '../ModeSystemFuncs'
import { routes } from './routes'
import {
  debugDumpJoinRequestList,
  drainNewJoinRequests,
  getLastHashedStandbyList,
  getStandbyNodesInfoMap,
  saveJoinRequest,
} from './v2'
import { err, ok, Result } from 'neverthrow'
import { drainSelectedPublicKeys, forceSelectSelf } from './v2/select'
import { deleteStandbyNode, drainNewUnjoinRequests } from './v2/unjoin'
import { JoinRequest } from '@shardus/types/build/src/p2p/JoinTypes'
import { updateNodeState } from '../Self'
import { HTTPError } from 'got'
import { drainLostAfterSelectionNodes, drainSyncStarted, nodesYetToStartSyncing, lostAfterSelection } from './v2/syncStarted'
import { drainFinishedSyncingRequest } from './v2/syncFinished'

/** STATE */

let p2pLogger: Logger
let mainLogger: Logger

let requests: P2P.JoinTypes.JoinRequest[]
let seen: Set<P2P.P2PTypes.Node['publicKey']>

let lastLoggedCycle = 0

let allowBogon = false
export function setAllowBogon(value: boolean): void {
  allowBogon = value
}
export function getAllowBogon(): boolean {
  return allowBogon
}

let mode = null

// let hasSubmittedJoinRequest = false
// export function getHasSubmittedJoinRequest(): boolean {
//   return hasSubmittedJoinRequest
// }

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
export function calculateToAccept(): number {
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
  // TODO drop any invalid join requests. NOTE: this has never been implemented
  // yet, so this task is not a side effect of any work on join v2.
  return { join: txs.join }
}

export function updateRecord(txs: P2P.JoinTypes.Txs, record: P2P.CycleCreatorTypes.CycleRecord): void {
  record.syncing = NodeList.syncingByIdOrder.length
  record.standbyAdd = []
  record.standbyRemove = []
  record.startedSyncing = []
  record.lostAfterSelection = []
  record.finishedSyncing = []

  if (config.p2p.useJoinProtocolV2) {
    // for join v2, add new standby nodes to the standbyAdd field ...
    for (const standbyNode of drainNewJoinRequests()) {
      record.standbyAdd.push(standbyNode)
    }

    // ... and unjoining nodes to the standbyRemove field ...
    for (const publicKey of drainNewUnjoinRequests()) {
      record.standbyRemove.push(publicKey)
    }

    for (const nodeId of drainSyncStarted()) {
      record.startedSyncing.push(nodeId)
    }

    record.syncing += record.startedSyncing.length
    
    // these nodes are being repeated in lost and apop
    for (const nodeId of drainLostAfterSelectionNodes()) {
      record.lostAfterSelection.push(nodeId)
    }
    // add node id from newSyncFinishedNodes to the finishedSyncing list to update readyByTimeAndIdOrder when parsed
    for (const nodeId of drainFinishedSyncingRequest()) {
      record.finishedSyncing.push(nodeId)
    }

    let standbyRemoved_Age = 0
    //let standbyRemoved_joined = 0
    let standbyRemoved_App = 0
    let skipped = 0
    const standbyList = getLastHashedStandbyList()
    const standbyListMap = getStandbyNodesInfoMap()

    if (config.p2p.standbyAgeScrub) {
      // scrub the stanby list of nodes that have been in it too long.  > standbyListCyclesTTL num cycles
      for (const joinRequest of standbyList) {
        const maxAge = record.duration * config.p2p.standbyListCyclesTTL
        if (record.start - joinRequest.nodeInfo.joinRequestTimestamp > maxAge) {
          const key = joinRequest.nodeInfo.publicKey

          if (standbyListMap.has(key) === false) {
            skipped++
            continue
          }

          record.standbyRemove.push(key)
          standbyRemoved_Age++
          if (standbyRemoved_Age >= config.p2p.standbyListMaxRemoveTTL) {
            break
          }
        }
      }
    }
    if (config.p2p.standbyVersionScrub) {
      for (const joinRequest of standbyList) {
        const key = joinRequest.nodeInfo.publicKey
        if (standbyListMap.has(key) === false) {
          skipped++
          continue
        }
        const { canStay, reason } = shardus.app.canStayOnStandby(joinRequest)
        if (canStay === false) {
          record.standbyRemove.push(key)
          /* prettier-ignore */ if (logFlags.p2pNonFatal) console.log( `join:updateRecord cycle number: ${record.counter} removed standby node ${key} reason: ${reason}` )
          standbyRemoved_App++
          if (standbyRemoved_App >= config.p2p.standbyListMaxRemoveTTL) {
            break
          }
        }
      }

      /* prettier-ignore */ if (logFlags.p2pNonFatal) console.log( `join:updateRecord cycle number: ${record.counter} skipped: ${skipped} removedTTLCount: ${standbyRemoved_Age}  removed list: ${record.standbyRemove} ` )
      /* prettier-ignore */ if (logFlags.p2pNonFatal) debugDumpJoinRequestList(standbyList, `join.updateRecord: last-hashed ${record.counter}`)
      /* prettier-ignore */ if (logFlags.p2pNonFatal) debugDumpJoinRequestList( Array.from(getStandbyNodesInfoMap().values()), `join.updateRecord: standby-map ${record.counter}` )
    }

    record.standbyAdd.sort((a, b) => (a.nodeInfo.publicKey > b.nodeInfo.publicKey ? 1 : -1))
    record.standbyRemove.sort()

    //let standbyActivated = false

    // ... then add any standby nodes that are now allowed to join
    const selectedPublicKeys = drainSelectedPublicKeys()
    /* prettier-ignore */ if (logFlags.p2pNonFatal && logFlags.console) console.log('selected public keys', selectedPublicKeys)
    record.joinedConsensors = record.joinedConsensors || []
    for (const publicKey of selectedPublicKeys) {
      const standbyInfo = getStandbyNodesInfoMap().get(publicKey)

      // the standbyInfo *should* exist, but if it doesn't, continue without
      // adding its node
      if (!standbyInfo) continue

      /* prettier-ignore */ if (logFlags.p2pNonFatal && logFlags.console) console.log('selected standby node', standbyInfo)

      // prepare information for the joinedConsensors list
      const { nodeInfo, cycleMarker: cycleJoined } = standbyInfo
      const id = computeNodeId(nodeInfo.publicKey, standbyInfo.cycleMarker)
      const counterRefreshed = record.counter

      record.joinedConsensors.push({ ...nodeInfo, cycleJoined, counterRefreshed, id })
    }

    /* prettier-ignore */ if (logFlags.p2pNonFatal) console.log( `standbyRemoved_Age: ${standbyRemoved_Age} standbyRemoved_App: ${standbyRemoved_App}` )

    record.joinedConsensors.sort()
  } else {
    // old protocol handling
    record.joinedConsensors = txs.join
      .map((joinRequest) => {
        const { nodeInfo, cycleMarker: cycleJoined } = joinRequest
        const id = computeNodeId(nodeInfo.publicKey, cycleJoined)
        const counterRefreshed = record.counter
        return { ...nodeInfo, cycleJoined, counterRefreshed, id }
      })
      .sort()
    /* prettier-ignore */ if (logFlags && logFlags.verbose) console.log("new desired count: ", record.desired)
  }
}

export function parseRecord(record: P2P.CycleCreatorTypes.CycleRecord): P2P.CycleParserTypes.Change {
  const added = record.joinedConsensors
  const finishedSyncing = record.finishedSyncing

  for (const node of added) {
    node.syncingTimestamp = record.start
    // finally, remove the node from the standby list

    const publicKey = node.publicKey
    /* prettier-ignore */ if (logFlags.p2pNonFatal) console.log(`join:parseRecord node-selcted cycle: ${record.counter} removed standby node ${publicKey}`)
    deleteStandbyNode(publicKey)
  }

  if (added.length > 0) {
    /* prettier-ignore */ if (logFlags.p2pNonFatal) debugDumpJoinRequestList( Array.from(getStandbyNodesInfoMap().values()), `join.parseRecord: standby-map ${record.counter} some activated:${record.counter}` )
  }
  
  const updated: P2P.NodeListTypes.Update[] = []

  for (const nodeId of record.startedSyncing) {
    if (NodeList.selectedById.has(nodeId)) {
      updated.push({
        id: nodeId,
        status: P2P.P2PTypes.NodeStatus.SYNCING
      })
    }
  }

  const addedIds = added.map((node) => node.id)

  for (const [nodeId, cycleNumber] of NodeList.selectedById) {
    if (addedIds.includes(nodeId)) {
      // do nothing. the node was just added and isn't in the nodelist yet
    } else if (record.counter > cycleNumber + config.p2p.cyclesToWaitForSyncStarted) {
      nestedCountersInstance.countEvent('p2p', `failed to send sync-started`)
      /* prettier-ignore */ if (logFlags.verbose) console.log(`Failed to send sync-started`)
      lostAfterSelection.push(nodeId)
    }
  }

  if (finishedSyncing.includes(Self.id)) {
    Self.updateNodeState(P2P.P2PTypes.NodeStatus.READY)
    /* prettier-ignore */ if (logFlags.p2pNonFatal) console.log(`join:parseRecord node-selcted cycle: ${record.counter} updated self to ready`)
  }
  // TODO: [] (BUI) okay to use record.start instead of cycle.start? had problem for first node with cycle.start
  //const cycle = this.p2p.state.getLastCycle()
  for (const node of finishedSyncing) {
    updated.push({
      id: node,
      status: P2P.P2PTypes.NodeStatus.READY,
      readyTimestamp: record.start,
    })
  }

  return {
    added,
    removed: [...lostAfterSelection],
    updated,
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
      /* prettier-ignore */ if (logFlags.important_as_fatal) warn(`shardus.app.getJoinData failed due to ${utils.formatErrorMessage(e)}`)
      return
    }
  }
  const signedJoinReq = crypto.sign(joinReq)
  if (logFlags.p2pNonFatal) info(`Join request created... Join request: ${JSON.stringify(signedJoinReq)}`)
  return signedJoinReq
}

export interface JoinRequestResponse {
  /** Whether the join request was accepted. TODO: consider renaming to `accepted`? */
  success: boolean

  /** A message explaining the result of the join request. */
  reason: string

  /** Whether the join request could not be accepted due to some error, usually in validating a join request. TODO: consider renaming to `invalid`? */
  fatal: boolean
}

/**
 * Processes a join request by validating the joining node's information,
 * ensuring compatibility with the network's version, checking cryptographic signatures, and responding
 * with either an acceptance or rejection based on the provided criteria.
 *
 * This function serves as a critical part of the network's security, allowing only valid and authenticated
 * nodes to participate in the network activities.
 *
 * @function
 * @param {P2P.JoinTypes.JoinRequest} joinRequest - The request object containing information about the joining node.
 * @returns {JoinRequestResponse} The result of the join request, with details about acceptance or rejection.
 * @throws {Error} Throws an error if the validation of the join request fails.
 */
export function addJoinRequest(joinRequest: P2P.JoinTypes.JoinRequest): JoinRequestResponse {
  if (Self.p2pIgnoreJoinRequests === true) {
    if (logFlags.p2pNonFatal) info(`Join request ignored. p2pIgnoreJoinRequests === true`)
    return {
      success: false,
      fatal: false,
      reason: `Join request ignored. p2pIgnoreJoinRequests === true`,
    }
  }

  const response = validateJoinRequest(joinRequest)
  if (response) {
    return response
  }

  // validation has passed so far
  if (logFlags.p2pNonFatal)
    info(`Got join request for ${joinRequest.nodeInfo.externalIp}:${joinRequest.nodeInfo.externalPort}`)

  if (!config.p2p.useJoinProtocolV2) {
    return decideNodeSelection(joinRequest)
  } else {
    return {
      success: false,
      reason: 'Join Protocol v2 is enabled and selection will happen eventually. Wait your turn!',
      fatal: false,
    }
  }
}

export async function firstJoin(): Promise<string> {
  let marker: string
  if (CycleChain.newest) {
    // TODO: add extra check if newest.mode === 'shutdown' later after shutdown is implemented
    // If there is a cycle provided by the archiver, use it
    marker = CycleChain.newest['marker']
  } else {
    // Create join request from 000... cycle marker
    const zeroMarker = '0'.repeat(64)
    marker = zeroMarker
  }
  const request = await createJoinRequest(marker)
  // Add own join request
  utils.insertSorted(requests, request)
  if (config.p2p.useJoinProtocolV2) {
    saveJoinRequest(request, true)
    forceSelectSelf()
  }
  // Return node ID
  return computeNodeId(crypto.keypair.publicKey, marker)
}

// export async function submitJoin(
//   nodes: P2P.P2PTypes.Node[],
//   joinRequest: P2P.JoinTypes.JoinRequest & P2P.P2PTypes.SignedObject
// ): Promise<void> {
//   // Send the join request to a handful of the active node all at once
//   const selectedNodes = utils.getRandom(nodes, Math.min(nodes.length, 5))

//   const promises = []
//   if (logFlags.p2pNonFatal) info(`Sending join request to ${selectedNodes.map((n) => `${n.ip}:${n.port}`)}`)

//   // Check if network allows bogon IPs, set our own flag accordingly
//   if (config.p2p.dynamicBogonFiltering && config.p2p.forceBogonFilteringOn === false) {
//     if (nodes.some((node) => isBogonIP(node.ip))) {
//       allowBogon = true
//     }
//   }
//   nestedCountersInstance.countEvent('p2p', `join-allow-bogon-submit:${allowBogon}`)

//   //Check for bad IPs before a join request is sent out
//   if (config.p2p.rejectBogonOutboundJoin || config.p2p.forceBogonFilteringOn) {
//     if (allowBogon === false) {
//       if (isBogonIP(joinRequest.nodeInfo.externalIp)) {
//         throw new Error(`Fatal: Node cannot join with bogon external IP: ${joinRequest.nodeInfo.externalIp}`)
//       }
//     } else {
//       //even if not checking bogon still reject other invalid IPs that would be unusable
//       if (isInvalidIP(joinRequest.nodeInfo.externalIp)) {
//         throw new Error(
//           `Fatal: Node cannot join with invalid external IP: ${joinRequest.nodeInfo.externalIp}`
//         )
//       }
//     }
//   }

//   for (const node of selectedNodes) {
//     try {
//       promises.push(http.post(`${node.ip}:${node.port}/join`, joinRequest))
//     } catch (err) {
//       throw new Error(
//         `Fatal: submitJoin: Error posting join request to ${node.ip}:${node.port}: Error: ${err}`
//       )
//     }
//   }

//   try {
//     const responses = await Promise.all(promises)

//     for (const res of responses) {
//       mainLogger.info(`Join Request Response: ${JSON.stringify(res)}`)
//       if (res.fatal) {
//         throw new Error(`Fatal: Join request Reason: ${res.reason}`)
//       }
//     }
//   } catch (e) {
//     if (e instanceof HTTPError) {
//       throw new Error(`submitJoin: Error posting join request: ${JSON.stringify(e.response)}`)
//     } else {
//       throw new Error(`submitJoin: Error posting join request: ${e}`)
//     }
//   }

//   hasSubmittedJoinRequest = true
//   if (config.p2p.useJoinProtocolV2) {
//     updateNodeState(P2P.P2PTypes.NodeStatus.STANDBY)
//   }
// }

export async function submitJoinV2(
  nodes: P2P.P2PTypes.Node[],
  joinRequest: P2P.JoinTypes.JoinRequest & P2P.P2PTypes.SignedObject
): Promise<void> {
  // Send the join request to a handful of the active node all at once
  const selectedNodes = utils.getRandom(nodes, Math.min(nodes.length, 5))

  const promises = []
  /* prettier-ignore */ if (logFlags.important_as_fatal) info(`Sending join request to ${selectedNodes.map((n) => `${n.ip}:${n.port}`)}`)

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
      //set timeout to 5000 for debugging
      const postPromise = http.post(`${node.ip}:${node.port}/join`, joinRequest, false, 5000)
      promises.push(postPromise)
    } catch (err) {
      //seems like this is eleveated too high... can it throw a wrench in the join process..
      // throw new Error(
      //   `Fatal: submitJoin: Error posting join request to ${node.ip}:${node.port}: Error: ${err}`
      // )
      /* prettier-ignore */ if (logFlags.important_as_fatal) error(`submitJoin: Error posting join request to ${node.ip}:${node.port}: Error: ${utils.formatErrorMessage(err)}`)
    }
  }

  const responses = await Promise.all(promises)
  const errs = []

  let goodCount = 0
  let unreachable = 0

  for (const res of responses) {
    /* prettier-ignore */ if (logFlags.important_as_fatal) info(`Join Request Response: ${JSON.stringify(res)}`)
    if (res && res.fatal) {
      errs.push(res)

      //special case for unreachable because the very nature of it means some timeouts could prevent us from hearing back
      if (res.reason && res.reason.startsWith('IP or Port is not reachable')) {
        unreachable++
      }
    }
    if (res && res.success === true) {
      goodCount++
    }
  }

  if (unreachable >= 2) {
    throw new Error(
      `Fatal: submitJoin: our node was reported to not be reachable by 2 or more nodes ${unreachable}`
    )
  }

  if (errs.length >= responses.length) {
    throw new Error(`Fatal: submitJoin: All join requests failed: ${errs.map((e) => e.reason).join(', ')}`)
  }

  //it is important to check that we go one good response.  this was the past cause of nodes giving up
  if (goodCount === 0) {
    nestedCountersInstance.countEvent('p2p', `submitJoin: no join success repsonses`)
    /* prettier-ignore */ if (logFlags.important_as_fatal) info(`submitJoin: no join success repsonses: ${responses.map((e) => e.reason).join(', ')}`)
    //throw new Error(`submitJoin: no join success repsonses: ${responses.map((e) => e.reason).join(', ')}`)
  }

  //does not seem to chekc the join response. assumes fatal
}

export async function fetchJoined(activeNodes: P2P.P2PTypes.Node[]): Promise<string> {
  const queryFn = async (node: P2P.P2PTypes.Node): Promise<{ node: P2P.NodeListTypes.Node }> => {
    const publicKey = crypto.keypair.publicKey
    const res: { node: P2P.NodeListTypes.Node } = await http.get(
      `${node.ip}:${node.port}/joined/${publicKey}`
    )
    return res
  }
  try {
    const { topResult: response } = await robustQuery<P2P.P2PTypes.Node, { node: P2P.NodeListTypes.Node }>(
      activeNodes,
      queryFn
    )
    if (!response) return
    if (!response.node) return
    let err = utils.validateTypes(response, { node: 'o' })
    if (err) {
      /* prettier-ignore */ if (logFlags.important_as_fatal) warn('fetchJoined invalid response response.node' + err)
      return
    }
    err = validateTypes(response.node, { id: 's' })
    if (err) {
      /* prettier-ignore */ if (logFlags.important_as_fatal) warn('fetchJoined invalid response response.node.id' + err)
      return
    }
    return response.node.id
  } catch (err) {
    /* prettier-ignore */ if (logFlags.important_as_fatal) warn('Self: fetchNodeId: robustQuery failed: ', err)
  }
}

export async function fetchJoinedV2(
  activeNodes: P2P.P2PTypes.Node[]
): Promise<{ id: string | undefined; isOnStandbyList: boolean }> {
  const queryFn = async (
    node: P2P.P2PTypes.Node
  ): Promise<{ id: string | undefined; isOnStandbyList: boolean }> => {
    const publicKey = crypto.keypair.publicKey
    const res: { id: string | undefined; isOnStandbyList: boolean } = await http.get(
      `${node.ip}:${node.port}/joinedV2/${publicKey}`
    )
    return res
  }
  try {
    const { topResult: response } = await robustQuery<
      P2P.P2PTypes.Node,
      { id: string | undefined; isOnStandbyList: boolean }
    >(activeNodes, queryFn)
    if (!response) return
    if (!response.id) {
      return { id: undefined, isOnStandbyList: response.isOnStandbyList }
    }
    let err = utils.validateTypes(response, { id: 's' })
    if (err) {
      /* prettier-ignore */ if (logFlags.important_as_fatal) warn('fetchJoined invalid response response.id' + err)
      return
    }
    err = validateTypes(response, { isOnStandbyList: 'b' })
    if (err) {
      /* prettier-ignore */ if (logFlags.important_as_fatal) warn('fetchJoined invalid response response.isOnStandbyList' + err)
      return
    }

    return { id: response.id, isOnStandbyList: response.isOnStandbyList }
  } catch (err) {
    /* prettier-ignore */ if (logFlags.important_as_fatal) warn('Self: fetchNodeId: robustQuery failed: ', utils.formatErrorMessage(err))
  }
}

/**
 * Returns a `JoinRequestResponse` object if the given `joinRequest` is invalid or rejected for any reason.
 */
export function validateJoinRequest(joinRequest: P2P.JoinTypes.JoinRequest): JoinRequestResponse | null {
  // perform validation. if any of these functions return a non-null value,
  // validation fails and the join request is rejected
  return (
    verifyJoinRequestTypes(joinRequest) ||
    validateVersion(joinRequest.version) ||
    verifyJoinRequestSigner(joinRequest) ||
    verifyNotIPv6(joinRequest) ||
    validateJoinRequestHost(joinRequest) ||
    verifyUnseen(joinRequest.nodeInfo.publicKey) ||
    verifyNodeUnknown(joinRequest.nodeInfo) ||
    validateJoinRequestTimestamp(joinRequest.nodeInfo.joinRequestTimestamp)
  )
}

/**
 * Returns an error response if the given `joinRequest` is invalid or rejected
 * based on its IP address.
 */
function validateJoinRequestHost(joinRequest: P2P.JoinTypes.JoinRequest): JoinRequestResponse | null {
  try {
    //test or bogon IPs and reject the join request if they appear
    if (allowBogon === false) {
      if (isBogonIP(joinRequest.nodeInfo.externalIp)) {
        /* prettier-ignore */ if (logFlags.p2pNonFatal) warn('Got join request from Bogon IP')
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
        /* prettier-ignore */ if (logFlags.p2pNonFatal) warn('Got join request from invalid reserved IP')
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

  return null
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

/**
 * This function is a little weird because it was taken directly from
 * `addJoinRequest`, but here's how it works:
 *
 * It validates the types of the `joinRequest`. If the types are invalid, it
 * returns a `JoinRequestResponse` object with `success` set to `false` and
 * `fatal` set to `true`. The `reason` field will contain a message describing
 * the validation error.
 *
 * If the types are valid, it returns `null`.
 */
function verifyJoinRequestTypes(joinRequest: P2P.JoinTypes.JoinRequest): JoinRequestResponse | null {
  // Validate joinReq
  let err = utils.validateTypes(joinRequest, {
    cycleMarker: 's',
    nodeInfo: 'o',
    sign: 'o',
    version: 's',
  })
  if (err) {
    /* prettier-ignore */ if (logFlags.p2pNonFatal) warn('join bad joinRequest ' + err)
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
    /* prettier-ignore */ if (logFlags.p2pNonFatal) warn('join bad joinRequest.nodeInfo ' + err)
    return {
      success: false,
      reason: 'Bad nodeInfo object structure within join request',
      fatal: true,
    }
  }
  err = utils.validateTypes(joinRequest.sign, { owner: 's', sig: 's' })
  if (err) {
    /* prettier-ignore */ if (logFlags.p2pNonFatal) warn('join bad joinRequest.sign ' + err)
    return {
      success: false,
      reason: 'Bad signature object structure within join request',
      fatal: true,
    }
  }

  return null
}

/**
 * Makes sure that the given `nodeInfo` is not already known to the network.
 * If it is, it returns a `JoinRequestResponse` object with `success` set to
 * `false` and `fatal` set to `true`. The `reason` field will contain a message
 * describing the validation error.
 *
 * If the `nodeInfo` is not already known to the network, it returns `null`.
 */
function verifyNodeUnknown(nodeInfo: P2P.P2PTypes.P2PNode): JoinRequestResponse | null {
  if (NodeList.byPubKey.has(nodeInfo.publicKey)) {
    const message = 'Cannot add join request for this node, already a known node (by public key).'
    /* prettier-ignore */ if (logFlags.p2pNonFatal) warn(message)
    return {
      success: false,
      reason: message,
      fatal: false,
    }
  }
  const ipPort = NodeList.ipPort(nodeInfo.internalIp, nodeInfo.internalPort)
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

  return null
}

/**
 * Makes sure that the given `joinRequest` is not from an IPv6 address. If it
 * is, it returns a `JoinRequestResponse` object with `success` set to `false`
 * and `fatal` set to `true`. The `reason` field will contain a message
 * describing the validation error.
 *
 * If the `joinRequest` is not from an IPv6 address, it returns `null`.
 */
function verifyNotIPv6(joinRequest: P2P.JoinTypes.JoinRequest): JoinRequestResponse | null {
  if (isIPv6(joinRequest.nodeInfo.externalIp)) {
    /* prettier-ignore */ if (logFlags.p2pNonFatal) warn('Got join request from IPv6')
    nestedCountersInstance.countEvent('p2p', `join-reject-ipv6`)
    return {
      success: false,
      reason: `Bad ip version, IPv6 are not accepted`,
      fatal: true,
    }
  }
  return null
}

/**
 * Makes sure that the given `joinRequestVersion` is not older than the
 * current version of the node. If it is, it returns a `JoinRequestResponse`
 * object with `success` set to `false` and `fatal` set to `true`. The `reason`
 * field will contain a message describing the validation error.
 *
 * If the `joinRequestVersion` is not older than the current version of the
 * node, it returns `null`.
 */
function validateVersion(joinRequestVersion: string): JoinRequestResponse | null {
  if (config.p2p.checkVersion && !isEqualOrNewerVersion(version, joinRequestVersion)) {
    /* prettier-ignore */ warn(`version number is old. Our node version is ${version}. Join request node version is ${joinRequestVersion}`)
    nestedCountersInstance.countEvent('p2p', `join-reject-version ${joinRequestVersion}`)
    return {
      success: false,
      reason: `Old shardus core version, please statisfy at least ${version}`,
      fatal: true,
    }
  }
}

/**
 * Makes sure that the given `joinRequest` is signed by the node that is
 * attempting to join. If it is not, it returns a `JoinRequestResponse` object
 * with `success` set to `false` and `fatal` set to `true`. The `reason` field
 * will contain a message describing the validation error.
 *
 * If the `joinRequest` is signed by the node that is attempting to join, it
 * returns `null`.
 */
function verifyJoinRequestSigner(joinRequest: P2P.JoinTypes.JoinRequest): JoinRequestResponse | null {
  //If the node that signed the request is not the same as the node that is joining
  if (joinRequest.sign.owner != joinRequest.nodeInfo.publicKey) {
    /* prettier-ignore */ warn(`join-reject owner != publicKey ${{ sign: joinRequest.sign.owner, info: joinRequest.nodeInfo.publicKey }}`)
    nestedCountersInstance.countEvent('p2p', `join-reject owner != publicKey`)
    return {
      success: false,
      reason: `Bad signature, sign owner and node attempted joining mismatched`,
      fatal: true,
    }
  }
}

/**
 * Makes sure that the given `joinRequest`'s node  has not already been seen this
 * cycle. If it has, it returns a `JoinRequestResponse` object with `success`
 * set to `false` and `fatal` set to `false`. The `reason` field will contain a
 * message describing the validation error.
 *
 * If the `joinRequest`'s node has not already been seen this cycle, it returns
 * `null`.
 */
function verifyUnseen(publicKey: hexstring): JoinRequestResponse | null {
  // Check if this node has already been seen this cycle
  if (seen.has(publicKey)) {
    if (logFlags.p2pNonFatal) nestedCountersInstance.countEvent('p2p', `join-skip-seen-pubkey`)
    if (logFlags.p2pNonFatal) info('Node has already been seen this cycle. Unable to add join request.')
    return {
      success: false,
      reason: 'Node has already been seen this cycle. Unable to add join request.',
      fatal: false,
    }
  }

  // Mark node as seen for this cycle
  seen.add(publicKey)

  return null
}

function validateJoinRequestTimestamp(joinRequestTimestamp: number): JoinRequestResponse | null {
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
  const cycleDuration = CycleChain.newest.duration
  const cycleStarts = CycleChain.newest.start
  const requestValidUpperBound = cycleStarts + cycleDuration
  const requestValidLowerBound = cycleStarts - cycleDuration

  if (joinRequestTimestamp < requestValidLowerBound) {
    nestedCountersInstance.countEvent('p2p', `join-skip-timestamp-not-meet-lowerbound`)
    /* prettier-ignore */ if (logFlags.p2pNonFatal) warn('Cannot add join request for this node, timestamp is earlier than allowed cycle range')
    return {
      success: false,
      reason: 'Cannot add join request, timestamp is earlier than allowed cycle range',
      fatal: false,
    }
  }

  if (joinRequestTimestamp > requestValidUpperBound) {
    nestedCountersInstance.countEvent('p2p', `join-skip-timestamp-beyond-upperbound`)
    /* prettier-ignore */ if (logFlags.p2pNonFatal) warn('Cannot add join request for this node, its timestamp exceeds allowed cycle range')
    return {
      success: false,
      reason: 'Cannot add join request, timestamp exceeds allowed cycle range',
      fatal: false,
    }
  }
}

/**
 * Returns the selection key pertaining to the given `joinRequest`. If
 * `shardus.app.validateJoinRequest` is not a function, then the selection key
 * is the public key of the node that sent the join request.
 */
function getSelectionKey(joinRequest: JoinRequest): Result<string, JoinRequestResponse> {
  if (typeof shardus.app.validateJoinRequest === 'function') {
    try {
      mode = CycleChain.newest.mode || null
      const validationResponse = shardus.app.validateJoinRequest(
        joinRequest,
        mode,
        CycleChain.newest,
        // use minNodes instead of baselineNodes here since validateJoinRequest's arguemnt minNodes is used check for adminCert when not in processing mode
        config.p2p.minNodes
      )

      if (validationResponse.success !== true) {
        /* prettier-ignore */ if (logFlags.p2pNonFatal) error( `Validation of join request data is failed due to ${validationResponse.reason || 'unknown reason'}` )
        nestedCountersInstance.countEvent('p2p', `join-reject-dapp`)
        return err({
          success: validationResponse.success,
          reason: validationResponse.reason,
          fatal: validationResponse.fatal,
        })
      }
      if (typeof validationResponse.data === 'string') {
        return ok(validationResponse.data)
      }
    } catch (e) {
      /* prettier-ignore */ if (logFlags.p2pNonFatal) warn(`shardus.app.validateJoinRequest failed due to ${utils.formatErrorMessage(e)}`)
      nestedCountersInstance.countEvent('p2p', `join-reject-ex ${e.message}`)
      return err({
        success: false,
        reason: `Could not validate join request due to Error`,
        fatal: true,
      })
    }
  }
  return ok(joinRequest.nodeInfo.publicKey)
}

export function verifyJoinRequestSignature(
  joinRequest: P2P.JoinTypes.JoinRequest
): JoinRequestResponse | null {
  if (!crypto.verify(joinRequest, joinRequest.nodeInfo.publicKey)) {
    /* prettier-ignore */ if (logFlags.p2pNonFatal) warn('join bad sign ' + JSON.stringify(joinRequest))
    nestedCountersInstance.countEvent('p2p', `join-reject-bad-sign`)
    return {
      success: false,
      reason: 'Bad signature',
      fatal: true,
    }
  }
  return null
}

/**
 * Computes a selection number given a join request.
 */
export function computeSelectionNum(joinRequest: JoinRequest): Result<string, JoinRequestResponse> {
  // get the selection key
  const selectionKeyResult = getSelectionKey(joinRequest)
  if (selectionKeyResult.isErr()) {
    return err(selectionKeyResult.error)
  }
  const selectionKey = selectionKeyResult.value

  // calculate the selection number based on the selection key
  const obj = {
    cycleNumber: CycleChain.newest.counter,
    selectionKey,
  }
  const selectionNum = crypto.hash(obj)

  return ok(selectionNum)
}

/**
 * Selects the join request's node to join the network, or doesn't.
 * Returns a `JoinRequestResponse` signifying whether the join request was
 * accepted or rejected.
 *
 * This is the logic used in Join Protocol v1.
 */
function decideNodeSelection(joinRequest: P2P.JoinTypes.JoinRequest): JoinRequestResponse {
  // Compute how many join request to accept
  let toAccept = calculateToAccept() // I think we can remove this line; as toAccept would be overriden by calculateToAcceptV2 in the next line
  nestedCountersInstance.countEvent('p2p', `results of calculateToAccept: toAccept: ${toAccept}`)
  /* prettier-ignore */ if (logFlags && logFlags.verbose) console.log("results of calculateToAccept: ", toAccept)
  const { add, remove } = calculateToAcceptV2(CycleChain.newest)
  nestedCountersInstance.countEvent('p2p', `results of calculateToAcceptV2: add: ${add}, remove: ${remove}`)
  /* prettier-ignore */ if (logFlags && logFlags.verbose) { console.log(`results of calculateToAcceptV2: add: ${add}, remove: ${remove}`) }
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
  const selectionNumResult = computeSelectionNum(joinRequest)
  if (selectionNumResult.isErr()) return selectionNumResult.error
  const selectionNum = selectionNumResult.value

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
  const validationErr = verifyJoinRequestSignature(joinRequest)
  if (validationErr) return validationErr

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

function info(...msg: string[]): void {
  const entry = `Join: ${msg.join(' ')}`
  p2pLogger.info(entry)
}

export function warn(...msg: string[]): void {
  const entry = `Join: ${msg.join(' ')}`
  p2pLogger.warn(entry)
}

export function error(...msg: string[]): void {
  const entry = `Join: ${msg.join(' ')}`
  p2pLogger.error(entry)
}
