import * as Active from '../p2p/Active'
import * as Comms from '../p2p/Comms'
import * as Context from '../p2p/Context'
import * as CycleCreator from '../p2p/CycleCreator'
import * as NodeList from '../p2p/NodeList'
import * as Self from '../p2p/Self'
import * as shardusTypes from '../shardus/shardus-types'
import ShardFunctions from '../state-manager/shardFunctions'
import * as shardFunctionTypes from '../state-manager/shardFunctionTypes'
import * as partitionGossip from './partition-gossip'
import { Handler } from 'express'
import { Route } from '../p2p/Types'
import { validateTypes } from '../utils'
import * as http from '../http'
import Shardus from '../shardus'

/** TYPES */
interface Account {
  accountId: string
  hash: string
}

type PartitionRanges = Map<
  shardFunctionTypes.AddressRange['partition'],
  shardFunctionTypes.AddressRange
>

type PartitionAccounts = Map<
  shardFunctionTypes.AddressRange['partition'],
  Account[]
>

export type PartitionHashes = Map<
  shardFunctionTypes.AddressRange['partition'],
  string
>

type NetworkStateHash = string

/** STATE */

let oldDataPath: string

/** FUNCTIONS */

export function setOldDataPath(path) {
  oldDataPath = path
  log('set old-data-path', oldDataPath)
}

export function startSnapshotting() {
  partitionGossip.initGossip()
  Context.stateManager.on(
    'cycleTxsFinalized',
    async (shard: CycleShardData) => {
      // 1) create our own partition hashes for that cycle number
      const partitionRanges = getPartitionRanges(shard)
      const partitionHashes = new Map()
      for (const partition of shard.ourStoredPartitions) {
        const range = partitionRanges.get(partition)
        if (range) {
          const accountsInPartition = await Context.storage.getAccountCopiesByCycleAndRange(
            shard.cycleNumber,
            range.low,
            range.high
          )
          const hash = Context.crypto.hash(accountsInPartition)
          partitionHashes.set(partition, hash)
        }
      }

      // 2) process gossip from the queue for that cycle number
      const collector = partitionGossip.newCollector(shard)

      // 3) gossip our partitition hashes to the rest of the network with that cycle number
      const message: partitionGossip.Message = {
        cycle: shard.cycleNumber,
        data: {},
      }
      for (const [partitionId, hash] of partitionHashes) {
        message.data[partitionId] = hash
      }
      collector.process([message])
      Comms.sendGossip('snapshot_gossip', message)

      collector.once('gotAllHashes', (allHashes: PartitionHashes) => {
        // 4) create a network state hash once we have all partition hashes for that cycle number
        const networkStateHash = createNetworkStateHash(allHashes)

        // 5) save the partition and network hashes for that cycle number to the DB
        savePartitionAndNetworkHashes(shard, allHashes, networkStateHash)

        // 6) clean up gossip and collector for that cycle number
        partitionGossip.clean(shard.cycleNumber)
        console.log(
          `Network Hash for cycle ${shard.cycleNumber}`,
          networkStateHash
        )
      })
    }
  )
}

export async function readOldCycleRecord() {
  const oldCycles = await Context.storage.listOldCycles()
  if (oldCycles && oldCycles.length > 0) return oldCycles[0]
}

export async function readOldNetworkHash() {
  const networkStateHash = await Context.storage.getLastOldNetworkHash()
  console.log('Read Old network state hash', networkStateHash)
  if (networkStateHash && networkStateHash.length > 0)
    return networkStateHash[0]
}

export async function initSafetyModeVals() {
  let safetyMode = false
  let safetyNum = 0
  let networkStateHash = ''

  // If old data exists, set safety mode vals
  if (oldDataPath) {
    const oldCycleRecord = await readOldCycleRecord()
    const oldNetworkHash = await readOldNetworkHash()

    // Turn safety node on
    safetyMode = true

    // Set the safetyNum to the number of active nodes in the last cycle saved in the old data
    safetyNum = oldCycleRecord ? oldCycleRecord.active : 0

    // Set networkStateHash to the last network state hash saved in the old data
    networkStateHash = oldNetworkHash
  }

  return {
    safetyMode,
    safetyNum,
    networkStateHash,
  }
}

export async function safetySync() {
  /**
   * [NOTE] For safety sync to complete, >= safetyNum # of nodes must go
   * active.
   *
   * [NOTE] For a node to go active when the network is in safety mode, it
   * must get the old partition(s) data it is responsible for and put it back
   * into state-manager
   *
   *                OLD NETWORK:
   *
   *               P1   P2   P3   P4   P5   P6
   * Partitions: |----|----|----|----|----|----|
   * Active    :   N0   N1   N2   N3   N4   N5
   *
   *          NEW NETWORK (SAFETY MODE):
   *
   *               P1   P2   P3   P4   P5   P6
   * Partitions: |----|----|----|----|----|----|
   * Active    :                  N0
   * Syncing   :   N3
   * Joining   :        N5   N2        N1   N4
   */
  /**
   * [NOTE] At this point in our nodes lifecycle, it has joined the network,
   * synced the nodelist, and has a node Id.
   *
   * The safetyNum from the cycle chain === the num of partitions there were
   * in the old network. We can divide the address space by this num and
   * figure out which old partition/s our node Id is responsible for.
   *
   * Once we know our nodes old partition/s, we must get the data for those
   * partitions and pass it to state-manager before we can go active.
   *
   * First, we should look for it in any old data we had when we started.
   * Who knows, we might get lucky ;).
   *
   */
  /**
   * Once we receive our old data and put it into state-manager, go active with
   * P2P/Active's requestActive:
   */

  // Register snapshot routes
  registerSnapshotRoutes()

  // Wait until safetyNum of nodes have joined the network
  let safetyNum: number

  await new Promise((resolve) => {
    Self.emitter.on('new_cycle_data', (data: CycleCreator.CycleData) => {
      if (data.syncing >= data.safetyNum) {
        safetyNum = data.safetyNum
        resolve()
      }
    })
  })

  // [TODO] Figure out which nodes hold which partitions in the new network
  const shardGlobals = ShardFunctions.calculateShardGlobals(
    safetyNum,
    Context.config.sharding.nodesPerConsensusGroup,
    Context.config.sharding.nodesPerConsensusGroup
  )

  const partitionShardDataMap: shardFunctionTypes.ParititionShardDataMap = new Map()
  ShardFunctions.computePartitionShardDataMap(
    shardGlobals,
    partitionShardDataMap,
    0,
    shardGlobals.numPartitions
  )

  const nodeShardDataMap: shardFunctionTypes.NodeShardDataMap = new Map()
 
  /**
   * [NOTE] [AS] Need to do this because type of 'cycleJoined' field differs
   * between ShardusTypes.Node (number) and P2P/NodeList.Node (string)
   */
  const nodes = (NodeList.byIdOrder as unknown) as shardusTypes.Node[]

  ShardFunctions.computeNodePartitionDataMap(
    shardGlobals,
    nodeShardDataMap,
    nodes,
    partitionShardDataMap,
    nodes,
    false
  )
  
  // [TODO] If you have old data, figure out which partitions you have
  const oldDataMap = new Map()
  for (const [partitionId, partitonObj] of partitionShardDataMap) {
    const lowAddress = partitonObj.homeRange.low
    const highAddress = partitonObj.homeRange.high

    const oldAccountCopiesInPartition = await Context.storage.getOldAccountCopiesByCycleAndRange(lowAddress, highAddress)

    if (oldAccountCopiesInPartition && oldAccountCopiesInPartition.length > 0) {
      oldDataMap.set(partitionId, oldAccountCopiesInPartition)
    }
  }
  
  // Send the old data you have to the new node/s responsible for it
  for (const [partitionId, oldAccountCopies] of oldDataMap) {
    await sendOldDataToNodes(partitionId, oldAccountCopies, nodeShardDataMap)
  }

  // [TODO] Once you get the old data you need, go active
  Active.requestActive()
}

async function sendOldDataToNodes(partitionId: number, oldAccountCopies: any[], nodeShardDataMap: shardFunctionTypes.NodeShardDataMap) {
  const nodesToSendData: shardusTypes.Node[] = getNodesInPartition(partitionId, nodeShardDataMap)
  for (let i=0; i < nodesToSendData.length; i++) {
    await http.post(`${nodesToSendData[i].externalIp}:${nodesToSendData[i].externalPort}/snapshot-data`, oldAccountCopies)
  }
}

function getNodesInPartition(partitionId, nodeShardDataMap: shardFunctionTypes.NodeShardDataMap): shardusTypes.Node[] {
  let nodesInPartition: shardusTypes.Node[] = []
  nodeShardDataMap.forEach((data, nodeId) => {
    if (data.homePartition === partitionId) {
      nodesInPartition.push(data.node)
    }
  })
  return nodesInPartition
}

function createNetworkStateHash(
  partitionHashes: PartitionHashes
): NetworkStateHash {
  let partitionHashArray = []
  for (const [, hash] of partitionHashes) {
    partitionHashArray.push(hash)
  }
  partitionHashArray = partitionHashArray.sort()
  const hash = Context.crypto.hash(partitionHashArray)
  return hash
}

function getPartitionRanges(shard: CycleShardData): PartitionRanges {
  const partitionRanges = new Map()

  for (const partition of shard.ourStoredPartitions) {
    partitionRanges.set(
      partition,
      ShardFunctions.partitionToAddressRange2(shard.shardGlobals, partition)
    )
  }

  return partitionRanges
}

async function savePartitionAndNetworkHashes(
  shard: CycleShardData,
  partitionHashes: PartitionHashes,
  networkHash: NetworkStateHash
) {
  for (const [partitionId, hash] of partitionHashes) {
    await Context.storage.addPartitionHash({
      partitionId,
      cycleNumber: shard.cycleNumber,
      hash,
    })
  }
  await Context.storage.addNetworkState({
    cycleNumber: shard.cycleNumber,
    hash: networkHash,
  })
}


function registerSnapshotRoutes() {
  const snapshotRoute: Route<Handler> = {
    method: 'POST',
    name: 'snapshot-data',
    handler: (req, res) => {
      let err = validateTypes(req, { body: 'o' })
      if (err) {
        console.log('snapshot-data bad req ' + err)
        res.json([])
        return
      }
      // [TODO] check and store offered data
      res.json({success: true})
    },
  }
  Context.network._registerExternal(snapshotRoute.method, snapshotRoute.name, snapshotRoute.handler)
}

function log(...things) {
  console.log('DBG', 'SNAPSHOT', ...things)
}
