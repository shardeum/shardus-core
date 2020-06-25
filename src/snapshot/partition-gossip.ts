import { PartitionHashes } from './index'
import { registerGossipHandler, sendGossip, unregisterGossipHandler } from '../p2p/Comms'
import { EventEmitter } from 'events'

/** TYPES */

type Count = number

type Hash = string

type NodeId = string

type PartitionId = number

type PartitionMap = Map<NodeId, PartitionId[]>

/** CLASSES */

export class PartitionGossip extends EventEmitter {
  shard: CycleShardData
  allHashes: PartitionHashes
  handler: string
  hashCounter: Map<PartitionId, Map<Hash, Count>>
  nodeToPartitions: PartitionMap

  constructor(shard: CycleShardData) {
    super()

    // Save this cycles shard data
    this.shard = shard

    // Compute a partition map for the current cycle shard data
    this.nodeToPartitions = partitionMapFromShard(this.shard)

    // Something to hold all partition hashes once you get them
    this.allHashes = new Map()

    // Something to count how many hashes you get for each parition
    this.hashCounter = new Map()

    // Register gossip handler for this cycles partition hash gossip
    this.handler = 'snapshot' + this.shard.cycleNumber
    registerGossipHandler(this.handler, (payload) => {
      const partitionHashes = new Map() as PartitionHashes
      for (let partitionId in payload) {
        partitionHashes.set(parseInt(partitionId), payload[partitionId])
      }

      // // [TODO] Check nodeToPartitions to make sure all PartitionIds in payload belong to sender
      // // [NOTE] Implement this last after everything is working

      // Add partition hashes into hashTally
      for (let [partitionId, hash] of partitionHashes) {
        if (!this.hashCounter.has(partitionId)) {
          this.hashCounter.set(partitionId, new Map([[hash, 1]]))
        } else if (this.hashCounter.has(partitionId)) {
          let counterMap = this.hashCounter.get(partitionId)
          counterMap.set(hash, counterMap.get(hash) + 1)
        }
      }

      // Once hashTally count is same as shard.shardGlobals.numPartitions number of PartitionId's. 
      // For each PartitionId, take the hash with the highest count and put it into allHashes
      if (this.hashCounter.size === this.shard.shardGlobals.numPartitions) {
        console.log('DEBUG', 'SNAPSHOT', `HashCounter size is same as numPartitions`)
        for (let [partitionId, counterMap] of this.hashCounter) {
          let selectedHash
          let maxCount = 0
          for (let [hash, counter] of counterMap) {
            if (counter > maxCount) {
              selectedHash = hash
              maxCount = counter
            }
          }
          this.allHashes.set(partitionId, selectedHash)
        }
        // Emit an event once allHashes are collected
        this.emit('gotAllHashes', this.allHashes)

        // Clean up the gossip handler for this cycles partition hash gossip
        unregisterGossipHandler(this.handler)
      }

      // Forward the gossip
      // sendGossip(this.handler, payload)
    })
  }

  send(hashes: PartitionHashes) {
    let data = {}
    for (let [partitionId, hash] of hashes) {
      data[partitionId] = hash
    }
    sendGossip(this.handler, data)
  }
}

function partitionMapFromShard(shard: CycleShardData): PartitionMap {
  // [TODO] Maybe state-manager/shardFunctions has something to do this
  return new Map()
}
