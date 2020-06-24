import { storage, stateManager, crypto } from '../p2p/Context'
import ShardFunctions from '../state-manager/shardFunctions'
import { AddressRange } from '../state-manager/shardFunctionTypes'
import { parseRecord } from '../p2p/Archivers'

type PartitionRanges = Map<AddressRange['partition'], AddressRange>

type PartitionAccounts = Map<AddressRange['partition'], [string, string][]>

type ParitionHashes = Map<AddressRange['partition'], string>

type NetworkStateHash = string

let oldDataPath: string

export function setOldDataPath(path) {
  oldDataPath = path
  log('set old-data-path', oldDataPath)
}

export function startSnapshotting() {
  stateManager.on('cycleTxsFinalized', async (shard: CycleShardData) => {
    const partitionRanges = getPartitionRanges(shard)
    const accounts = await storage.getAccountCopiesByCycle(shard.cycleNumber)
    const partitionAccounts = getPartitionAccounts(shard, accounts)
    const partitionHashes = createPartitionHashes(partitionAccounts)
    const networkStateHash = createNetworkStateHash(partitionHashes)

    for (const [partitionId, hash] of partitionHashes) {
      await storage.addPartitionHash({
        partitionId,
        cycleNumber: shard.cycleNumber,
        hash,
      })
    }
    await storage.addNetworkState({
      cycleNumber: shard.cycleNumber,
      hash: networkStateHash
    })

    log(`
    cycle: ${shard.cycleNumber}

    partitions: ${partitionRanges.size}
    `)

    for (const partition of shard.ourStoredPartitions) {
      const range = partitionRanges.get(partition)
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
          const acctId = account[0].substring(0, 5)
          const acctHash = account[1].substring(0, 5)
          console.log(`        acct ${acctId} | hash ${acctHash}`)
        }
        console.log()
      }
    }
  })
}

function getPartitionAccounts(
  shard: CycleShardData,
  accounts: { accountId: string; hash: string }[]
): PartitionAccounts {
  const partitionAccounts: Map<number, [string, string][]> = new Map()

  for (const account of accounts) {
    const { homePartition } = ShardFunctions.addressToPartition(
      shard.shardGlobals,
      account.accountId
    )
    const accounts = partitionAccounts.get(homePartition) || []
    accounts.push([account.accountId, account.hash])
    partitionAccounts.set(homePartition, accounts)
  }

  return partitionAccounts
}

function createPartitionHashes(
  partitionAccounts: PartitionAccounts
): ParitionHashes {
  const partitionHashes: Map<number, string> = new Map()

  for (const [partition, accounts] of partitionAccounts) {
    const hash = crypto.hash(accounts)
    partitionHashes.set(partition, hash)
  }

  return partitionHashes
}

function createNetworkStateHash(
  partitionHashes: ParitionHashes
): NetworkStateHash {
  let partitionHashArray = []
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

function log(...things) {
  console.log('DBG', 'SNAPSHOT', ...things)
}
