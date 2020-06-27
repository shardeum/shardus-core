import { storage, stateManager, crypto, network } from '../p2p/Context'
import ShardFunctions from '../state-manager/shardFunctions'
import Shardus = require('../shardus/shardus-types')
import { AddressRange } from '../state-manager/shardFunctionTypes'
import { PartitionGossip } from './partition-gossip'
import { sleep } from '../utils'

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
  const partitionGossip = new PartitionGossip()
  partitionGossip.registerGossipHandler()

  // set queue_partition_gossip flag at the start of Q1
  stateManager.on('set_queue_partition_gossip', async () => {
    partitionGossip.setGossipQueueFlag()
  })

  stateManager.on('cycleTxsFinalized', async (shard: CycleShardData) => {
    // Compute partition hashes for all partitions we cover
    const partitionRanges = getPartitionRanges(shard)
    const accounts = (await storage.getAccountCopiesByCycle(
      shard.cycleNumber
    )) as Account[]
    const partitionAccounts = getPartitionAccounts(shard, accounts)
    const partitionHashes = createPartitionHashes(partitionAccounts)
    
    partitionGossip.setCycleShard(shard) // set shard value for calculations
    partitionGossip.once('gotAllHashes', (allHashes: PartitionHashes) => {
      // Compute network hash from all partition hashes
      const networkStateHash = createNetworkStateHash(allHashes)

      // Save partion and network hashes to DB
      savePartitionAndNetworkHashes(shard, allHashes, networkStateHash)

      // Log partitions and accounts
      logPartitionsAndAccounts(
        shard,
        partitionRanges,
        partitionHashes,
        partitionAccounts
      )
    })

    await sleep(500) // [HACK] Wait for everyone to register their handlers 
    /**
     * [NOTE] Try sleeping longer if nodes are missing gossip
     * But don't sleep longer than 1000 ms. This could cause cycle problems
     */

    // Gossip to get all partition hashes
    partitionGossip.send(partitionHashes) // Start gossiping
    partitionGossip.processGossip(null) // process the gossips in the Queue
    partitionGossip.clearGossipQueueFlag() // clear flag to immediately process next incoming gossips
  })
}

function getPartitionAccounts(
  shard: CycleShardData,
  accounts: Account[]
): PartitionAccounts {
  const partitionAccounts: PartitionAccounts = new Map()

  for (const account of accounts) {
    const { homePartition } = ShardFunctions.addressToPartition(
      shard.shardGlobals,
      account.accountId
    )
    const accounts = partitionAccounts.get(homePartition) || []
    accounts.push({
      accountId: account.accountId,
      hash: account.hash,
    })
    partitionAccounts.set(homePartition, accounts)
  }

  return partitionAccounts
}

function createPartitionHashes(
  partitionAccounts: PartitionAccounts
): PartitionHashes {
  const partitionHashes: Map<number, string> = new Map()

  for (const [partition, accounts] of partitionAccounts) {
    const hash = crypto.hash(accounts)
    partitionHashes.set(partition, hash)
  }

  return partitionHashes
}

function createNetworkStateHash(
  partitionHashes: PartitionHashes
): NetworkStateHash {
  const partitionHashArray = []
  for (const [partitionId, hash] of partitionHashes) {
    partitionHashArray.push(hash)
  }
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

function logPartitionsAndAccounts(
  shard: CycleShardData,
  ranges: PartitionRanges,
  partitionHashes: PartitionHashes,
  partitionAccounts: PartitionAccounts
) {
  log(`
  cycle: ${shard.cycleNumber}

  partitions: ${ranges.size}
  `)

  for (const partition of shard.ourStoredPartitions) {
    const range = ranges.get(partition)
    if (range) {
      const acctsLow = range.low.substring(0, 5)
      const acctsHigh = range.high.substring(0, 5)
      const partHash = partitionHashes.get(partition)
      const formattedPartHash = partHash ? partHash.substring(0, 5) : 'N/A'
      console.log(`      part ${partition} | accts ${acctsLow} - ${acctsHigh} | hash ${formattedPartHash}
    `)
    }
    const accounts = partitionAccounts.get(partition)
    if (accounts) {
      for (const account of accounts) {
          let accountId =account[0]
          let hash = account[1]
          const acctId = (accountId != null)?accountId.substring(0, 5):'null'
          const acctHash = (hash != null)?hash.substring(0, 5):'null'
          console.log(`        acct ${acctId} | hash ${acctHash}`)         
      }
      console.log()
    }
  }
}

function log(...things) {
  console.log('DBG', 'SNAPSHOT', ...things)
}
