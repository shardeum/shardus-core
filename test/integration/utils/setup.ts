// shardus-core/test/integration/setup.ts
import * as crypto from '@shardus/crypto-utils'
import { NodeStatus } from '@shardus/types/build/src/p2p/P2PTypes'
import SHARDUS_CONFIG from '../../../src/config'
import * as http from '../../../src/http'
import Logger from '../../../src/logger'
import { NetworkClass } from '../../../src/network'
import * as Context from '../../../src/p2p/Context'
import { ShardusTypes } from '../../../src/shardus'
import Profiler from '../../../src/utils/profiler'

const defaultConfigs: ShardusTypes.StrictShardusConfiguration = SHARDUS_CONFIG
crypto.init('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')

interface NodeListResponse {
  nodeList: Array<{
    id: string
    ip: string
    port: number
    publicKey: string
  }>
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const getNodeDetails = async (host: string, port: string) => {
  try {
    // Try to get the info of the node
    const data = await http.get(`http://${host}:${port}/nodeInfo`)
    if (data !== null && typeof data === 'object') {
      const nodeinfo = data['nodeInfo']
      return nodeinfo
    } else {
      return null
    }
  } catch (e) {
    console.error('Node is not reachable')
    return null
  }
}

export async function setupTestEnvironment(): Promise<{
  dummyNode: ShardusTypes.Node
  targetNode: ShardusTypes.Node
  networkContext: NetworkClass
}> {
  const logger = new Logger(defaultConfigs.server.baseDir, defaultConfigs.logs, 'fatal')
  const networkContext = new NetworkClass(defaultConfigs.server, logger, undefined)

  // Fetch node list from the archiver endpoint
  const nodeListResponse = await http.get<NodeListResponse>('http://127.0.0.1:4000/nodelist')
  const nodeList = nodeListResponse.nodeList
  const randomNode = nodeList[Math.floor(Math.random() * nodeList.length)]

  // Generate random internal ports
  const internalPort = Math.floor(Math.random() * (65535 - 11001)) + 11001 // Random port above 11000
  const externalPort = Math.floor(Math.random() * (65535 - 9101)) + 9101 // Random port above 9100
  const keyPair = crypto.generateKeypair()

  networkContext.setup(
    {
      internalIp: '127.0.0.1',
      internalPort,
      externalIp: '127.0.0.1',
      externalPort,
    },
    keyPair.secretKey
  )

  new Profiler()
  Context.setNetworkContext(networkContext)
  Context.setConfig(defaultConfigs.server)
  const nodeIp = randomNode.ip.toString()
  const nodePort = randomNode.port.toString()
  const nodeInfo = (await getNodeDetails(nodeIp, nodePort)) as {
    id: string
    publicKey: string
    curvePublicKey: string
    externalIp: string
    externalPort: number
    internalIp: string
    internalPort: number
    status: string
    appData: {
      shardeumVersion: string
      minVersion: string
      activeVersion: string
      latestVersion: string
      operatorCLIVersion: string
      operatorGUIVersion: string
    }
  } | null

  if (!nodeInfo) {
    throw new Error('Could not get node info')
  }

  // Create a node object
  const dummyNode: ShardusTypes.Node = {
    publicKey: keyPair.publicKey,
    externalIp: '127.0.0.1',
    externalPort: 1337,
    internalIp: '127.0.0.1',
    internalPort: 1337,
    address: keyPair.publicKey,
    joinRequestTimestamp: Date.now(),
    activeTimestamp: Date.now(),
    curvePublicKey: keyPair.publicKey,
    status: NodeStatus.ACTIVE,
    cycleJoined: '',
    counterRefreshed: 0,
    id: crypto.hashObj({ publicKey: keyPair.publicKey, cycleMarker: 'madeupcyclemarker' }),
    syncingTimestamp: Date.now(),
    readyTimestamp: 0,
  }
  
  const targetNode: ShardusTypes.Node = {
    publicKey: nodeInfo.publicKey,
    externalIp: nodeInfo.externalIp,
    externalPort: nodeInfo.externalPort,
    internalIp: nodeInfo.internalIp,
    internalPort: nodeInfo.internalPort,
    address: nodeInfo.publicKey,
    joinRequestTimestamp: Date.now(),
    activeTimestamp: Date.now(),
    curvePublicKey: nodeInfo.curvePublicKey,
    status: NodeStatus.ACTIVE,
    cycleJoined: '',
    counterRefreshed: 0,
    id: nodeInfo.id,
    syncingTimestamp: Date.now(),
    readyTimestamp: 0,
  }

  return { dummyNode, networkContext, targetNode }
}
