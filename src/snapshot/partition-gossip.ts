import { EventEmitter } from 'events'
import { registerGossipHandler } from '../p2p/Comms'
import { AddressRange } from '../state-manager/shardFunctionTypes'
import { PartitionHashes } from './index'

/** TYPES */

type Count = number

type Hash = string

type NodeId = string

type PartitionId = number

type Queue = Map<Message['cycle'], Message[]>

type Collectors = Map<Message['cycle'], Collector>

export type Message = {
  cycle: number
  data: Record<AddressRange['partition'], string>
}

const queue: Queue = new Map()
const collectors: Collectors = new Map()

// A class responsible for collecting and processing partition gossip for a given Cycle
export class Collector extends EventEmitter {
  shard: CycleShardData
  allHashes: PartitionHashes
  hashCounter: Map<PartitionId, Map<Hash, Count>>

  constructor(shard: CycleShardData) {
    super()
    this.shard = shard
    this.allHashes = new Map()
    this.hashCounter = new Map()
  }
  process(message: Message[]) {
    // Loop through messages and add to hash tally
    for (let i = 0; i < message.length; i++) {
      const data = message[i].data
      const partitionHashes = new Map() as PartitionHashes
      for (const partitionId in data) {
        partitionHashes.set(parseInt(partitionId), data[partitionId])
      }

      // // [TODO] Check nodeToPartitions to make sure all PartitionIds in payload belong to sender
      // // [NOTE] Implement this last after everything is working

      // Add partition hashes into hashTally
      for (const [partitionId, hash] of partitionHashes) {
        if (!this.hashCounter.has(partitionId)) {
          this.hashCounter.set(partitionId, new Map([[hash, 1]]))
        } else if (this.hashCounter.has(partitionId)) {
          const counterMap = this.hashCounter.get(partitionId)
          counterMap.set(hash, counterMap.get(hash) || 0 + 1)
        }
      }
    }
    // When the hashes of all partitions have been collected, emit the 'gotAllHashes' event
    // and pass the most popular hash for each partition
    if (this.hashCounter.size === this.shard.shardGlobals.numPartitions + 1) {
      // +1 is for virtual global partition
      for (const [partitionId, counterMap] of this.hashCounter) {
        let selectedHash
        let maxCount = 0
        let possibleHashes = []
        for (const [hash, counter] of counterMap) {
          if (counter > maxCount) {
            maxCount = counter
          }
        }
        for (const [hash, counter] of counterMap) {
          if (counter === maxCount) {
            possibleHashes.push(hash)
          }
        }
        possibleHashes = possibleHashes.sort()
        if (possibleHashes.length > 0) selectedHash = possibleHashes[0]
        if (selectedHash) this.allHashes.set(partitionId, possibleHashes[0])
        // Emit an event once allHashes are collected
        this.emit('gotAllHashes', this.allHashes)
      }
    }
  }
}



/** FUNCTIONS */

// Registers partition gossip handler
export function initGossip() {
  registerGossipHandler('snapshot_gossip', (message) => {
    const { cycle } = message
    const collector = collectors.get(cycle)
    if (collector) {
      collector.process([message])
    } else {
      if (queue.has(cycle)) {
        const messageList = queue.get(cycle)
        messageList.push(message)
      } else {
        queue.set(cycle, [message])
      }
    }
  })
}

// Make a Collector to handle gossip for the given cycle
export function newCollector(shard: CycleShardData): Collector {
  // Creates a new Collector instance
  const collector = new Collector(shard)

  // Add it to collectors map by shard cycle number
  collectors.set(shard.cycleNumber, collector)

  // Pass any messages in the queue for the given cycle to this collector
  const messages = queue.get(shard.cycleNumber)
  if (messages) collector.process(messages)
  queue.delete(shard.cycleNumber)
  return collector
}

// Cleans the collector and any remaining gossip in the queue for the given cycle
export function clean(cycle: number) {
  collectors.delete(cycle)
  queue.delete(cycle)
}
