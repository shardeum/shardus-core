# State Snapshotting 2

The PartitionGossip module (`src/snapshot/partition-gossip.ts`) will manage the partition gossip route, gossip queue, and Collector instances

Collector instances collect partition hashes from gossip messages for a given cycle and emit an event when they have
collected all partition hashes

The gossip queue no longer uses a flag, its always listening for gossip and putting it into the queue

When state-manager emits the 'cycleTxsFinalized' event, we need to:
  1) create our own partition hashes for that cycle number
  2) gossip our partitition hashes to the rest of the network with that cycle number
  3) process gossip from the queue for that cycle number
        change the hash that we have for a partition to the most common one from the gossip
  4) create a network state hash once we have all partition hashes for that cycle number
  5) save the partition and network hashes for that cycle number to the DB


## `snapshot/index.ts`

```ts
import { stateManager } from '../p2p/Context'
import * as PartitionGossip from './partition-gossip.ts'

function startSnapshotting() {
  ...
  PartitionGossip.initGossip()
  ...
  stateManager.on('cycleTxsFinalized', async (shard: CycleShardData) => {
    // 1) create our own partition hashes for that cycle number
    const partitionRanges = ...
    const partitionHashes = computePartitionHashes(shard.cycleNumber, partitionRanges)

    // 2) process gossip from the queue for that cycle number
    const collector = PartitionGossip.newCollector(shard)

    // 3) gossip our partitition hashes to the rest of the network with that cycle number
    const message = {
      cycle: shard.cycleNumber
      data: partitionHashes
    }
    collector.process(message)
    sendGossip(message)
    ...

    collector.once('gotAllHashes', (allHashes: PartitionHashes) => {
      // 4) create a network state hash once we have all partition hashes for that cycle number
      ...
      // 5) save the partition and network hashes for that cycle number to the DB
      ...
      // 6) clean up gossip and collector for that cycle number 
      PartitionGossip.clean(shard.cycleNumber)
    })

  })
}

```

## `snapshot/partition-gossip.ts`

```ts
/** TYPES */

// Partition gossip message interface
interface Message {
  cycle: number
  data: PartitionHashes
}

/** STATE */

// A queue of recieved gossip messages sorted by cycle number
const queue: Map<Message['cycle'], Message[]>

// A map of Collector instances by cycle number
const collectors: Map<Message['cycle'], Collector>

/** CLASSES */

// A class responsible for collecting and processing partition gossip for a given Cycle
export class Collector extends EventEmitter {
  constructor(shard: CycleShardData) {
    // Something to store all the collected parition hashes and their counts
    this.allHashes
    this.hashCounter
  }
  ...
  // Collects and counts partition hashes from gossip messages
  process(message: Message) {
    ...
    // When the hashes of all partitions have been collected, emit the 'gotAllHashes' event
    // and pass the most popular hash for each partition
    this.emit('gotAllHashes', this.allHashes)
  }
}

/** FUNCTIONS */

// Registers partition gossip handler
export function initGossip() {
  // On message, checks collectors if a collector instance exists for the messages cycle
  //   if so, processes the message with the collector e.g. collector.process(message)
  //   else, puts the message into the queue by cycle
}

// Make a Collector to handle gossip for the given cycle
export function newCollector(shard: CycleShardData): Collector {
  // Creates a new Collector instance
  const collector = new Collector(shard)
  ...

  // Add it to collectors map by shard cycle number
  collectors.set(shard.cycleNumber, collector)
  ...

  // Pass any messages in the queue for the given cycle to this collector
  collector.process(queue.get(shard.cycleNumber))
  queue.delete(shard.cycleNumber)

  ...
  return collector
}

// Cleans the collector and any remaining gossip in the queue for the given cycle
export function clean(cycle: number) {
  collectors.delete(cycle)
  queue.delete(cycle)
}


```
