import { PartitionHashes } from './index'
import {
  registerGossipHandler,
  sendGossip,
  unregisterGossipHandler,
} from '../p2p/Comms'
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
  gossipQueue: Map<PartitionId, any[]>
  allHashes: PartitionHashes
  handler: string
  hashCounter: Map<PartitionId, Map<Hash, Count>>
  nodeToPartitions: PartitionMap
  queue_partition_gossip: boolean

  constructor() {
    super()
    this.gossipQueue = new Map()
    // Something to hold all partition hashes once you get them
    this.allHashes = new Map()
    // Something to count how many hashes you get for each parition
    this.hashCounter = new Map()
  }

  setGossipQueueFlag() {
    this.queue_partition_gossip = true
  }

  clearGossipQueueFlag() {
    this.queue_partition_gossip = false
  }

  setCycleShard(shard: CycleShardData) {
    this.shard = shard
    // Compute a partition map for the current cycle shard data
    this.nodeToPartitions = partitionMapFromShard(this.shard)
  }

  registerGossipHandler() {
    registerGossipHandler('snapshot_gossip', payload => {
      const { cycleNumber, data } = payload
      if (Object.keys(data).length === 0) {
        return
      }
      // Add to Queue only when queue_partition_gossip flag is true
      if (this.queue_partition_gossip) {
        console.log('New gossip received and added to gossip queue')
        if (this.gossipQueue.has(cycleNumber)) {
          const existingGossip = this.gossipQueue.get(cycleNumber)
          existingGossip.push(data)
        } else {
          this.gossipQueue.set(cycleNumber, [data])
        }
      } else {
        console.log('New gossip received and about to immediately process')
        this.processGossip(data)
      }
    })
  }
  processGossip(inputGossip) {
    let gossipForThisCycle
    if (!inputGossip) {
      console.log(
        `Processing gossip from Queue for cycle ${this.shard.cycleNumber}`
      )
      gossipForThisCycle = this.gossipQueue.get(this.shard.cycleNumber)
      if (!gossipForThisCycle) {
        return
      }
    } else if (inputGossip) {
      console.log(
        `Processing incoming gossip for cycle ${this.shard.cycleNumber}`
      )
      gossipForThisCycle = [inputGossip]
    }

    for (let i = 0; i < gossipForThisCycle.length; i++) {
      let payload: any = gossipForThisCycle[i]
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
        console.log(
          'DEBUG',
          'SNAPSHOT',
          `HashCounter size is same as numPartitions`
        )
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
      }

      // Forward the gossip
      // sendGossip(this.handler, payload)
    }
    // delete gossips in the queue after processing
    if (!inputGossip) this.gossipQueue.delete(this.shard.cycleNumber)
  }

  send(hashes: PartitionHashes) {
    let data = {}
    for (let [partitionId, hash] of hashes) {
      data[partitionId] = hash
    }
    sendGossip('snapshot_gossip', {
      cycleNumber: this.shard.cycleNumber,
      data,
    })
  }
}

function partitionMapFromShard(shard: CycleShardData): PartitionMap {
  // [TODO] Maybe state-manager/shardFunctions has something to do this
  return new Map()
}
