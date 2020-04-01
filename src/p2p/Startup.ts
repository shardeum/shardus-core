import * as http from '../http'
import * as utils from '../utils'
import { p2p } from './Context'
import { sync } from './Sync'
import { Node, NodeInfo } from './Types'

/** STATE */

/** ROUTES */

export const internalRoutes = [
  {
    name: 'cyclechainhash',
    handler: async (payload, respond) => {
      if (!payload) {
        p2p.mainLogger.debug(
          'No payload provided with `cyclechainhash` request.'
        )
        await respond({
          cycleChainHash: null,
          error: 'no payload; start and end cycle required',
        })
        return
      }
      p2p.mainLogger.debug(
        `Payload of request on 'cyclechainhash': ${JSON.stringify(payload)}`
      )
      if (payload.start === undefined || payload.end === undefined) {
        p2p.mainLogger.debug(
          'Start and end for the `cyclechainhash` request were not both provided.'
        )
        await respond({
          cycleChainHash: null,
          error: 'start and end required',
        })
        return
      }
      const cycleChainHash = getCycleChainHash(payload.start, payload.end)
      p2p.mainLogger.debug(
        `Cycle chain hash to be sent: ${JSON.stringify(cycleChainHash)}`
      )
      if (!cycleChainHash) {
        await respond({
          cycleChainHash,
          error: 'invalid indexes for cycle chain hash',
        })
        return
      }
      await respond({ cycleChainHash })
    },
  },
]

function getCycleChainHash(start, end) {
  p2p.mainLogger.debug(
    `Requested hash of cycle chain from cycle ${start} to ${end}...`
  )
  let cycleChain
  try {
    cycleChain = p2p.getCycleChain(start, end)
  } catch (e) {
    return null
  }
  const hash = p2p.crypto.hash({ cycleChain })
  p2p.mainLogger.debug(`Hash of requested cycle chain: ${hash}`)
  return hash
}

/** FUNCTIONS */

export async function startup(): Promise<boolean> {
  // Emit the 'joining' event before attempting to join
  const publicKey = p2p.crypto.getPublicKey()
  p2p.mainLogger.debug('Emitting `joining` event.')
  p2p.emit('joining', publicKey)

  // Get new activeNodes and attempt to join until you are successful
  let activeNodes: Node[]
  let joined = false
  // outerJoinAttemps is set to a high number incase we want to build a large network and need the node to keep trying to join for awhile.
  let ourIpInfo
  while (!joined) {
    try {
      p2p.mainLogger.info(
        'Getting activeNodes from archiver to join network...'
      )
      activeNodes = await contactArchiver()
      p2p.mainLogger.info('Discovering if we are the first node...')
      p2p.isFirstSeed = await discoverNetwork(activeNodes)

      // Remove yourself from seedNodes if you are present in them but not firstSeed
      ourIpInfo = p2p.getIpInfo()
      if (p2p.isFirstSeed === false) {
        const ourIdx = activeNodes.findIndex(
          (node: { ip: any; port: any }) =>
            node.ip === ourIpInfo.externalIp &&
            node.port === ourIpInfo.externalPort
        )
        if (ourIdx > -1) {
          activeNodes.splice(ourIdx, 1)
        }
      }

      p2p.mainLogger.info('Attempting to join network...')
      joined = await joinNetwork(activeNodes)
    } catch (err) {
      joined = false
      p2p.mainLogger.error(err)
      p2p.mainLogger.info('Trying again in 2 sec...')
      await utils.sleep(2000)
    }
  }

  // Emit the 'joined' event before attempting to sync to the network
  p2p.mainLogger.debug('Emitting `joined` event.')
  p2p.emit('joined', p2p.id, publicKey)

  // Get new activeNodes and attempt to sync until you are successful
  let synced = false
  while (!synced) {
    // Once joined, sync to the network
    try {
      p2p.mainLogger.info(
        'Getting activeNodes from archiver to sync to network...'
      )
      activeNodes = await contactArchiver()

      // Remove yourself from seedNodes if you are present in them but not firstSeed
      ourIpInfo = p2p.getIpInfo()
      if (p2p.isFirstSeed === false) {
        const ourIdx = activeNodes.findIndex(
          (node: { ip: any; port: any }) =>
            node.ip === ourIpInfo.externalIp &&
            node.port === ourIpInfo.externalPort
        )
        if (ourIdx > -1) {
          activeNodes.splice(ourIdx, 1)
        }
      }

      p2p.mainLogger.info('Attempting to sync to network...')
      synced = await sync(activeNodes)
    } catch (err) {
      synced = false
      p2p.mainLogger.error(err)
      p2p.mainLogger.info('Trying again in 2 sec...')
      await utils.sleep(2000)
    }
  }

  p2p.emit('initialized')
  return true
}

async function contactArchiver() {
  const archiver: Node = p2p.existingArchivers[0]
  const activeNodesSigned = await getActiveNodesFromArchiver()
  if (!p2p.crypto.verify(activeNodesSigned, archiver.publicKey)) {
    throw Error('Fatal: _getSeedNodes seed list was not signed by archiver!')
  }
  const joinRequest = activeNodesSigned.joinRequest
  if (joinRequest) {
    if (p2p.archivers.addJoinRequest(joinRequest) === false) {
      throw Error(
        'Fatal: _getSeedNodes archivers join request not accepted by us!'
      )
    }
  }
  const dataRequest = activeNodesSigned.dataRequest
  if (dataRequest) {
    p2p.archivers.addDataRecipient(joinRequest.nodeInfo, dataRequest)
  }
  return activeNodesSigned.nodeList
}

async function discoverNetwork(seedNodes) {
  // Check if our time is synced to network time server
  try {
    const timeSynced = await p2p._checkTimeSynced(p2p.timeServers)
    if (!timeSynced) {
      p2p.mainLogger.warn('Local time out of sync with time server.')
    }
  } catch (e) {
    p2p.mainLogger.warn(e.message)
  }

  // Check if we are first seed node
  const isFirstSeed = p2p._checkIfFirstSeedNode(seedNodes)
  if (!isFirstSeed) {
    p2p.mainLogger.info('You are not the first seed node...')
    return false
  }
  p2p.mainLogger.info('You are the first seed node!')
  return true
}

async function joinNetwork(seedNodes) {
  p2p.mainLogger.debug('Clearing P2P state...')
  await p2p.state.clear()

  // Sets our IPs and ports for internal and external network in the database
  await p2p.storage.setProperty('externalIp', p2p.getIpInfo().externalIp)
  await p2p.storage.setProperty('externalPort', p2p.getIpInfo().externalPort)
  await p2p.storage.setProperty('internalIp', p2p.getIpInfo().internalIp)
  await p2p.storage.setProperty('internalPort', p2p.getIpInfo().internalPort)

  if (p2p.isFirstSeed) {
    p2p.mainLogger.debug('Joining network...')

    // context is for testing purposes
    console.log('Doing initial setup for server...')

    const cycleMarker = p2p.state.getCurrentCycleMarker()
    const joinRequest = await p2p._createJoinRequest(cycleMarker)
    p2p.state.startCycles()
    p2p.state.addNewJoinRequest(joinRequest)

    // Sleep for cycle duration before updating status
    // TODO: Make context more deterministic
    await utils.sleep(Math.ceil(p2p.state.getCurrentCycleDuration() / 2) * 1000)
    // const { nextCycleMarker } = p2p.getCycleMarkerInfo();
    const prevCycleMarker = p2p.state.getPreviousCycleMarker()
    p2p.mainLogger.debug(`Public key: ${joinRequest.nodeInfo.publicKey}`)
    p2p.mainLogger.debug(`Prev cycle marker: ${prevCycleMarker}`)
    const nodeId = p2p.state.computeNodeId(
      joinRequest.nodeInfo.publicKey,
      prevCycleMarker
    )
    p2p.mainLogger.debug(
      `Computed node ID to be set for context node: ${nodeId}`
    )
    await p2p._setNodeId(nodeId)

    return true
  }

  const nodeId = await p2p._join(seedNodes)
  if (!nodeId) {
    p2p.mainLogger.info('Unable to join network')
    return false
  }
  p2p.mainLogger.info('Successfully joined the network!')
  await p2p._setNodeId(nodeId)
  return true
}

/** HELPER FUNCTIONS */

async function getActiveNodesFromArchiver() {
  const archiver = p2p.existingArchivers[0]
  const nodeListUrl = `http://${archiver.ip}:${archiver.port}/nodelist`
  const nodeInfo = p2p.getPublicNodeInfo()
  const { nextCycleMarker: firstCycleMarker } = p2p.getCycleMarkerInfo()
  let seedListSigned
  try {
    seedListSigned = await http.post(nodeListUrl, {
      nodeInfo,
      firstCycleMarker,
    })
  } catch (e) {
    throw Error(
      `Fatal: Could not get seed list from seed node server ${nodeListUrl}: ` +
        e.message
    )
  }
  p2p.mainLogger.debug(
    `Got signed seed list: ${JSON.stringify(seedListSigned)}`
  )
  return seedListSigned
}

export async function fetchNodeInfo(activeNodes: Node[]) {
  const getNodeinfo = async (node: Node) => {
    const { nodeInfo }: { nodeInfo: NodeInfo } = await http.get(
      `${node.ip}:${node.port}/nodeinfo`
    )
    return nodeInfo
  }
  const promises = activeNodes.map(node => getNodeinfo(node))
  return utils.robustPromiseAll(promises)
}
