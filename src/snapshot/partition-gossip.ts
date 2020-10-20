import { EventEmitter } from 'events'
import { registerGossipHandler } from '../p2p/Comms'
import { AddressRange } from '../state-manager/shardFunctionTypes'
// import { PartitionHashes, ReceiptMapHashes, SummaryHashes } from './index'
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
    receiptMapHash: any,
    summaryHash: any,
  }
  sender: string
}
export type hashMap = Map<number, string>

const queue: Queue = new Map()
const collectors: Collectors = new Map()
const gossipCounterByCycle = new Map()
let gossipCounterByPartition
let readyPartitions
let parititionShardDataMap
let forwardedGossips = new Map()

// A class responsible for collecting and processing partition gossip for a given Cycle
export class Collector extends EventEmitter {
  shard: CycleShardData
  allDataHashes: hashMap
  allReceiptMapHashes: hashMap
  allSummaryHashes: hashMap
  dataHashCounter: Map<PartitionId, Map<Hash, Count>>
  receiptHashCounter: Map<PartitionId, Map<Hash, Count>>
  summaryHashCounter: Map<PartitionId, Map<Hash, Count>>

  constructor(shard: CycleShardData) {
    super()
    this.shard = shard
    this.allDataHashes = new Map()
    this.allReceiptMapHashes = new Map()
    this.allSummaryHashes = new Map()
    this.dataHashCounter = new Map()
    this.receiptHashCounter = new Map()
    this.summaryHashCounter = new Map()
  }
  process(messages: Message[]) {
    let cycle
    // Loop through messages and add to hash tally
    for (let i = 0; i < messages.length; i++) {
      let message = messages[i]
      let partitionHashData = messages[i].data.partitionHash
      let receiptHashData = messages[i].data.receiptMapHash
      let summaryHashData = messages[i].data.summaryHash
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
        let currentCount = gossipCounterByPartition.get(parseInt(partitionId))
        let requiredCount = Math.ceil(Object.keys(coveredBy).length / 2)
        if(currentCount) {
          let newCount = currentCount + 1
          gossipCounterByPartition.set(parseInt(partitionId), newCount)
          if (newCount >= requiredCount) {
            readyPartitions.set(parseInt(partitionId), true)
          }
        } else {
          gossipCounterByPartition.set(parseInt(partitionId), 1)
        }
      }

      const dataHashes = convertObjectToHashMap(partitionHashData)
      const receiptHashes = convertObjectToHashMap(receiptHashData)
      const summaryHashes = convertObjectToHashMap(summaryHashData)

      // const partitionHashes = new Map() as hashMap
      // const receiptHashes = new Map() as hashMap
      // const summaryHashes = new Map() as hashMap

      // for (const partitionId in partitionHashData) {
      //   partitionHashes.set(parseInt(partitionId), partitionHashData[partitionId])
      // }
      // for (const partitionId in receiptHashData) {
      //   receiptHashes.set(parseInt(partitionId), receiptHashData[partitionId])
      // }
      // for (const partitionId in summaryHashData) {
      //   summaryHashes.set(parseInt(partitionId), summaryHashData[partitionId])
      // }

      // Add partition hashes into partition hashTally
      for (const [partitionId, hash] of dataHashes) {
        if (!this.dataHashCounter.has(partitionId)) {
          this.dataHashCounter.set(partitionId, new Map([[hash, 1]]))
        } else if (this.dataHashCounter.has(partitionId)) {
          const counterMap = this.dataHashCounter.get(partitionId)
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

      // Add summary hashes into receipt hashTally
      for (const [partitionId, hash] of summaryHashes) {
        if (!this.summaryHashCounter.has(partitionId)) {
          this.summaryHashCounter.set(partitionId, new Map([[hash, 1]]))
        } else if (this.summaryHashCounter.has(partitionId)) {
          const counterMap = this.summaryHashCounter.get(partitionId)
          const currentCount = counterMap.get(hash)
          if(currentCount) counterMap.set(hash, currentCount + 1)
          else counterMap.set(hash, 1)
        }
      }
    }

    // const numOfGossipReceived = gossipCounterByCycle.get(cycle)
    // console.log(`Num of gossip received: `, numOfGossipReceived)
    // console.log(`Gossip counter for each partition (cycle: ${cycle}): `, gossipCounterByPartition)
    // console.log(`Ready partitions for (cycle: ${cycle}): `, readyPartitions)

    if (readyPartitions.size >= this.shard.shardGlobals.numPartitions && this.dataHashCounter.size === this.shard.shardGlobals.numPartitions + 1) {
      // +1 is for virtual global partition

      // decide winner partition hashes based on hash tally
      for (const [partitionId, counterMap] of this.dataHashCounter) {
        let selectedHash
        let maxCount = 0
        let possibleHashes = []
        for (const [hash, count] of counterMap) {
          if (count > maxCount) {
            maxCount = count
          }
        }
        for (const [hash, count] of counterMap) {
          if (count === maxCount) {
            possibleHashes.push(hash)
          }
        }
        possibleHashes = possibleHashes.sort()
        
        console.log(`DATA HASH COUNTER: Cycle ${cycle}, Partition ${partitionId} => `, counterMap)
        if (possibleHashes.length > 0) selectedHash = possibleHashes[0]
        if (selectedHash) this.allDataHashes.set(partitionId, selectedHash)
      }

      // decide winner receipt hashes based on hash tally
      for (const [partitionId, counterMap] of this.receiptHashCounter) {
        let selectedHash
        let maxCount = 0
        let possibleHashes = []
        for (const [hash, count] of counterMap) {
          if (count > maxCount) {
            maxCount = count
          }
        }
        for (const [hash, count] of counterMap) {
          if (count === maxCount) {
            possibleHashes.push(hash)
          }
        }
        possibleHashes = possibleHashes.sort()
    
        console.log(`RECEIPT HASH COUNTER: Cycle ${cycle}, Partition ${partitionId} => `, counterMap)
        if (possibleHashes.length > 0) selectedHash = possibleHashes[0]
        if (selectedHash) this.allReceiptMapHashes.set(partitionId, selectedHash)
      }

      // decide winner summary hashes based on hash tally
      for (const [partitionId, counterMap] of this.summaryHashCounter) {
        let selectedHash
        let maxCount = 0
        let possibleHashes = []
        for (const [hash, count] of counterMap) {
          if (count > maxCount) {
            maxCount = count
          }
        }
        for (const [hash, count] of counterMap) {
          if (count === maxCount) {
            possibleHashes.push(hash)
          }
        }
        possibleHashes = possibleHashes.sort()
        
        console.log(`SUMMARY HASH COUNTER: Cycle ${cycle}, Partition ${partitionId} => `, counterMap)
        if (possibleHashes.length > 0) selectedHash = possibleHashes[0]
        if (selectedHash) this.allSummaryHashes.set(partitionId, selectedHash)
      }
      // Emit an event once allHashes are collected
      this.emit('gotAllHashes', {
        partitionHashes: this.allDataHashes,
        receiptHashes: this.allReceiptMapHashes,
        summaryHashes: this.allSummaryHashes,
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
    if (gossipCounterByCycle.has(cycle)) {
      gossipCounterByCycle.set(cycle, gossipCounterByCycle.get(cycle) + 1)
    } else {
      gossipCounterByCycle.set(cycle, 1)
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
  gossipCounterByPartition = new Map()
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

function convertObjectToHashMap(obj): hashMap {
  let convertedMap = new Map() as hashMap
  for (let key in obj) {
    convertedMap.set(parseInt(key), obj[key])
  }
  return convertedMap
}

// Cleans the collector and any remaining gossip in the queue for the given cycle
export function clean(cycle: number) {
  collectors.delete(cycle)
  queue.delete(cycle)
}

// Cleans partition gossip for cycles older than current - age
export function cleanOld(current: number, age: number) {
  if (age > current) return
  for (const [cycle] of collectors) {
    if (cycle <= current - age) collectors.delete(cycle)
  }
  for (const [cycle] of queue) {
    if (cycle <= current - age) queue.delete(cycle)
  }
}
