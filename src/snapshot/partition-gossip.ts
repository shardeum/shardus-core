import { EventEmitter } from 'events'
import { registerGossipHandler } from '../p2p/Comms'
import { AddressRange } from '../state-manager/shardFunctionTypes'
import { PartitionHashes, ReceiptMapHashes } from './index'
import * as Comm from '../p2p/Comms'

/** TYPES */

type Count = number

type Hash = string

type NodeId = string

type PartitionId = number

type Queue = Map<Message['cycle'], Message[]>

type Collectors = Map<Message['cycle'], Collector>

export type Message = {
  cycle: number
  data: {
    partitionHash: any,
    receiptMapHash: any
  }
  sender: string
}

const queue: Queue = new Map()
const collectors: Collectors = new Map()
const gossipCounter = new Map()
let gossipCounterForEachPartition
let readyPartitions
let parititionShardDataMap
let forwardedGossips = new Map()

// A class responsible for collecting and processing partition gossip for a given Cycle
export class Collector extends EventEmitter {
  shard: CycleShardData
  allPartitionHashes: PartitionHashes
  allReceiptMapHashes: ReceiptMapHashes
  partitionHashCounter: Map<PartitionId, Map<Hash, Count>>
  receiptHashCounter: Map<PartitionId, Map<Hash, Count>>

  constructor(shard: CycleShardData) {
    super()
    this.shard = shard
    this.allPartitionHashes = new Map()
    this.allReceiptMapHashes = new Map()
    this.partitionHashCounter = new Map()
    this.receiptHashCounter = new Map()
  }
  process(messages: Message[]) {
    let cycle
    // Loop through messages and add to hash tally
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i]
      let partitionHashData = messages[i].data.partitionHash
      let receiptHashData = messages[i].data.receiptMapHash
      if (!cycle) cycle = messages[i].cycle

      // forward snapshot gossip if gossip cycle is same as current cycle
      if (this.shard.cycleNumber === message.cycle) {
        if (!forwardedGossips.has(message.sender)) {
          console.log(`Forwarding the snapshot gossip from ${message.sender}`)
          Comm.sendGossip('snapshot_gossip', message)
          forwardedGossips.set(message.sender, true)
        } else if (forwardedGossips.has(message.sender)) {
          console.log(`Received already forwarded message`)
          return
        }
      }

      if (!parititionShardDataMap) {
        console.log('No partition shard data map')
        return
      }

      // Record number of gossip recieved for each partition
      for (let i = 0; i < Object.keys(partitionHashData).length; i++) {
        let partitionId = Object.keys(partitionHashData)[i]
          let partitionShardData = parititionShardDataMap.get(parseInt(partitionId))
        if (!partitionShardData) {
          console.log('No partition shard data for partition: ', partitionId)
          continue
        }
        let coveredBy = partitionShardData.coveredBy
        let isSenderCoverThePartition = coveredBy[message.sender]
        if (!isSenderCoverThePartition) {
          console.log(`Sender ${message.sender} does not cover this partition ${partitionId}`)
          delete partitionHashData[partitionId]
          continue
        }
        let currentCount = gossipCounterForEachPartition.get(parseInt(partitionId))
        let requiredCount = Math.ceil(Object.keys(coveredBy).length / 2)
        if(currentCount) {
          let newCount = currentCount + 1
          gossipCounterForEachPartition.set(parseInt(partitionId), newCount)
          if (newCount >= requiredCount) {
            readyPartitions.set(parseInt(partitionId), true)
          }
        } else {
          gossipCounterForEachPartition.set(parseInt(partitionId), 1)
        }
      }

      const partitionHashes = new Map() as PartitionHashes
      const receiptHashes = new Map() as ReceiptMapHashes
      for (const partitionId in partitionHashData) {
        partitionHashes.set(parseInt(partitionId), partitionHashData[partitionId])
      }
      for (const partitionId in receiptHashData) {
        receiptHashes.set(parseInt(partitionId), receiptHashData[partitionId])
      }

      // // [TODO] Check nodeToPartitions to make sure all PartitionIds in payload belong to sender
      // // [NOTE] Implement this last after everything is working

      // Add partition hashes into partition hashTally
      for (const [partitionId, hash] of partitionHashes) {
        if (!this.partitionHashCounter.has(partitionId)) {
          this.partitionHashCounter.set(partitionId, new Map([[hash, 1]]))
        } else if (this.partitionHashCounter.has(partitionId)) {
          const counterMap = this.partitionHashCounter.get(partitionId)
          const currentCount = counterMap.get(hash)
          if(currentCount) counterMap.set(hash, currentCount + 1)
          else counterMap.set(hash, 1)
        }
      }

      // Add receipt hashes into receipt hashTally
      for (const [partitionId, hash] of receiptHashes) {
        if (!this.receiptHashCounter.has(partitionId)) {
          this.receiptHashCounter.set(partitionId, new Map([[hash, 1]]))
        } else if (this.receiptHashCounter.has(partitionId)) {
          const counterMap = this.receiptHashCounter.get(partitionId)
          const currentCount = counterMap.get(hash)
          if(currentCount) counterMap.set(hash, currentCount + 1)
          else counterMap.set(hash, 1)
        }
      }
    }
    // When the hashes of all partitions have been collected, emit the 'gotAllHashes' event
    // and pass the most popular hash for each partition
    const numOfGossipReceived = gossipCounter.get(cycle)
    console.log(`Num of gossip received: `, numOfGossipReceived)
    console.log(`Gossip counter for each partition (cycle: ${cycle}): `, gossipCounterForEachPartition)
    console.log(`Ready partitions for (cycle: ${cycle}): `, readyPartitions)
    if (readyPartitions.size >= this.shard.shardGlobals.numPartitions && this.partitionHashCounter.size === this.shard.shardGlobals.numPartitions + 1) {
      // +1 is for virtual global partition

      // decide winner partition hashes based on hash tally
      for (const [partitionId, counterMap] of this.partitionHashCounter) {
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
        
        console.log(`PARTITION: CounterMap for Cycle ${cycle} Partition: ${partitionId} => `, counterMap)
        if (possibleHashes.length > 0) selectedHash = possibleHashes[0]
        if (selectedHash) this.allPartitionHashes.set(partitionId, selectedHash)
      }

      // decide winner receipt hashes based on hash tally
      for (const [partitionId, counterMap] of this.receiptHashCounter) {
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
        
        console.log(`RECEIPT: CounterMap for Cycle ${cycle} Partition: ${partitionId} => `, counterMap)
        if (possibleHashes.length > 0) selectedHash = possibleHashes[0]
        if (selectedHash) this.allReceiptMapHashes.set(partitionId, selectedHash)
      }
      // Emit an event once allHashes are collected
      this.emit('gotAllHashes', {
        partitionHashes: this.allPartitionHashes,
        receiptHashes: this.allReceiptMapHashes,
      })
    }
   
  }
}



/** FUNCTIONS */

// Registers partition gossip handler
export function initGossip() {
  console.log('registering gossip handler...')
  registerGossipHandler('snapshot_gossip', (message) => {
    let { cycle } = message
    if (gossipCounter.has(cycle)) {
      gossipCounter.set(cycle, gossipCounter.get(cycle) + 1)
    } else {
      gossipCounter.set(cycle, 1)
    }
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
  gossipCounterForEachPartition = new Map()
  readyPartitions = new Map()
  forwardedGossips = new Map()
  parititionShardDataMap = shard.parititionShardDataMap


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
