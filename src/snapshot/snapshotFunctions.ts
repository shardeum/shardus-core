import got from 'got'
import { P2P, StateManager } from 'shardus-types'
import stream from 'stream'
import zlib from 'zlib'
import { logFlags } from '../logger'
import * as Context from '../p2p/Context'
import * as NodeList from '../p2p/NodeList'
import * as Self from '../p2p/Self'
import * as ShardusTypes from '../shardus/shardus-types'
import ShardFunctions from '../state-manager/shardFunctions'
import { Cycle, CycleShardData } from '../state-manager/state-manager-types'
import { safetyModeVals, snapshotLogger } from './index'
import { hashMap } from './partition-gossip'

const { Transform } = require('stream')
/** TYPES */

const status: 'applied' | 'rejected' = 'applied'
const tx = {
  /* Unsigned transaction */
}
type txId = string
type txId2 = string
type ReceiptMap = Map<txId, txId2[]>
interface PartitionBlock {
  cycle: Cycle['counter']
  partitionId: PartitionNum
  receiptMap: ReceiptMap
}
interface Account {
  accountId: string
  hash: string
}

type PartitionRanges = Map<
  StateManager.shardFunctionTypes.AddressRange['partition'],
  StateManager.shardFunctionTypes.AddressRange
>

type PartitionAccounts = Map<
  StateManager.shardFunctionTypes.AddressRange['partition'],
  Account[]
>

export type NetworkStateHash = string
export type NetworkReceiptHash = string
export type NetworkSummaryHash = string

type PartitionNum = number

enum offerResponse {
  needed = 'needed',
  notNeeded = 'not_needed',
  tryLater = 'try_later',
  sendTo = 'send_to',
}

let fakeReceipMap = new Map()

export function calculatePartitionBlock (shard) {
  const partitionToReceiptMap: Map<PartitionNum, ReceiptMap> = new Map()
  for (const partition of shard.ourStoredPartitions) {
    const receiptMap: ReceiptMap = new Map()
    partitionToReceiptMap.set(partition, fakeReceipMap)
  }
  // set receiptMap for global partition
  partitionToReceiptMap.set(-1, fakeReceipMap)
  return partitionToReceiptMap
}

export function createNetworkHash (
  hashes: Map<number, string>
): NetworkStateHash {
  let hashArray = []
  for (const [, hash] of hashes) {
    hashArray.push(hash)
  }
  hashArray = hashArray.sort()
  const hash = Context.crypto.hash(hashArray)
  return hash
}

export function updateStateHashesByCycleMap (
  counter: Cycle['counter'],
  stateHash: P2P.SnapshotTypes.StateHashes,
  stateHashesByCycle
) {
  const newStateHashByCycle: Map<Cycle['counter'], P2P.SnapshotTypes.StateHashes> = new Map(
    stateHashesByCycle
  )
  const transformedStateHash = {
    ...stateHash,
    partitionHashes: convertMapToObj(stateHash.partitionHashes),
  }
  newStateHashByCycle.set(counter, transformedStateHash)
  if (newStateHashByCycle.size > 100 && counter > 100) {
    const limit = counter - 100
    for (const [key, value] of newStateHashByCycle) {
      if (key < limit) {
        newStateHashByCycle.delete(key)
      }
    }
  }
  return newStateHashByCycle
}

export function updateReceiptHashesByCycleMap (
  counter: Cycle['counter'],
  receiptHash: P2P.SnapshotTypes.ReceiptHashes,
  receiptHashesByCycle
) {
  const newReceiptHashesByCycle: Map<Cycle['counter'], P2P.SnapshotTypes.ReceiptHashes> = new Map(
    receiptHashesByCycle
  )

  const transformedStateHash = {
    ...receiptHash,
    receiptMapHashes: convertMapToObj(receiptHash.receiptMapHashes),
  }
  newReceiptHashesByCycle.set(counter, transformedStateHash)
  if (newReceiptHashesByCycle.size > 100 && counter > 100) {
    const limit = counter - 100
    for (const [key, value] of newReceiptHashesByCycle) {
      if (key < limit) {
        newReceiptHashesByCycle.delete(key)
      }
    }
  }
  return newReceiptHashesByCycle
}

export function updateSummaryHashesByCycleMap (
  counter: Cycle['counter'],
  summaryHashes: P2P.SnapshotTypes.SummaryHashes,
  summaryHashesByCycle
) {
  const newSummaryHashesByCycle: Map<Cycle['counter'], P2P.SnapshotTypes.SummaryHashes> = new Map(
    summaryHashesByCycle
  )

  const transformedSummaryHash = {
    ...summaryHashes,
    summaryHashes: convertMapToObj(summaryHashes.summaryHashes),
  }
  newSummaryHashesByCycle.set(counter, transformedSummaryHash)
  if (newSummaryHashesByCycle.size > 100 && counter > 100) {
    const limit = counter - 100
    for (const [key, value] of newSummaryHashesByCycle) {
      if (key < limit) {
        newSummaryHashesByCycle.delete(key)
      }
    }
  }
  return newSummaryHashesByCycle
}

export async function savePartitionAndNetworkHashes (
  shard: CycleShardData,
  partitionHashes: hashMap,
  networkHash: NetworkStateHash
) {
  for (const [partitionId, hash] of partitionHashes) {
    await Context.storage.addPartitionHash({
      partitionId,
      cycleNumber: shard.cycleNumber,
      hash,
    })
  }
  await Context.storage.addNetworkState({
    cycleNumber: shard.cycleNumber,
    hash: networkHash,
  })
}

export async function saveReceiptAndNetworkHashes (
  shard: CycleShardData,
  receiptMapHashes: hashMap,
  networkReceiptHash: NetworkReceiptHash
) {
  for (const [partitionId, hash] of receiptMapHashes) {
    await Context.storage.addReceiptMapHash({
      partitionId,
      cycleNumber: shard.cycleNumber,
      hash,
    })
  }
  await Context.storage.addNetworkReceipt({
    cycleNumber: shard.cycleNumber,
    hash: networkReceiptHash,
  })
}

export async function saveSummaryAndNetworkHashes (
  shard: CycleShardData,
  summaryHashes: hashMap,
  summaryReceiptHash: P2P.SnapshotTypes.NetworkSummarytHash
) {
  for (const [partitionId, hash] of summaryHashes) {
    await Context.storage.addSummaryHash({
      partitionId,
      cycleNumber: shard.cycleNumber,
      hash,
    })
  }
  await Context.storage.addNetworkSummary({
    cycleNumber: shard.cycleNumber,
    hash: summaryReceiptHash,
  })
}

export async function readOldCycleRecord () {
  const oldCycles = await Context.storage.listOldCycles()
  if (oldCycles && oldCycles.length > 0) return oldCycles[0]
}

export async function readOldNetworkHash () {
  try {
    const networkStateHash = await Context.storage.getLastOldNetworkHash()
    log('Read Old network state hash', networkStateHash)
    if (networkStateHash && networkStateHash.length > 0)
      return networkStateHash[0]
  } catch (e) {
    snapshotLogger.error('Unable to read old network state hash')
  }
}

export async function readOldPartitionHashes () {
  try {
    const partitionHashes = await Context.storage.getLastOldPartitionHashes()
    log('Read Old partition_state_hashes', partitionHashes)
    return partitionHashes
  } catch (e) {
    snapshotLogger.error('Unable to read old partition hashes')
  }
}

export async function calculateOldDataMap (
  shardGlobals: StateManager.shardFunctionTypes.ShardGlobals,
  nodeShardDataMap: StateManager.shardFunctionTypes.NodeShardDataMap,
  oldPartitionHashMap
) {
  const partitionShardDataMap: StateManager.shardFunctionTypes.ParititionShardDataMap = new Map()
  const oldDataMap: Map<PartitionNum, any[]> = new Map()
  ShardFunctions.computePartitionShardDataMap(
    shardGlobals,
    partitionShardDataMap,
    0,
    shardGlobals.numPartitions
  )

  /**
   * [NOTE] [AS] Need to do this because type of 'cycleJoined' field differs
   * between ShardusTypes.Node (number) and P2P/Node (string)
   */
  const nodes = (NodeList.byIdOrder as unknown) as ShardusTypes.Node[]

  ShardFunctions.computeNodePartitionDataMap(
    shardGlobals,
    nodeShardDataMap,
    nodes,
    partitionShardDataMap,
    nodes,
    true
  )

  // If we have old data, figure out which partitions we have and put into OldDataMap
  for (const [partitionId, partitonObj] of partitionShardDataMap) {
    try {
      const lowAddress = partitonObj.homeRange.low
      const highAddress = partitonObj.homeRange.high
      const oldAccountCopiesInPartition = await Context.storage.getOldAccountCopiesByCycleAndRange(
        lowAddress,
        highAddress
      )
      if (oldAccountCopiesInPartition) {
        const existingHash = oldPartitionHashMap.get(partitionId)
        const oldAccountsWithoutCycleNumber = oldAccountCopiesInPartition.map(
          acc => {
            return {
              accountId: acc.accountId,
              data: acc.data,
              timestamp: acc.timestamp,
              hash: acc.hash,
              isGlobal: acc.isGlobal,
            }
          }
        )
        const computedHash = Context.crypto.hash(oldAccountsWithoutCycleNumber)
        log(`old accounts in partition: ${partitionId}: `, oldAccountCopiesInPartition)
        log(computedHash, existingHash)
        log('partition: ', partitionId)
        log('existing hash: ', existingHash)
        log('computed hash: ', computedHash)

        // make sure that we really have correct data only if hashes match
        if (computedHash === existingHash) {
          oldDataMap.set(partitionId, oldAccountCopiesInPartition)
        }
      }
    } catch (e) {
      console.log(e)
    }
  }

  // check if we have global account in old DB
  try {
    const oldGlobalAccounts = await Context.storage.getOldGlobalAccountCopies()
    if (oldGlobalAccounts) {
      const existingGlobalHash = oldPartitionHashMap.get(-1)
      const oldGlobalAccWithoutCycleNumber = oldGlobalAccounts.map(acc => {
        return {
          accountId: acc.accountId,
          data: acc.data,
          timestamp: acc.timestamp,
          hash: acc.hash,
          isGlobal: acc.isGlobal,
        }
      })
      const computedGlobalHash = Context.crypto.hash(
        oldGlobalAccWithoutCycleNumber
      )
      // make sure that we really have correct data only if hashes match
      if (computedGlobalHash === existingGlobalHash) {
        oldDataMap.set(-1, oldGlobalAccounts)
      }
    }
  } catch (e) {
    console.log(e)
  }
  return oldDataMap
}

export function copyOldDataToDataToMigrate (oldDataMap, dataToMigrate) {
  for (let [key, value] of oldDataMap) {
    if (!dataToMigrate.has(key)) {
      dataToMigrate.set(key, value)
    }
  }
}

export function getMissingPartitions (
  shardGlobals: StateManager.shardFunctionTypes.ShardGlobals,
  oldDataMap
) {
  log('Checking missing partitions...')
  const missingPartitions = []
  const { homePartition } = ShardFunctions.addressToPartition(
    shardGlobals,
    Self.id
  )
  log(`Home partition for us is: ${homePartition}`)
  const {
    partitionStart,
    partitionEnd,
  } = ShardFunctions.calculateStoredPartitions2(shardGlobals, homePartition)
  log('partition start: ', partitionStart)
  log('partition end: ', partitionEnd)
  const partitionsToCheck = []
  if (partitionStart < partitionEnd) {
    for (let i = partitionStart; i <= partitionEnd; i++) {
      partitionsToCheck.push(i)
    }
  } else if (partitionStart > partitionEnd) {
    const largestPartition = safetyModeVals.safetyNum - 1
    for (let i = partitionStart; i <= largestPartition; i++) {
      partitionsToCheck.push(i)
    }
    for (let i = 0; i <= partitionEnd; i++) {
      partitionsToCheck.push(i)
    }
  }
  log('Partitions to check: ', partitionsToCheck)
  for (let i = 0; i < partitionsToCheck.length; i++) {
    const partitionId = partitionsToCheck[i]
    if (!oldDataMap.has(partitionId)) {
      missingPartitions.push(partitionId)
    }
  }
  // check for virtual global partiton
  if (!oldDataMap.has(-1)) {
    missingPartitions.push(-1)
  }
  return missingPartitions
}

export function registerDownloadRoutes (
  network,
  oldDataMap,
  oldPartitionHashMap
) {
  let dataToSend = {}
  for (const [partitionId, value] of oldDataMap) {
    dataToSend[partitionId] = {
      data: oldDataMap.get(partitionId),
      hash: oldPartitionHashMap.get(parseInt(partitionId)),
    }
  }
  dataToSend = JSON.stringify(dataToSend)
  if (logFlags.console) console.log('Registering download route', typeof dataToSend, dataToSend)

  network.registerExternalGet('download-snapshot-data', (req, res) => {
    const readerStream = stream.Readable.from([dataToSend])
    const gzip = zlib.createGzip()

    res.set('content-disposition', `attachment; filename="snapshot-data"`)
    res.set('content-type', 'application/gzip')

    readerStream.on('error', err => console.log('rs Error', err));
    gzip.on('error', err => console.log('gzip Error', err))
    res.on('error', err => console.log('res Error', err))

    readerStream.pipe(gzip)
      .pipe(res)
      .on('end', function () {
        res.end({ success: true })
      })
  })
}

export async function downloadDataFromNode (url) {
  log('Downloading snapshot data from server...', url)
  const res = await got(url, {
    timeout: 1000, //  Omar - setting this to 1 sec
    retry: 0, // Omar - setting this to 0.
    decompress: true,
    encoding: null,
    headers: {
      'Content-Encoding': 'gzip',
    },
  })
  return new Promise((resolve, reject) => {
    zlib.unzip(res.body, (err, result) => {
      if (err) {
        reject(err)
      } else {
        try {
          let parsedData = JSON.parse(result.toString())
          resolve(parsedData)
        } catch(e) {
          resolve(null)
        }
      }
    })
  })
}

export function convertMapToObj (inputMap) {
  const obj = {}
  for (const [key, value] of inputMap) {
    obj[key] = value
  }
  return obj
}
export function convertArrayToObj (inputArr) {
  const obj = {}
  for (let i = 0; i < inputArr.length; i++) {
    obj[i] = inputArr[i]
  }
  return obj
}

function log (...things) {
  if (logFlags.console) console.log('DBG', 'SNAPSHOT', ...things)
}
