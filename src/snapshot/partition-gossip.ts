import { EventEmitter } from 'events'
import { registerGossipHandler } from '../p2p/Comms'
import { AddressRange } from '../state-manager/shardFunctionTypes'
// import { PartitionHashes, ReceiptMapHashes, SummaryHashes } from './index'
import * as Comm from '../p2p/Comms'
import * as NodeList from '../p2p/NodeList'
import {logFlags} from '../logger'
import { CycleShardData } from '../state-manager/state-manager-types'

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
export let forwardedGossips = new Map()

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
    // if (logFlags.console) console.log(`Processing pending ${messages.length} messages`)
    let cycle
    // Loop through messages and add to hash tally
    for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
      let message = messages[messageIndex]
      // if (logFlags.console) console.log(`Processing message ${messageIndex}`, message.sender)
      let partitionHashData = message.data.partitionHash
      let receiptHashData = message.data.receiptMapHash
      let summaryHashData = message.data.summaryHash
      if (!cycle) cycle = message.cycle

      // forward snapshot gossip if gossip cycle is same as current cycle
      if (this.shard.cycleNumber === message.cycle) {
        if (!forwardedGossips.has(message.sender)) {
          Comm.sendGossip('snapshot_gossip', message, '', null, NodeList.byIdOrder, false)
          forwardedGossips.set(message.sender, true)
        } else if (forwardedGossips.has(message.sender)) {
          continue
        }
      }

      if (!parititionShardDataMap) {
        if (logFlags.console) console.log('No partition shard data map')
        return
      }
      // Record number of gossip recieved for each partition
      if (gossipCounterByCycle.has(cycle)) {
        gossipCounterByCycle.set(cycle, gossipCounterByCycle.get(cycle) + 1)
      } else {
        gossipCounterByCycle.set(cycle, 1)
      }

      for (let i = 0; i < Object.keys(partitionHashData).length; i++) {
        let partitionId = parseInt(Object.keys(partitionHashData)[i])
          let partitionShardData = parititionShardDataMap.get(partitionId)
        if (!partitionShardData) {
          // if (logFlags.console) console.log('No partition shard data for partition: ', partitionId)
          continue
        }
        let coveredBy = partitionShardData.coveredBy
        let isSenderCoverThePartition = coveredBy[message.sender]
        if (!isSenderCoverThePartition) {
          // if (logFlags.console) console.log(`Sender ${message.sender} does not cover this partition ${partitionId}`)
          delete partitionHashData[partitionId]
          continue
        }
        let currentCount = gossipCounterByPartition.get(partitionId)
        let requiredCount = Math.ceil(Object.keys(coveredBy).length / 2)
        if(currentCount) {
          let newCount = currentCount + 1
          gossipCounterByPartition.set(partitionId, newCount)
          if (newCount >= requiredCount) {
            readyPartitions.set(partitionId, true)
          }
        } else {
          gossipCounterByPartition.set(partitionId, 1)
        }
      }

      const dataHashes = convertObjectToHashMap(partitionHashData)
      const receiptHashes = convertObjectToHashMap(receiptHashData)
      const summaryHashes = convertObjectToHashMap(summaryHashData)

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
    // if (logFlags.console) console.log(`Num of gossip received: `, numOfGossipReceived)
    // if (logFlags.console) console.log(`Gossip counter for each partition (cycle: ${cycle}): `, gossipCounterByPartition)
    // if (logFlags.console) console.log(`Ready partitions for (cycle: ${cycle}): `, readyPartitions)

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
        if (logFlags.console) console.log(`DATA HASH COUNTER: Cycle ${cycle}, Partition ${partitionId} => `, counterMap)
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
    
        // if (logFlags.console) console.log(`RECEIPT HASH COUNTER: Cycle ${cycle}, Partition ${partitionId} => `, counterMap)
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
        
        // if (logFlags.console) console.log(`SUMMARY HASH COUNTER: Cycle ${cycle}, Partition ${partitionId} => `, counterMap)
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
  if (logFlags.console) console.log('registering gossip handler...')
  registerGossipHandler('snapshot_gossip', (message) => {
    let { cycle } = message
    let collector = collectors.get(cycle)
    if (collector) {
      // if (logFlags.console) console.log('A collector exists. Processing new incoming message', message.sender)
      collector.process([message])
    } else {
      // if (logFlags.console) console.log('No collector found. Adding gossip to queue', message.sender)
      if (queue.has(cycle)) {
        let messageList = queue.get(cycle)
        messageList.push(message)
      } else {
        queue.set(cycle, [message])
      }
    }
  })
}

// Make a Collector to handle gossip for the given cycle
export function newCollector(shard: CycleShardData): Collector {
  if (logFlags.console) console.log(`Initiating a new collector for cycle ${shard.cycleNumber}`)
  gossipCounterByPartition = new Map()
  readyPartitions = new Map()
  forwardedGossips = new Map()
  parititionShardDataMap = shard.parititionShardDataMap

  // Creates a new Collector instance
  const collector = new Collector(shard)

  // Add it to collectors map by shard cycle number
  collectors.set(shard.cycleNumber, collector)
  return collector
}

export function processMessagesInGossipQueue(shard: CycleShardData, collector: Collector) {
  // Pass any messages in the queue for the given cycle to this collector
  const messages = queue.get(shard.cycleNumber)
  if (messages) {
    collector.process([...messages])
  }
  queue.delete(shard.cycleNumber)
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
