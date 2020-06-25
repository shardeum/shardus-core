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
      const partitionHashes = new Map(payload) as PartitionHashes

      // [TODO] Check nodeToPartitions to make sure all PartitionIds in payload belong to sender
      // [NOTE] Implement this last after everything is working

      // [TODO] Add partition hashes into hashTally

      /**
       * [TODO]
       * Once hashTally has shard.shardGlobals.numPartitions number of PartitionId's,
       *   For each PartitionId, take the hash with the highest count and put it into allHashes
       * 
       * // Emit an event once allHashes are collected
       * this.emit('gotAllHashes', this.allHashes)
       * 
       * // Clean up the gossip handler for this cycles partition hash gossip
       * unregisterGossipHandler(this.handler)
       */

      // Forward the gossip
      sendGossip(this.handler, payload)
    })
  }

  send(hashes: PartitionHashes) {
    sendGossip(this.handler, [...hashes])
  }
}

function partitionMapFromShard(shard: CycleShardData): PartitionMap {
  // [TODO] Maybe state-manager/shardFunctions has something to do this
  return new Map()
}
