import { P2P } from '@shardus/types'
import { NodeStatus } from '@shardus/types/build/src/p2p/P2PTypes'
import * as events from 'events'
import * as log4js from 'log4js'
import * as http from '../http'
import { logFlags } from '../logger'
import * as network from '../network'
import * as snapshot from '../snapshot'
import * as utils from '../utils'
import { getRandom } from '../utils'
import { isInvalidIP } from '../utils/functions/checkIP'
import { nestedCountersInstance } from '../utils/nestedCounters'
import * as Archivers from './Archivers'
import * as Comms from './Comms'
import * as Context from './Context'
import * as CycleCreator from './CycleCreator'
import { calcIncomingTimes } from './CycleCreator'
import * as GlobalAccounts from './GlobalAccounts'
import * as Join from './Join'
import * as NodeList from './NodeList'
import * as Sync from './Sync'

/** STATE */

export const emitter = new events.EventEmitter()

let p2pLogger: log4js.Logger

export let id: string
export let isFirst: boolean
export let isActive = false
export let allowConnectionToFirstNode = false
export let ip: string
export let port: number

export let p2pJoinTime = 0
export let p2pSyncStart = 0
export let p2pSyncEnd = 0

export let p2pIgnoreJoinRequests = true

/** ROUTES */

/** FUNCTIONS */

export function init() {
  // Setup our IP and port so modules like Sync can use it
  ip = network.ipInfo.externalIp
  port = network.ipInfo.externalPort

  // Init submodules
  Comms.init()
  Archivers.init()
  Sync.init()
  CycleCreator.init()
  GlobalAccounts.init()
  NodeList.init()

  // Create a logger for yourself
  p2pLogger = Context.logger.getLogger('p2p')
}

export async function startup(): Promise<boolean> {
  const publicKey = Context.crypto.getPublicKey()

  // If startInWitness config is set to true, start witness mode and end
  if (Context.config.p2p.startInWitnessMode) {
    if (logFlags.p2pNonFatal) info('Emitting `witnessing` event.')
    emitter.emit('witnessing', publicKey)
    return true
  }

  // Attempt to join the network until you know if you're first and have an id
  if (logFlags.p2pNonFatal) info('Emitting `joining` event.')
  emitter.emit('joining', publicKey)

  let firstTime = true
  do {
    try {
      // Get active nodes from Archiver
      const activeNodes = await contactArchiver()

      // Start in witness mode if conditions are met
      if (await witnessConditionsMet(activeNodes)) {
        if (logFlags.p2pNonFatal) info('Emitting `witnessing` event.')
        emitter.emit('witnessing', publicKey)
        return true
      } else {
        //not in witness mode
      }

      // Otherwise, try to join the network
      ;({ isFirst, id } = await joinNetwork(activeNodes, firstTime))
    } catch (err) {
      if (err.message.startsWith('Fatal:')) {
        throw err
      }
      warn('Error while joining network:')
      warn(err)
      warn(err.stack)
      if (logFlags.p2pNonFatal) info(`Trying to join again in ${Context.config.p2p.cycleDuration} seconds...`)
      await utils.sleep(Context.config.p2p.cycleDuration * 1000)
    }
    firstTime = false
  } while (utils.isUndefined(isFirst) || utils.isUndefined(id))

  p2pSyncStart = Date.now()

  if (logFlags.p2pNonFatal) info('Emitting `joined` event.')
  emitter.emit('joined', id, publicKey)

  nestedCountersInstance.countEvent('p2p', 'joined')
  // Sync cycle chain from network
  await syncCycleChain()

  // Enable internal routes
  Comms.setAcceptInternal(true)

  // Start creating cycle records
  await CycleCreator.startCycles()

  p2pSyncEnd = Date.now()
  p2pJoinTime = (p2pSyncEnd - p2pSyncStart) / 1000

  nestedCountersInstance.countEvent('p2p', `sync time ${p2pJoinTime} seconds`)

  if (logFlags.p2pNonFatal) info('Emitting `initialized` event.' + p2pJoinTime)
  emitter.emit('initialized')

  return true
}

async function witnessConditionsMet(activeNodes: P2P.P2PTypes.Node[]) {
  try {
    // 1. node has old data
    if (snapshot.oldDataPath) {
      const latestCycle = await Sync.getNewestCycle(activeNodes)
      // 2. network is in safety mode
      if (latestCycle.safetyMode === true) {
        // 3. active nodes >= max nodes
        if (latestCycle.active >= Context.config.p2p.maxNodes) {
          return true
        }
      }
    }
  } catch (e) {
    warn(e)
  }
  return false
}

async function joinNetwork(activeNodes: P2P.P2PTypes.Node[], firstTime: boolean) {
  // Check if you're the first node
  const isFirst = discoverNetwork(activeNodes)
  if (isFirst) {
    // Join your own network and give yourself an ID
    const id = await Join.firstJoin()
    // Return id and isFirst
    return { isFirst, id }
  }

  // Remove yourself from activeNodes if you are present in them
  const ourIdx = activeNodes.findIndex(
    (node) => node.ip === network.ipInfo.externalIp && node.port === network.ipInfo.externalPort
  )
  if (ourIdx > -1) {
    activeNodes.splice(ourIdx, 1)
  }

  // Check joined before trying to join, if not first time
  if (firstTime === false) {
    // Check if joined by trying to set our node ID
    const id = await Join.fetchJoined(activeNodes)
    if (id) {
      return { isFirst, id }
    }
  }

  // Get latest cycle record from active nodes
  const latestCycle = await Sync.getNewestCycle(activeNodes)

  const publicKey = Context.crypto.getPublicKey()
  const isReadyToJoin = await Context.shardus.app.isReadyToJoin(latestCycle, publicKey, activeNodes)
  if (!isReadyToJoin) {
    // Wait for Context.config.p2p.cycleDuration and try again
    throw new Error('Node not ready to join')
  }

  // Create join request from latest cycle
  const request = await Join.createJoinRequest(latestCycle.previous)

  //we can't use allowBogon lag yet because its value is detected later.
  //it is possible to throw out any invalid IPs at this point
  if (Context.config.p2p.rejectBogonOutboundJoin || Context.config.p2p.forceBogonFilteringOn) {
    if (isInvalidIP(request.nodeInfo.externalIp)) {
      throw new Error(`Fatal: Node cannot join with invalid external IP: ${request.nodeInfo.externalIp}`)
    }
  }

  // Figure out when Q1 is from the latestCycle
  const { startQ1, startQ4 } = calcIncomingTimes(latestCycle)
  if (logFlags.p2pNonFatal) info(`Next cycles Q1 start ${startQ1}; Currently ${Date.now()}`)

  // Wait until a Q1 then send join request to active nodes
  let untilQ1 = startQ1 - Date.now()
  while (untilQ1 < 0) {
    untilQ1 += latestCycle.duration * 1000
  }

  if (logFlags.p2pNonFatal) info(`Waiting ${untilQ1 + 500} ms for Q1 before sending join...`)
  await utils.sleep(untilQ1 + 500) // Not too early

  await Join.submitJoin(activeNodes, request)

  // Wait approx. one cycle then check again
  if (logFlags.p2pNonFatal) info('Waiting approx. one cycle then checking again...')

  // Wait until a Q4 before we loop ..
  // This is a bit faster than before and should allow nodes to try joining
  // without skipping a cycle
  let untilQ4 = startQ4 - Date.now()
  while (untilQ4 < 0) {
    untilQ4 += latestCycle.duration * 1000
  }
  await utils.sleep(untilQ4 + 500)

  //await utils.sleep(Context.config.p2p.cycleDuration * 1000 + 500)

  return {
    isFirst: undefined,
    id: undefined,
  }
}

async function syncCycleChain() {
  // You're already synced if you're first
  if (isFirst) return

  let synced = false
  while (!synced) {
    // Once joined, sync to the network
    try {
      if (logFlags.p2pNonFatal) info('Getting activeNodes from archiver to sync to network...')
      const activeNodes = await contactArchiver()

      // Remove yourself from activeNodes if you are present in them
      const ourIdx = activeNodes.findIndex(
        (node) => node.ip === network.ipInfo.externalIp && node.port === network.ipInfo.externalPort
      )
      if (ourIdx > -1) {
        activeNodes.splice(ourIdx, 1)
      }

      if (logFlags.p2pNonFatal) info('Attempting to sync to network...')
      synced = await Sync.sync(activeNodes)
    } catch (err) {
      synced = false
      warn(err)
      if (logFlags.p2pNonFatal) info('Trying again in 2 sec...')
      await utils.sleep(2000)
    }
  }
}

async function contactArchiver() {
  const availableArchivers = Context.config.p2p.existingArchivers
  const maxRetries = 3
  let retry = maxRetries
  const failArchivers: string[] = []
  let archiver: P2P.P2PTypes.Node
  let activeNodesSigned: SignedActiveNodesFromArchiver

  while (retry > 0) {
    try {
      archiver = getRandom(availableArchivers, 1)[0]
      if (!failArchivers.includes(archiver.ip)) failArchivers.push(archiver.ip)
      activeNodesSigned = await getActiveNodesFromArchiver(archiver)
      break // To stop this loop if it gets the response without failing
    } catch (e) {
      if (retry === 1) {
        throw Error(`Could not get seed list from seed node server ${failArchivers}`)
      }
    }
    retry--
  }

  // This probably cant happen but adding it for completeness
  if (activeNodesSigned == null || activeNodesSigned.nodeList == null) {
    throw Error(
      `Fatal: activeNodesSigned == null || activeNodesSigned.nodeList == null Archiver: ${archiver.ip}`
    )
  }

  if (activeNodesSigned.nodeList.length === 0) {
    throw new Error(
      `Fatal: getActiveNodesFromArchiver returned an empty list after ${
        maxRetries - retry
      } attempts from seed node servers ${failArchivers}`
    )
  }
  if (!Context.crypto.verify(activeNodesSigned, archiver.publicKey)) {
    info(`Got signed seed list: ${JSON.stringify(activeNodesSigned)}`)
    throw Error(
      `Fatal: _getSeedNodes seed list was not signed by archiver!. Archiver: ${archiver.ip}:${archiver.port}, signature: ${activeNodesSigned.sign}`
    )
  }

  const joinRequest: P2P.ArchiversTypes.Request | undefined = activeNodesSigned.joinRequest as
    | P2P.ArchiversTypes.Request
    | undefined
  if (joinRequest) {
    if (Archivers.addJoinRequest(joinRequest) === false) {
      throw Error('Fatal: _getSeedNodes archivers join request not accepted by us!')
    }
    if (Context.config.p2p.experimentalSnapshot && Context.config.features.archiverDataSubscriptionsUpdate) {
      const firstNodeDataRequest: any = {
        dataRequestCycle: activeNodesSigned.dataRequestCycle,
      }
      Archivers.addDataRecipient(joinRequest.nodeInfo, firstNodeDataRequest)
      // Using this flag due to isFirst check is not working as expected yet in the first consensor-archiver connection establishment
      allowConnectionToFirstNode = true
      return activeNodesSigned.nodeList
    }
  }
  const dataRequestCycle = activeNodesSigned.dataRequestCycle
  const dataRequestStateMetaData = activeNodesSigned.dataRequestStateMetaData

  const dataRequest = []
  if (dataRequestCycle) {
    dataRequest.push(dataRequestCycle)
  }
  if (dataRequestStateMetaData) {
    dataRequest.push(dataRequestStateMetaData)
  }
  if (joinRequest && dataRequest.length > 0) {
    Archivers.addDataRecipient(joinRequest.nodeInfo, dataRequest)
  }
  return activeNodesSigned.nodeList
}

function discoverNetwork(seedNodes: P2P.P2PTypes.Node[]) {
  // Check if we are first seed node
  const isFirstSeed = checkIfFirstSeedNode(seedNodes)
  if (!isFirstSeed) {
    if (logFlags.p2pNonFatal) info('You are not the first seed node...')
    return false
  }
  if (logFlags.p2pNonFatal) info('You are the first seed node!')
  return true
}

function checkIfFirstSeedNode(seedNodes: P2P.P2PTypes.Node[]) {
  if (!seedNodes.length) throw new Error('Fatal: No seed nodes in seed list!')
  if (seedNodes.length > 1) return false
  const seed = seedNodes[0]
  if (network.ipInfo.externalIp === seed.ip && network.ipInfo.externalPort === seed.port) {
    return true
  }
  return false
}

type SignedActiveNodesFromArchiver = P2P.P2PTypes.SignedObject & {
  nodeList: P2P.P2PTypes.Node[]
}

async function getActiveNodesFromArchiver(
  archiver: P2P.P2PTypes.Node
): Promise<SignedActiveNodesFromArchiver> {
  const nodeListUrl = `http://${archiver.ip}:${archiver.port}/nodelist`
  const nodeInfo = getPublicNodeInfo()
  let seedListSigned: P2P.P2PTypes.SignedObject & {
    nodeList: P2P.P2PTypes.Node[]
  }
  try {
    seedListSigned = await http.post(
      nodeListUrl,
      Context.crypto.sign({
        nodeInfo,
      }),
      false,
      10000
    )
  } catch (e) {
    nestedCountersInstance.countRareEvent(
      'archiver_nodelist',
      'Could not get seed list from seed node server'
    )
    warn(`Could not get seed list from seed node server ${nodeListUrl}: ` + e.message)
    throw Error(e.message)
  }
  if (logFlags.p2pNonFatal) info(`Got signed seed list: ${JSON.stringify(seedListSigned)}`)
  return seedListSigned
}

export async function getFullNodesFromArchiver() {
  const archiver = Context.config.p2p.existingArchivers[0]
  const nodeListUrl = `http://${archiver.ip}:${archiver.port}/full-nodelist`
  let fullNodeList
  try {
    fullNodeList = await http.get(nodeListUrl)
  } catch (e) {
    throw Error(`Fatal: Could not get seed list from seed node server ${nodeListUrl}: ` + e.message)
  }
  if (logFlags.p2pNonFatal) info(`Got signed full node list: ${JSON.stringify(fullNodeList)}`)
  return fullNodeList
}

//todo should move to p2p types
export type NodeInfo = {
  id: string
  publicKey: any
  curvePublicKey: string
} & network.IPInfo & {
    status: P2P.P2PTypes.NodeStatus
  }

export function getPublicNodeInfo(reportStandby = false): NodeInfo {
  const publicKey = Context.crypto.getPublicKey()
  const curvePublicKey = Context.crypto.convertPublicKeyToCurve(publicKey)
  const status = { status: getNodeStatus(publicKey, reportStandby) }
  const nodeInfo = Object.assign({ id, publicKey, curvePublicKey }, network.ipInfo, status)
  return nodeInfo
}

function getNodeStatus(pubKey: string, reportStandby = false) {
  const current = NodeList.byPubKey
  if (current.get(pubKey)) return current.get(pubKey).status
  return reportStandby ? NodeStatus.STANDBY : null
}

export function getThisNodeInfo() {
  const { externalIp, externalPort, internalIp, internalPort } = network.ipInfo
  const publicKey = Context.crypto.getPublicKey()
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
  if (logFlags.p2pNonFatal) info(`Node info of this node: ${JSON.stringify(nodeInfo)}`)
  return nodeInfo
}

export function setActive() {
  isActive = true
}

export function setp2pIgnoreJoinRequests(value: boolean) {
  p2pIgnoreJoinRequests = value
}

function info(...msg) {
  const entry = `Self: ${msg.join(' ')}`
  p2pLogger.info(entry)
}

function warn(...msg) {
  const entry = `Self: ${msg.join(' ')}`
  p2pLogger.warn(entry)
}

// debug functions
export function setIsFirst(val: boolean) {
  isFirst = val
}

export function getIsFirst() {
  return isFirst
}
