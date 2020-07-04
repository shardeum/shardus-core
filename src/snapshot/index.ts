import * as Active from '../p2p/Active'
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
  const oldCycles = await storage.listOldCycles()
  if (oldCycles && oldCycles.length > 0) return oldCycles[0]
}

export async function readOldNetworkHash() {
  const networkStateHash = await storage.getLastOldNetworkHash()
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
   * If that doesn't work, we'll use gossip to tell everyone in the network to
   * send that data to us if they have it
   *
   */
  /**
   * Once we receive our old data and put it into state-manager, go active with
   * P2P/Active's requestActive:
   */
  Active.requestActive()
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
