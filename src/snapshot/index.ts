import { sendGossip } from '../p2p/Comms'
import { crypto, stateManager, storage } from '../p2p/Context'
import ShardFunctions from '../state-manager/shardFunctions'
import { AddressRange } from '../state-manager/shardFunctionTypes'
import { clean, initGossip, Message, newCollector } from './partition-gossip'

/** TYPES */
interface Account {
  accountId: string
  hash: string
}

type PartitionRanges = Map<AddressRange['partition'], AddressRange>

type PartitionAccounts = Map<AddressRange['partition'], Account[]>

export type PartitionHashes = Map<AddressRange['partition'], string>

type NetworkStateHash = string

/** STATE */

let oldDataPath: string

/** FUNCTIONS */

export function setOldDataPath(path) {
  oldDataPath = path
  log('set old-data-path', oldDataPath)
}

export function startSnapshotting() {
  initGossip()
  stateManager.on('cycleTxsFinalized', async (shard: CycleShardData) => {
    // 1) create our own partition hashes for that cycle number
    const partitionRanges = getPartitionRanges(shard)
    const partitionHashes = new Map()
    for (const partition of shard.ourStoredPartitions) {
      const range = partitionRanges.get(partition)
      if (range) {
        const accountsInPartition = await storage.getAccountCopiesByCycleAndRange(
          shard.cycleNumber,
          range.low,
          range.high
        )
        const hash = crypto.hash(accountsInPartition)
        partitionHashes.set(partition, hash)
      }
    }

    // 2) process gossip from the queue for that cycle number
    const collector = newCollector(shard)

    // 3) gossip our partitition hashes to the rest of the network with that cycle number
    const message: Message = {
      cycle: shard.cycleNumber,
      data: {},
    }
    for (const [partitionId, hash] of partitionHashes) {
      message.data[partitionId] = hash
    }
    collector.process([message])
    sendGossip('snapshot_gossip', message)

    collector.once('gotAllHashes', (allHashes: PartitionHashes) => {
      // 4) create a network state hash once we have all partition hashes for that cycle number
      const networkStateHash = createNetworkStateHash(allHashes)

      // 5) save the partition and network hashes for that cycle number to the DB
      savePartitionAndNetworkHashes(shard, allHashes, networkStateHash)

      // 6) clean up gossip and collector for that cycle number
      clean(shard.cycleNumber)
      console.log(
        `Network Hash for cycle ${shard.cycleNumber}`,
        networkStateHash
      )
    })
  })
}

export async function readOldCycleRecord() {
  let oldCycles = await storage.listOldCycles()
  if (oldCycles && oldCycles.length > 0) return oldCycles[0]
}

export async function readOldNetworkHash() {
  let networkStateHash = await storage.getLastOldNetworkHash()
  console.log('Read Old network state hash', networkStateHash)
  if (networkStateHash && networkStateHash.length > 0) return networkStateHash[0]
}

export async function getSafetyModeVals() {
  let safetyMode = false
  let safetyNum = 0
  let networkStateHash = ''

  if (oldDataPath) {
    let oldCycleRecord = await readOldCycleRecord()
    let oldNetworkHash = await readOldNetworkHash()

    // Turn safety node on
    safetyMode = true

    // Set the safetyNum to the number of active nodes in the last cycle saved in the old data
    safetyNum = oldCycleRecord.active

    // Set networkStateHash to the last network state hash saved in the old data
    networkStateHash = oldNetworkHash
  }

  return {
    safetyMode,
    safetyNum,
    networkStateHash,
  }
}

function createNetworkStateHash(
  partitionHashes: PartitionHashes
): NetworkStateHash {
  let partitionHashArray = []
  for (const [, hash] of partitionHashes) {
    partitionHashArray.push(hash)
  }
  partitionHashArray = partitionHashArray.sort()
  const hash = crypto.hash(partitionHashArray)
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
    await storage.addPartitionHash({
      partitionId,
      cycleNumber: shard.cycleNumber,
      hash,
    })
  }
  await storage.addNetworkState({
    cycleNumber: shard.cycleNumber,
    hash: networkHash,
  })
}

function log(...things) {
  console.log('DBG', 'SNAPSHOT', ...things)
}
