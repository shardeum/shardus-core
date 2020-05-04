import Sntp from '@hapi/sntp'
import { EventEmitter } from 'events'
import { Logger } from 'log4js'
import * as http from '../http'
import { ipInfo } from '../network'
import * as utils from '../utils'
import * as Archivers from './Archivers'
import * as Comms from './Comms'
import { config, crypto, logger } from './Context'
import * as CycleCreator from './CycleCreator'
import * as GlobalAccounts from './GlobalAccounts'
import * as Join from './Join'
import * as NodeList from './NodeList'
import * as Sync from './Sync'
import { sync } from './Sync'
import { Node } from './Types'

/** STATE */

export const emitter = new EventEmitter()

let p2pLogger: Logger

export let id: string
export let isFirst: boolean
export let isActive = false

/** ROUTES */

/** FUNCTIONS */

export function init() {
  // Init submodules
  Comms.init()
  Archivers.init()
  Sync.init()
  CycleCreator.init()
  GlobalAccounts.init()

  // Create a logger for yourself
  p2pLogger = logger.getLogger('p2p')
}

export async function startup(): Promise<boolean> {
  // Emit the 'joining' event before attempting to join
  const publicKey = crypto.getPublicKey()
  p2pLogger.debug('Emitting `joining` event.')
  emitter.emit('joining', publicKey)

  // Get new activeNodes and attempt to join until you are successful
  let activeNodes: Node[]
  let joined = false

  const retryWait = async (time = 0) => {
    let wait = time - Date.now()
    if (wait <= 0 || wait > config.p2p.cycleDuration * 1000 * 2) {
      wait = (config.p2p.cycleDuration * 1000) / 2
    }
    p2pLogger.info(`Trying again in ${wait / 1000} sec...`)
    await utils.sleep(wait)
  }

  while (!joined) {
    try {
      p2pLogger.info('Getting activeNodes from archiver to join network...')
      activeNodes = await contactArchiver()
      p2pLogger.info('Discovering if we are the first node...')
      isFirst = await discoverNetwork(activeNodes)

      // Remove yourself from activeNodes if you are present in them but not firstSeed
      if (isFirst === false) {
        const ourIdx = activeNodes.findIndex(
          node =>
            node.ip === ipInfo.externalIp && node.port === ipInfo.externalPort
        )
        if (ourIdx > -1) {
          activeNodes.splice(ourIdx, 1)
        }
      }

      p2pLogger.info('Attempting to join network...')
      const joinRes = await joinNetwork(activeNodes)
      joined = joinRes[0]
      const tryAgain = joinRes[1]
      if (!joined) {
        p2pLogger.info('Join request not accepted')
        await retryWait(tryAgain)
      }
    } catch (err) {
      joined = false
      p2pLogger.error(err)
      await retryWait()
    }
  }

  // Emit the 'joined' event before attempting to sync to the network
  p2pLogger.debug('Emitting `joined` event.')
  emitter.emit('joined', id, publicKey)

  // If not first, get new activeNodes and attempt to sync until you are successful
  if (!isFirst) {
    let synced = false
    while (!synced) {
      // Once joined, sync to the network
      try {
        p2pLogger.info(
          'Getting activeNodes from archiver to sync to network...'
        )
        activeNodes = await contactArchiver()

        // Remove yourself from activeNodes if you are present in them
        const ourIdx = activeNodes.findIndex(
          node =>
            node.ip === ipInfo.externalIp && node.port === ipInfo.externalPort
        )
        if (ourIdx > -1) {
          activeNodes.splice(ourIdx, 1)
        }

        p2pLogger.info('Attempting to sync to network...')
        synced = await sync(activeNodes)
      } catch (err) {
        synced = false
        p2pLogger.error(err)
        p2pLogger.info('Trying again in 2 sec...')
        await utils.sleep(2000)
      }
    }
  }

  // Enable internal routes
  Comms.setAcceptInternal(true)

  // Start creating cycle records
  await CycleCreator.startCycles()
  emitter.emit('initialized')
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
      p2pLogger.warn('Local time out of sync with time server.')
    }
  } catch (e) {
    p2pLogger.warn(e.message)
  }

  // Check if we are first seed node
  const isFirstSeed = checkIfFirstSeedNode(seedNodes)
  if (!isFirstSeed) {
    p2pLogger.info('You are not the first seed node...')
    return false
  }
  p2pLogger.info('You are the first seed node!')
  return true
}

async function joinNetwork(activeNodes): Promise<[boolean, number]> {
  p2pLogger.debug('Tryting to join network...')

  if (isFirst) {
    // Create the first join request and set our node id
    id = await Join.firstJoin()
    return [true, 0]
  } else {
    // Create join request from network cycle marker
    const netMarker = await Join.fetchCycleMarker(activeNodes)
    const request = await Join.createJoinRequest(netMarker)

    // Submit join request to active nodes
    // [TODO] validate tryAgain
    const tryAgain = await Join.submitJoin(activeNodes, request)

    if (tryAgain) {
// [TODO] - see why logs never show Told to wait message
      p2pLogger.debug(`Told to wait until ${tryAgain}`)
      return [false, tryAgain]
    } else {
      // Wait 1 cycle duration
      await utils.sleep(config.p2p.cycleDuration * 1000 + 500)

      // Check if accepted and set our node ID
      id = await Join.fetchJoined(activeNodes)

      if (!id) {
        return [false, 0]
      } else {
        return [true, 0]
      }
    }
  }
}

/** HELPER FUNCTIONS */

export async function checkTimeSynced(timeServers) {
  for (const host of timeServers) {
    try {
      const time = await Sntp.time({
        host,
        timeout: 10000,
      })
      return time.t <= config.p2p.syncLimit
    } catch (e) {
      p2pLogger.warn(`Couldn't fetch ntp time from server at ${host}`)
    }
  }
  throw Error('Unable to check local time against time servers.')
}

function checkIfFirstSeedNode(seedNodes) {
  if (!seedNodes.length) throw new Error('Fatal: No seed nodes in seed list!')
  if (seedNodes.length > 1) return false
  const seed = seedNodes[0]
  if (ipInfo.externalIp === seed.ip && ipInfo.externalPort === seed.port) {
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
  p2pLogger.debug(`Got signed seed list: ${JSON.stringify(seedListSigned)}`)
  return seedListSigned
}

function getPublicNodeInfo() {
  const publicKey = crypto.getPublicKey()
  const curvePublicKey = crypto.convertPublicKeyToCurve(publicKey)
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

export function getThisNodeInfo() {
  const { externalIp, externalPort, internalIp, internalPort } = ipInfo
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
  p2pLogger.debug(`Node info of this node: ${JSON.stringify(nodeInfo)}`)
  return nodeInfo
}

export function setActive() {
  isActive = true
}
