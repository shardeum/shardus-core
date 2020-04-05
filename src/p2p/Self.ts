import Sntp from '@hapi/sntp'
import { Logger } from 'log4js'
import * as http from '../http'
import { ShardusConfiguration } from '../shardus/shardus-types'
import * as utils from '../utils'
import { crypto, logger, p2p } from './Context'
import { sync } from './Sync'
import { Node, NodeInfo } from './Types'
import * as NodeList from './NodeList'
import { robustQuery } from './Utils'
import { isDeepStrictEqual } from 'util'
import * as Archivers from './Archivers'

/** STATE */

let mainLogger: Logger
let config: ShardusConfiguration

export let id

export let externalIp: string
export let externalPort: number
export let internalIp: string
export let internalPort: number

/** ROUTES */

/** FUNCTIONS */

export async function init(conf: ShardusConfiguration) {
  config = conf
  mainLogger = logger.getLogger('main')

  // Make sure we know our IP configuration
  externalIp =
    config.ip.externalIp || (await discoverExternalIp(config.p2p.ipServer))
  externalPort = config.ip.externalPort
  internalIp = config.ip.internalIp
  internalPort = config.ip.internalPort

  if (!externalIp || !externalPort || !internalIp || !internalPort) {
    throw new Error(`p2p/Self:init: Bad IP configuration:
    externalIp: ${externalIp}
    externalPort: ${externalPort}
    internalIp: ${internalIp}
    internalPort: ${internalPort}
    `)
  }
}

export async function startup(): Promise<boolean> {
  // Emit the 'joining' event before attempting to join
  const publicKey = crypto.getPublicKey()
  mainLogger.debug('Emitting `joining` event.')
  p2p.emit('joining', publicKey)

  // Get new activeNodes and attempt to join until you are successful
  let activeNodes: Node[]
  let joined = false
  // outerJoinAttemps is set to a high number incase we want to build a large network and need the node to keep trying to join for awhile.
  while (!joined) {
    try {
      mainLogger.info('Getting activeNodes from archiver to join network...')
      activeNodes = await contactArchiver()
      mainLogger.info('Discovering if we are the first node...')
      p2p.isFirstSeed = await discoverNetwork(activeNodes)

      // Remove yourself from seedNodes if you are present in them but not firstSeed
      if (p2p.isFirstSeed === false) {
        const ourIdx = activeNodes.findIndex(
          (node: { ip: any; port: any }) =>
            node.ip === externalIp && node.port === externalPort
        )
        if (ourIdx > -1) {
          activeNodes.splice(ourIdx, 1)
        }
      }

      mainLogger.info('Attempting to join network...')
      joined = await joinNetwork(activeNodes)
    } catch (err) {
      joined = false
      mainLogger.error(err)
      mainLogger.info('Trying again in 2 sec...')
      await utils.sleep(2000)
    }
  }

  // Emit the 'joined' event before attempting to sync to the network
  mainLogger.debug('Emitting `joined` event.')
  p2p.emit('joined', p2p.id, publicKey)

  // Get new activeNodes and attempt to sync until you are successful
  let synced = false
  while (!synced) {
    // Once joined, sync to the network
    try {
      mainLogger.info('Getting activeNodes from archiver to sync to network...')
      activeNodes = await contactArchiver()

      // Remove yourself from seedNodes if you are present in them but not firstSeed
      if (p2p.isFirstSeed === false) {
        const ourIdx = activeNodes.findIndex(
          (node: { ip: any; port: any }) =>
            node.ip === externalIp && node.port === externalPort
        )
        if (ourIdx > -1) {
          activeNodes.splice(ourIdx, 1)
        }
      }

      mainLogger.info('Attempting to sync to network...')
      synced = await sync(activeNodes)
    } catch (err) {
      synced = false
      mainLogger.error(err)
      mainLogger.info('Trying again in 2 sec...')
      await utils.sleep(2000)
    }
  }

  p2p.emit('initialized')
  return true
}

async function contactArchiver() {
  const archiver: Node = config.p2p.existingArchivers[0]
  const activeNodesSigned = await getActiveNodesFromArchiver()
  if (!crypto.verify(activeNodesSigned, archiver.publicKey)) {
    throw Error('Fatal: _getSeedNodes seed list was not signed by archiver!')
  }
  const joinRequest = activeNodesSigned.joinRequest
  if (joinRequest) {
    if (Archivers.addJoinRequest(joinRequest) === false) {
      throw Error(
        'Fatal: _getSeedNodes archivers join request not accepted by us!'
      )
    }
  }
  const dataRequest = activeNodesSigned.dataRequest
  if (dataRequest) {
    Archivers.addDataRecipient(joinRequest.nodeInfo, dataRequest)
  }
  return activeNodesSigned.nodeList
}

async function discoverNetwork(seedNodes) {
  // Check if our time is synced to network time server
  try {
    const timeSynced = await checkTimeSynced(config.p2p.timeServers)
    if (!timeSynced) {
      mainLogger.warn('Local time out of sync with time server.')
    }
  } catch (e) {
    mainLogger.warn(e.message)
  }

  // Check if we are first seed node
  const isFirstSeed = checkIfFirstSeedNode(seedNodes)
  if (!isFirstSeed) {
    mainLogger.info('You are not the first seed node...')
    return false
  }
  mainLogger.info('You are the first seed node!')
  return true
}

async function joinNetwork(seedNodes) {
  mainLogger.debug('Clearing P2P state...')
  await p2p.state.clear()

  if (p2p.isFirstSeed) {
    mainLogger.debug('Joining network...')

    // context is for testing purposes
    console.log('Doing initial setup for server...')

    const cycleMarker = p2p.state.getCurrentCycleMarker()
    const joinRequest = await _createJoinRequest(cycleMarker)
    p2p.state.startCycles()
    p2p.state.addNewJoinRequest(joinRequest)

    // Sleep for cycle duration before updating status
    // TODO: Make context more deterministic
    await utils.sleep(Math.ceil(p2p.state.getCurrentCycleDuration() / 2) * 1000)
    const prevCycleMarker = p2p.state.getPreviousCycleMarker()
    mainLogger.debug(`Public key: ${joinRequest.nodeInfo.publicKey}`)
    mainLogger.debug(`Prev cycle marker: ${prevCycleMarker}`)
    const nodeId = p2p.state.computeNodeId(
      joinRequest.nodeInfo.publicKey,
      prevCycleMarker
    )
    mainLogger.debug(`Computed node ID to be set for context node: ${nodeId}`)
    await _setNodeId(nodeId)

    return true
  }

  const nodeId = await _join(seedNodes)
  if (!nodeId) {
    mainLogger.info('Unable to join network')
    return false
  }
  mainLogger.info('Successfully joined the network!')
  id = nodeId
  await _setNodeId(nodeId)
  return true
}

/** HELPER FUNCTIONS */

async function discoverExternalIp(server: string) {
  try {
    const { ip }: { ip: string } = await http.get(server)
    return ip
  } catch (err) {
    throw Error(
      `p2p/Self:discoverExternalIp: Could not discover IP from external IP server ${server}: ` +
        err.message
    )
  }
}

async function checkTimeSynced(timeServers) {
  for (const host of timeServers) {
    try {
      const time = await Sntp.time({
        host,
        timeout: 10000,
      })
      return time.t <= config.p2p.syncLimit
    } catch (e) {
      mainLogger.warn(`Couldn't fetch ntp time from server at ${host}`)
    }
  }
  throw Error('Unable to check local time against time servers.')
}

function checkIfFirstSeedNode(seedNodes) {
  if (!seedNodes.length) throw new Error('Fatal: No seed nodes in seed list!')
  if (seedNodes.length > 1) return false
  const seed = seedNodes[0]
  if (externalIp === seed.ip && externalPort === seed.port) {
    return true
  }
  return false
}

async function getActiveNodesFromArchiver() {
  const archiver = config.p2p.existingArchivers[0]
  const nodeListUrl = `http://${archiver.ip}:${archiver.port}/nodelist`
  const nodeInfo = getPublicNodeInfo()
  let seedListSigned
  try {
    seedListSigned = await http.post(nodeListUrl, {
      nodeInfo,
    })
  } catch (e) {
    throw Error(
      `Fatal: Could not get seed list from seed node server ${nodeListUrl}: ` +
        e.message
    )
  }
  mainLogger.debug(`Got signed seed list: ${JSON.stringify(seedListSigned)}`)
  return seedListSigned
}

function getIpInfo() {
  return {
    externalIp,
    externalPort,
    internalIp,
    internalPort,
  }
}

function getPublicNodeInfo() {
  const publicKey = crypto.getPublicKey()
  const curvePublicKey = crypto.convertPublicKeyToCurve(publicKey)
  const ipInfo = getIpInfo()
  const status = { status: getNodeStatus(id) }
  const nodeInfo = Object.assign(
    { id, publicKey, curvePublicKey },
    ipInfo,
    status
  )
  return nodeInfo
}

function getNodeStatus(nodeId) {
  const current = NodeList.activeByIdOrder
  if (!current[nodeId]) return null
  return current[nodeId].status
}

async function _createJoinRequest(cycleMarker) {
  // Build and return a join request
  const nodeInfo = _getThisNodeInfo()
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

function _getThisNodeInfo() {
  const { externalIp, externalPort, internalIp, internalPort } = getIpInfo()
  const publicKey = crypto.getPublicKey()
  // TODO: Change this to actual selectable address
  const address = publicKey
  const joinRequestTimestamp = utils.getTime('s')
  const activeTimestamp = 0
  const nodeInfo = {
    publicKey,
    externalIp,
    externalPort,
    internalIp,
    internalPort,
    address,
    joinRequestTimestamp,
    activeTimestamp,
  }
  mainLogger.debug(`Node info of this node: ${JSON.stringify(nodeInfo)}`)
  return nodeInfo
}

async function _setNodeId(newId, _updateDb = true) {
  id = newId
  mainLogger.info(`Your node's ID is ${id}`)
}

async function _join (seedNodes) {
  const localTime = utils.getTime('s')
  const { currentTime } = await _fetchCycleMarker(seedNodes)
  if (!_checkWithinSyncLimit(localTime, currentTime)) throw Error('Local time out of sync with network.')
  const timeOffset = currentTime - localTime
  mainLogger.debug(`Time offset with selected node: ${timeOffset}`)
  let nodeId = null
  let attempts = 2
  while (!nodeId && attempts > 0) {
    const { currentCycleMarker, nextCycleMarker, cycleStart, cycleDuration } = await _fetchCycleMarker(seedNodes)
    if (nextCycleMarker) {
      // Use next cycle marker
      const joinRequest = await _createJoinRequest(nextCycleMarker)
      nodeId = await _attemptJoin(seedNodes, joinRequest, timeOffset, cycleStart, cycleDuration)
      if (!nodeId) {
        const { cycleStart, cycleDuration } = await _fetchCycleMarker(seedNodes)
        nodeId = await _attemptJoin(seedNodes, joinRequest, timeOffset, cycleStart, cycleDuration)
      }
    } else {
      const joinRequest = await _createJoinRequest(currentCycleMarker)
      nodeId = await _attemptJoin(seedNodes, joinRequest, timeOffset, cycleStart, cycleDuration)
    }
    attempts--
  }
  return nodeId
}

async function _fetchCycleMarker (nodes) {
  const queryFn = async (node) => {
    const cycleMarkerInfo = await http.get(`${node.ip}:${node.port}/cyclemarker`)
    return cycleMarkerInfo
  }
  const [cycleMarkerInfo] = await robustQuery(nodes, queryFn, _isSameCycleMarkerInfo.bind(this))
  return cycleMarkerInfo
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

function _checkWithinSyncLimit (time1, time2) {
  const timeDif = Math.abs(time1 - time2)
  if (timeDif > config.p2p.syncLimit) {
    return false
  }
  return true
}

async function _attemptJoin (seedNodes, joinRequest, timeOffset, cycleStart, cycleDuration) {
  // TODO: check if we missed join phase
  const currTime1 = utils.getTime('s') + timeOffset
  await _waitUntilUpdatePhase(currTime1, cycleStart, cycleDuration)
  await _submitJoin(seedNodes, joinRequest)
  const currTime2 = utils.getTime('s') + timeOffset
  // This time we use cycleStart + cycleDuration because we are in the next cycle
  await _waitUntilEndOfCycle(currTime2, cycleStart + cycleDuration, cycleDuration)
  const nodeId = await _fetchNodeId(seedNodes)
  return nodeId
}

async function _waitUntilEndOfCycle (currentTime = utils.getTime('s'), cycleStart = p2p.state.getCurrentCycleStart(), cycleDuration = p2p.state.getCurrentCycleDuration()) {
  mainLogger.debug(`Current time is: ${currentTime}`)
  mainLogger.debug(`Current cycle started at: ${cycleStart}`)
  mainLogger.debug(`Current cycle duration: ${cycleDuration}`)
  const endOfCycle = cycleStart + cycleDuration
  mainLogger.debug(`End of cycle at: ${endOfCycle}`)
  let timeToWait
  if (currentTime < endOfCycle) {
    timeToWait = (endOfCycle - currentTime + config.p2p.queryDelay) * 1000
  } else {
    timeToWait = 0
  }
  mainLogger.debug(`Waiting for ${timeToWait} ms before next cycle marker creation...`)
  await utils.sleep(timeToWait)
}

async function _waitUntilUpdatePhase (currentTime = utils.getTime('s'), cycleStart = p2p.state.getCurrentCycleStart(), cycleDuration = p2p.state.getCurrentCycleDuration()) {
  // If we are already in the update phase, return
  if (_isInUpdatePhase(currentTime, cycleStart, cycleDuration)) return
  mainLogger.debug(`Current time is: ${currentTime}`)
  mainLogger.debug(`Current cycle started at: ${cycleStart}`)
  mainLogger.debug(`Current cycle duration: ${cycleDuration}`)
  const nextJoinStart = cycleStart + cycleDuration
  mainLogger.debug(`Next join cycle starts at: ${nextJoinStart}`)
  const timeToWait = (nextJoinStart - currentTime + config.p2p.queryDelay) * 1000
  mainLogger.debug(`Waiting for ${timeToWait} ms before next update phase...`)
  await utils.sleep(timeToWait)
}

function _isInUpdatePhase (currentTime = utils.getTime('s'), cycleStart = p2p.state.getCurrentCycleStart(), cycleDuration = p2p.state.getCurrentCycleDuration()) {
  mainLogger.debug(`Current time is: ${currentTime}`)
  mainLogger.debug(`Current cycle started at: ${cycleStart}`)
  mainLogger.debug(`Current cycle duration: ${cycleDuration}`)
  const startOfUpdatePhase = cycleStart
  mainLogger.debug(`Start of first quarter: ${startOfUpdatePhase}`)
  const endOfUpdatePhase = cycleStart + Math.ceil(0.25 * cycleDuration)
  mainLogger.debug(`End of first quarter: ${endOfUpdatePhase}`)
  if (currentTime < startOfUpdatePhase || currentTime > endOfUpdatePhase) {
    return false
  }
  return true
}

async function _submitJoin (nodes, joinRequest) {
  for (const node of nodes) {
    mainLogger.debug(`Sending join request to ${node.ip}:${node.port}`)
    await http.post(`${node.ip}:${node.port}/join`, joinRequest)
  }
}

async function _fetchNodeId (seedNodes) {
  const { publicKey } = _getThisNodeInfo()
  const queryFn = async (node) => {
    const { cycleJoined } = await http.get(`${node.ip}:${node.port}/joined/${publicKey}`)
    return { cycleJoined }
  }
  let query
  let attempts = 2
  while ((!query || !query[0]) && attempts > 0) {
    try {
      query = await robustQuery(seedNodes, queryFn)
    } catch (e) {
      mainLogger.error(e)
    }
    attempts--
  }
  if (attempts <= 0) {
    mainLogger.info('Unable to get consistent cycle marker from seednodes.')
    return null
  }
  const { cycleJoined } = query[0]
  if (!cycleJoined) {
    mainLogger.info('Unable to get cycle marker, likely this node\'s join request was not accepted.')
    return null
  }
  const nodeId = p2p.state.computeNodeId(publicKey, cycleJoined)
  return nodeId
}