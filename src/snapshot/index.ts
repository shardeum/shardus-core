import { Handler } from 'express'
import * as http from '../http'
import * as Active from '../p2p/Active'
import * as Comms from '../p2p/Comms'
import * as Context from '../p2p/Context'
import * as CycleCreator from '../p2p/CycleCreator'
import * as NodeList from '../p2p/NodeList'
import * as Self from '../p2p/Self'
import { Route } from '../p2p/Types'
import * as shardusTypes from '../shardus/shardus-types'
import ShardFunctions from '../state-manager/shardFunctions'
import * as shardFunctionTypes from '../state-manager/shardFunctionTypes'
import { validateTypes } from '../utils'
import * as partitionGossip from './partition-gossip'

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

type PartitionNum = number

enum offerResponse {
  needed = 'needed',
  notNeeded = 'not_needed',
  tryLater = 'try_later',
  sendTo = 'send_to',
}

/** STATE */

let oldDataPath: string
const oldDataMap: Map<PartitionNum, any[]> = new Map()
const dataToMigrate: Map<PartitionNum, any[]> = new Map()
const oldPartitionHashMap: Map<PartitionNum, any[]> = new Map()
const missingPartitions: PartitionNum[] = []

export const safetyModeVals = {
  safetyMode: false,
  safetyNum: 0,
  networkStateHash: '',
}

/** FUNCTIONS */

export function setOldDataPath(path) {
  oldDataPath = path
  log('set old-data-path', oldDataPath)
}

export async function initSafetyModeVals() {
  const oldCycleRecord = await readOldCycleRecord()
  const oldNetworkHash = await readOldNetworkHash()
  const oldPartitionHashes = await readOldPartitionHashes()

  // Turn safety node on
  safetyModeVals.safetyMode = true

  // Set the safetyNum to the number of active nodes in the last cycle saved in the old data
  safetyModeVals.safetyNum = oldCycleRecord ? oldCycleRecord.active : 0

  // Set networkStateHash to the last network state hash saved in the old data
  safetyModeVals.networkStateHash = oldNetworkHash.hash

  for (const row of oldPartitionHashes) {
    oldPartitionHashMap.set(row.partitionId, row.hash)
  }
  log(safetyModeVals)
  log('Old partition hashes: ', oldPartitionHashMap)
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
        log(`Network Hash for cycle ${shard.cycleNumber}`, networkStateHash)
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
  log('Read Old network state hash', networkStateHash)
  if (networkStateHash && networkStateHash.length > 0)
    return networkStateHash[0]
}

export async function readOldPartitionHashes() {
  const partitionHashes = await Context.storage.getLastOldPartitionHashes()
  log('Read Old partition_state_hashes', partitionHashes)
  return partitionHashes
}

export async function safetySync() {
  let safetyNum: number

  // Register snapshot routes
  registerSnapshotRoutes()

  // Wait until safetyNum of nodes have joined the network
  await new Promise((resolve) => {
    Self.emitter.on('new_cycle_data', (data: CycleCreator.CycleData) => {
      if (data.syncing >= data.safetyNum) {
        safetyNum = data.safetyNum
        resolve()
      }
    })
  })

  // Figure out which nodes hold which partitions in the new network
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
    true
  )

  // If we have old data, figure out which partitions we have and put into OldDataMap
  for (const [partitionId, partitonObj] of partitionShardDataMap) {
    const lowAddress = partitonObj.homeRange.low
    const highAddress = partitonObj.homeRange.high
    const oldAccountCopiesInPartition = await Context.storage.getOldAccountCopiesByCycleAndRange(
      lowAddress,
      highAddress
    )
    if (oldAccountCopiesInPartition && oldAccountCopiesInPartition.length > 0) {
      oldDataMap.set(partitionId, oldAccountCopiesInPartition)
    }
  }

  // check if we have data for each partition we cover in new network. We will use this array to request data from other nodes
  checkMissingPartitions(shardGlobals)

  // Send the old data you have to the new node/s responsible for it
  for (const [partitionId, oldAccountCopies] of oldDataMap) {
    await sendOldDataToNodes(partitionId, shardGlobals, nodeShardDataMap)
  }

  // Check if we have all old data. Once we get the old data you need, go active
  goActiveIfDataComplete()
}

function checkMissingPartitions(shardGlobals: shardFunctionTypes.ShardGlobals) {
  const { homePartition } = ShardFunctions.addressToPartition(
    shardGlobals,
    Self.id
  )
  const {
    partitionStart,
    partitionEnd,
  } = ShardFunctions.calculateStoredPartitions2(shardGlobals, homePartition)
  for (let i = partitionStart; i <= partitionEnd; i++) {
    if (oldDataMap.has(i)) {
      // [TODO] Were good, we have the data. Need to do something with it now...
      dataToMigrate.set(i, oldDataMap.get(i))
    } else {
      missingPartitions.push(i)
    }
  }
}

async function sendOldDataToNodes(
  partitionId: number,
  shardGlobals: shardFunctionTypes.ShardGlobals,
  nodeShardDataMap: shardFunctionTypes.NodeShardDataMap
) {
  // calcuate all nodes that covers a particular partitions
  const nodesToSendData: shardusTypes.Node[] = getNodesThatCoverPartition(
    partitionId,
    shardGlobals,
    nodeShardDataMap
  )

  const offer = createOffer()

  // send data offer to each nodes
  for (let i = 0; i < nodesToSendData.length; i++) {
    const res = await http.post(
      `${nodesToSendData[i].externalIp}:${nodesToSendData[i].externalPort}/snapshot-data-offer`,
      offer
    )
    const answer = res.answer
    // If a node reply us as 'needed', send requested data for requested partitions
    if (answer === offerResponse.needed) {
      const requestedPartitions = res.partitions
      const dataToSend = {}
      for (const partitionId of requestedPartitions) {
        dataToSend[partitionId] = {
          data: oldDataMap.get(partitionId),
          hash: oldPartitionHashMap.get(partitionId),
        }
      }
      await http.post(
        `${nodesToSendData[i].externalIp}:${nodesToSendData[i].externalPort}/snapshot-data`,
        dataToSend
      )
    }
  }
}

function createOffer() {
  const partitionsToOffer = []
  for (const [partitionId] of oldDataMap) {
    partitionsToOffer.push(partitionId)
  }
  return {
    networkStateHash: safetyModeVals.networkStateHash,
    partitions: partitionsToOffer,
  }
}

function getNodesThatCoverPartition(
  partitionId,
  shardGlobals: shardFunctionTypes.ShardGlobals,
  nodeShardDataMap: shardFunctionTypes.NodeShardDataMap
): shardusTypes.Node[] {
  const nodesInPartition: shardusTypes.Node[] = []
  nodeShardDataMap.forEach((data, nodeId) => {
    if (nodeId === Self.id) return
    const node = data.node
    const homePartition = data.homePartition
    const {
      partitionStart,
      partitionEnd,
    } = ShardFunctions.calculateStoredPartitions2(shardGlobals, homePartition)
    if (partitionId >= partitionStart && partitionId <= partitionEnd) {
      nodesInPartition.push(node)
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

function goActiveIfDataComplete() {
  if (missingPartitions.length === 0) {
    log(`We have complete data. Ready to go active`)
    // store account data to new database
    storeDataToNewDB(dataToMigrate)
    Active.requestActive()
  }
}

function storeDataToNewDB(dataMap) {
  // [TODO] store data to new DB
  log('Storing data to new DB')
}

function registerSnapshotRoutes() {
  const snapshotRoute: Route<Handler> = {
    method: 'POST',
    name: 'snapshot-data',
    handler: (req, res) => {
      const err = validateTypes(req, { body: 'o' })
      if (err) {
        log('snapshot-data bad req ' + err)
        res.json([])
        return
      }
      const receivedData = req.body
      log('Recieved missing data: ', receivedData)
      for (let partitionId in Object.keys(receivedData)) {
        // check and store offered data
        const partitionData = receivedData[partitionId]
        const computedHash = Context.crypto.hash(partitionData.data)
        if (computedHash === partitionData.hash) {
          log(`Computed hash and received hash matches for partition ${partitionId}`)
          // store into dataToMigrate temporarily. Will use it to store data to new DB
          dataToMigrate.set(parseInt(partitionId), partitionData.data)
          // remove partition id from missing partition list
          const index = missingPartitions.indexOf(parseInt(partitionId))
          missingPartitions.splice(index, 1)
          goActiveIfDataComplete()
        }
      }
      res.json({ success: true })
    },
  }
  const snapshotDataOfferRoute: Route<Handler> = {
    method: 'POST',
    name: 'snapshot-data-offer',
    handler: (req, res) => {
      const err = validateTypes(req, { body: 'o' })
      if (err) {
        log('snapshot-data-offer bad req ' + err)
        res.json([])
        return
      }
      const offerRequest = req.body
      let answer = offerResponse.notNeeded
      const neededPartitonIds = []
      const neededHashes = []
      if (offerRequest.networkStateHash === safetyModeVals.networkStateHash) {
        for (const partitionId of offerRequest.partitions) {
          // request only the needed partitions
          const isNeeded = missingPartitions.includes(partitionId)
          if (isNeeded) {
            neededPartitonIds.push(partitionId)
            const hasHashForPartition = oldPartitionHashMap.has(partitionId)
            // if node does not have partition_hash for needed partition, request it too.
            if (!hasHashForPartition) neededHashes.push(partitionId)
          }
        }
        if (neededPartitonIds.length > 0) answer = offerResponse.needed
      }
      if (answer === offerResponse.needed) {
        res.json({
          answer,
          partitions: neededPartitonIds,
          hashes: neededHashes,
        })
      } else {
        res.json({ answer })
      }
    },
  }

  const routes = [snapshotRoute, snapshotDataOfferRoute]

  for (const route of routes) {
    Context.network._registerExternal(route.method, route.name, route.handler)
  }
}

function log(...things) {
  console.log('DBG', 'SNAPSHOT', ...things)
}
