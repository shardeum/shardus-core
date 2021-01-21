import Sntp from '@hapi/sntp'
import * as events from 'events'
import * as log4js from 'log4js'
import got from 'got'
import * as http from '../http'
import * as network from '../network'
import * as snapshot from '../snapshot'
import * as utils from '../utils'
import * as Archivers from './Archivers'
import * as Comms from './Comms'
import * as Context from './Context'
import * as CycleCreator from './CycleCreator'
import * as GlobalAccounts from './GlobalAccounts'
import * as Join from './Join'
import * as NodeList from './NodeList'
import * as Sync from './Sync'
import * as Types from './Types'
import { readOldCycleRecord } from '../snapshot/snapshotFunctions'

/** TYPES */

interface JoinOrWitnessResult {
  outcome: 'joined' | 'witness' | 'tryAgain'
  wait: number
  isFirst: boolean
  id?: string
}

/** STATE */

export const emitter = new events.EventEmitter()

let p2pLogger: log4js.Logger

export let id: string
export let isFirst: boolean
export let isActive = false
export let ip: string
export let port: number

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

  // Create a logger for yourself
  p2pLogger = Context.logger.getLogger('p2p')
}

export async function startup(): Promise<boolean> {
  const publicKey = Context.crypto.getPublicKey()

  info('Emitting `joining` event.')
  emitter.emit('joining', publicKey)

  // Contact the network and decide to join/witness for it until successful
  const retryWait = async (time = 0) => {
    let wait = time - Date.now()
    if (wait <= 0 || wait > Context.config.p2p.cycleDuration * 1000 * 2) {
      wait = (Context.config.p2p.cycleDuration * 1000) / 2
    }
    info(`Trying to join/witness again in ${wait / 1000} seconds...`)
    await utils.sleep(wait)
  }

  let firstTime = true
  let result
  do {
    try {
      result = await joinOrWitnessForNetwork(firstTime)
      if (result.outcome === 'tryAgain') {
        await retryWait(result.wait)
      }
    } catch (err) {
      warn('Error while joining/witnessing for network:')
      warn(err)
      warn(err.stack)
      info('Trying to join/witness again in 2 seconds...')
      await utils.sleep(2000)
    }
    firstTime = false
  } while (!result || result.outcome === 'tryAgain')

  // Set node id and isFirst
  id = result.id || ''
  isFirst = result.isFirst

  // Either become a witness or join the network
  switch (result.outcome) {
    case 'witness': {
      info('Emitting `witness` event.')
      emitter.emit('witness', publicKey)
      break
    }
    case 'joined': {
      info('Emitting `joined` event.')
      emitter.emit('joined', id, publicKey)

      // Sync cycle chain from network
      await syncCycleChain()

      // Enable internal routes
      Comms.setAcceptInternal(true)

      // Start creating cycle records
      await CycleCreator.startCycles()
      info('Emitting `initialized` event.')
      emitter.emit('initialized')
    }
  }

  return true
}

async function joinOrWitnessForNetwork(firstTime:Boolean): Promise<JoinOrWitnessResult> {
  // Get active nodes from Archiver
  const activeNodes = await contactArchiver()

  // Check if you're the first node
  const isFirst = await discoverNetwork(activeNodes)

  // Remove yourself from activeNodes if you are present in them
  const ourIdx = activeNodes.findIndex(
    (node) =>
      node.ip === network.ipInfo.externalIp &&
      node.port === network.ipInfo.externalPort
  )
  if (ourIdx > -1) {
    activeNodes.splice(ourIdx, 1)
  }

  if (isFirst) {
    // Join your own network and give yourself an ID
    const id = await Join.firstJoin()

    // Return joined
    return {
      outcome: 'joined',
      wait: 0,
      isFirst,
      id,
    }
  }

  // Get latest cycle record from active nodes
  const latestCycle = await Sync.getNewestCycle(activeNodes)

  // Become a witness if we have old data and network conditions are right
  if (snapshot.oldDataPath) {
    const oldDataCycleRecord = await readOldCycleRecord()
    const oldDataNetworkId = oldDataCycleRecord.networkId
    if (latestCycle.safetyMode && oldDataNetworkId === latestCycle.networkId) {
      // Return witness
      return {
        outcome: 'witness',
        wait: 0,
        isFirst,
        id: undefined,
      }
    }
  }

  // If this is not the first time to attempt joining, then go ahead and do the joined robust query first
  // This is because the loops that tests join may early out
  if(firstTime === false){
    // Check if joined by trying to set our node ID
    const id = await Join.fetchJoined(activeNodes)
    if (id) {
      return {
        outcome: 'joined',
        wait: 0,
        isFirst,
        id,
      }
    }
  }

  // Create join request from latest cycle
  const request = await Join.createJoinRequest(latestCycle.previous)

  // [TODO] [AS] Have the joiner figure out when Q1 is from the latestCycle

  // Submit join request to active nodes
  const tryAgain = await Join.submitJoin(activeNodes, request)
  if (tryAgain && tryAgain < Date.now() + Context.config.p2p.cycleDuration * 1000 * 2) {
    return {
      outcome: 'tryAgain',
      wait: tryAgain,
      isFirst,
      id: undefined,
    }
  }

  // Wait approx. one cycle
  await utils.sleep(Context.config.p2p.cycleDuration * 1000 + 500)

  // [TODO] [AS] Check if you've already joined the network before trying to send join requests again
  if (firstTime === true) {
    // Check if joined by trying to set our node ID
    const id = await Join.fetchJoined(activeNodes)
    if (id) {
      return {
        outcome: 'joined',
        wait: 0,
        isFirst,
        id,
      }
    }
  }

  // Otherwise, try again in approx. one cycle
  return {
    outcome: 'tryAgain',
    wait: Date.now() + Context.config.p2p.cycleDuration * 1000 + 500,
    isFirst,
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
      info('Getting activeNodes from archiver to sync to network...')
      const activeNodes = await contactArchiver()

      // Remove yourself from activeNodes if you are present in them
      const ourIdx = activeNodes.findIndex(
        (node) =>
          node.ip === network.ipInfo.externalIp &&
          node.port === network.ipInfo.externalPort
      )
      if (ourIdx > -1) {
        activeNodes.splice(ourIdx, 1)
      }

      info('Attempting to sync to network...')
      synced = await Sync.sync(activeNodes)
    } catch (err) {
      synced = false
      warn(err)
      info('Trying again in 2 sec...')
      await utils.sleep(2000)
    }
  }
}

async function contactArchiver() {
  const archiver: Types.Node = Context.config.p2p.existingArchivers[0]
  const activeNodesSigned = await getActiveNodesFromArchiver()
  if (!Context.crypto.verify(activeNodesSigned, archiver.publicKey)) {
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
  const dataRequestCycle = activeNodesSigned.dataRequestCycle
  const dataRequestStateMetaData = activeNodesSigned.dataRequestStateMetaData

  const dataRequest = []
  if (dataRequestCycle) {
    dataRequest.push(dataRequestCycle)
  }
  if (dataRequestStateMetaData) {
    dataRequest.push(dataRequestStateMetaData)
  }
  if (dataRequest.length > 0) {
    Archivers.addDataRecipient(joinRequest.nodeInfo, dataRequest)
  }
  return activeNodesSigned.nodeList
}

async function discoverNetwork(seedNodes) {
  // Check if our time is synced to network time server
  try {
    // [TODO] - sometimes this fails due to the timeServers being off
    //          try another backup method like Omar's timediff script
    const timeSynced = await checkTimeSynced(Context.config.p2p.timeServers)
    if (!timeSynced) {
      warn(
        'Local time out of sync with time server. Use NTP to keep system time in sync.'
      )
    }
  } catch (e) {
    warn(e.message)
  }

  // Check if we are first seed node
  const isFirstSeed = checkIfFirstSeedNode(seedNodes)
  if (!isFirstSeed) {
    info('You are not the first seed node...')
    return false
  }
  info('You are the first seed node!')
  return true
}

/** HELPER FUNCTIONS */

async function calculateTimeDifference () {
    const response: any = await got.get('https://google.com')
    const localTime = Date.now()
    const googleTime = Date.parse(response.headers.date)
    const timeDiff = Math.abs(localTime - googleTime)
    info('googleTime', googleTime)
    info('localTime', localTime)
    info('Time diff between google.com and local machine', timeDiff)
    return timeDiff
}

export async function checkTimeSynced(timeServers) {
  for (const host of timeServers) {
    try {
      const time = await Sntp.time({
        host,
        timeout: 10000,
      })
      return time.t <= Context.config.p2p.syncLimit
    } catch (e) {
      warn(`Couldn't fetch ntp time from server at ${host}`)
    }
  }
  try {
    const localTimeDiff = await calculateTimeDifference()
    return localTimeDiff <= Context.config.p2p.syncLimit * 1000
  } catch(e) {
    warn('local time is out of sync with google time server')
  }
  throw Error('Unable to check local time against time servers.')
}

function checkIfFirstSeedNode(seedNodes) {
  if (!seedNodes.length) throw new Error('Fatal: No seed nodes in seed list!')
  if (seedNodes.length > 1) return false
  const seed = seedNodes[0]
  if (
    network.ipInfo.externalIp === seed.ip &&
    network.ipInfo.externalPort === seed.port
  ) {
    return true
  }
  return false
}

async function getActiveNodesFromArchiver() {
  const archiver = Context.config.p2p.existingArchivers[0]
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
  info(`Got signed seed list: ${JSON.stringify(seedListSigned)}`)
  return seedListSigned
}

export async function getFullNodesFromArchiver() {
  const archiver = Context.config.p2p.existingArchivers[0]
  const nodeListUrl = `http://${archiver.ip}:${archiver.port}/full-nodelist`
  let fullNodeList
  try {
    fullNodeList = await http.get(nodeListUrl)
  } catch (e) {
    throw Error(
      `Fatal: Could not get seed list from seed node server ${nodeListUrl}: ` +
        e.message
    )
  }
  info(`Got signed full node list: ${JSON.stringify(fullNodeList)}`)
  return fullNodeList
}

function getPublicNodeInfo() {
  const publicKey = Context.crypto.getPublicKey()
  const curvePublicKey = Context.crypto.convertPublicKeyToCurve(publicKey)
  const status = { status: getNodeStatus(id) }
  const nodeInfo = Object.assign(
    { id, publicKey, curvePublicKey },
    network.ipInfo,
    status
  )
  return nodeInfo
}

function getNodeStatus(nodeId) {
  const current = NodeList.activeByIdOrder
  if (!current[nodeId]) return null
  return current[nodeId].status
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
  info(`Node info of this node: ${JSON.stringify(nodeInfo)}`)
  return nodeInfo
}

export function setActive() {
  isActive = true
}

function info(...msg) {
  const entry = `Self: ${msg.join(' ')}`
  p2pLogger.info(entry)
}

function warn(...msg) {
  const entry = `Self: ${msg.join(' ')}`
  p2pLogger.warn(entry)
}
