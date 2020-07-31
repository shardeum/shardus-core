import { Handler } from 'express'
import { Logger } from 'log4js'
import * as http from '../http'
import * as Active from '../p2p/Active'
import * as Comms from '../p2p/Comms'
import * as Context from '../p2p/Context'
import * as CycleCreator from '../p2p/CycleCreator'
import * as NodeList from '../p2p/NodeList'
import * as Self from '../p2p/Self'
import { Route } from '../p2p/Types'
import * as shardusTypes from '../shardus/shardus-types'
import ShardFunctions from '../state-manager/shardFunctions'
import * as shardFunctionTypes from '../state-manager/shardFunctionTypes'
import { validateTypes } from '../utils'
import * as partitionGossip from './partition-gossip'

/** TYPES */
interface Account {
  accountId: string
  hash: string
}

type PartitionRanges = Map<
  shardFunctionTypes.AddressRange['partition'],
  shardFunctionTypes.AddressRange
>

type PartitionAccounts = Map<
  shardFunctionTypes.AddressRange['partition'],
  Account[]
>

export type PartitionHashes = Map<
  shardFunctionTypes.AddressRange['partition'],
  string
>

type NetworkStateHash = string

type PartitionNum = number

enum offerResponse {
  needed = 'needed',
  notNeeded = 'not_needed',
  tryLater = 'try_later',
  sendTo = 'send_to',
}

/** STATE */

export let oldDataPath: string
const oldDataMap: Map<PartitionNum, any[]> = new Map()
const dataToMigrate: Map<PartitionNum, any[]> = new Map()
const oldPartitionHashMap: Map<PartitionNum, string> = new Map()
const missingPartitions: PartitionNum[] = []

export const safetyModeVals = {
  safetyMode: false,
  safetyNum: 0,
  networkStateHash: '',
}

let snapshotLogger: Logger

/** FUNCTIONS */

export function initLogger() {
  snapshotLogger = Context.logger.getLogger('snapshot')
}

export function setOldDataPath(path) {
  oldDataPath = path
  log('set old-data-path', oldDataPath)
}

export async function initSafetyModeVals() {
  const oldCycleRecord = await readOldCycleRecord()
  const oldNetworkHash = await readOldNetworkHash()
  const oldPartitionHashes = await readOldPartitionHashes()

  // Turn safety node on
  safetyModeVals.safetyMode = true

  // Set the safetyNum to the number of active nodes in the last cycle saved in the old data
  if (oldCycleRecord) safetyModeVals.safetyNum = oldCycleRecord.active

  // Set networkStateHash to the last network state hash saved in the old data
  if (oldNetworkHash) safetyModeVals.networkStateHash = oldNetworkHash.hash

  for (const row of oldPartitionHashes) {
    oldPartitionHashMap.set(parseInt(row.partitionId), row.hash)
  }
  log(safetyModeVals)
  log('Old partition hashes: ', oldPartitionHashMap)
}

export function startSnapshotting() {
  partitionGossip.initGossip()
  Context.stateManager.on(
    'cycleTxsFinalized',
    async (shard: CycleShardData) => {
      const debugStrs = []

      // 1) create our own partition hashes for that cycle number
      const partitionRanges = getPartitionRanges(shard)
      const partitionHashes = new Map()
      for (const partition of shard.ourStoredPartitions) {
        const range = partitionRanges.get(partition)
        if (range) {
          const accountsInPartition = await Context.storage.getAccountCopiesByCycleAndRange(
            shard.cycleNumber,
            range.low,
            range.high
          )
          snapshotLogger.debug('Accounts in partition: ', partition, accountsInPartition)

          const hash = Context.crypto.hash(accountsInPartition)
          partitionHashes.set(partition, hash)

          try {
            //DBG: Print all accounts in mem
            const wrappedAccts = await Context.stateManager.app.getAccountData(
              range.low,
              range.high,
              10000000
            )
            debugStrs.push(
              `  PARTITION ${partition}\n` +
                wrappedAccts
                  .map(acct => {
                  const id = (acct.accountId==null)?"null":acct.accountId.substr(0, 8)
                  const hash = (acct.stateId==null)?"null":acct.stateId.substr(0, 8)
                    return `    ID: ${id} HASH: ${hash}`
                  })
                  .join('\n')
            )
          } catch (e) {
            console.log(e)
          }

        }
      }
      
      try {
        snapshotLogger.debug(`
        MEM ACCOUNTS C${shard.cycleNumber}:
        ${debugStrs.join('\n')}
        `)
      } catch(e) {
        console.log(e)
      }
      const globalAccounts = await Context.storage.getGlobalAccountCopies(shard.cycleNumber)
      const globalAccountHash = Context.crypto.hash(globalAccounts)
      
      // partition hash for globalAccounts
      partitionHashes.set(-1, globalAccountHash)

      snapshotLogger.debug('Global Accounts: ', globalAccounts)
      snapshotLogger.debug('Partition Hashes: ', partitionHashes)


      // 2) process gossip from the queue for that cycle number
      const collector = partitionGossip.newCollector(shard)

      // 3) gossip our partitition hashes to the rest of the network with that cycle number
      const message: partitionGossip.Message = {
        cycle: shard.cycleNumber,
        data: {},
      }
      for (const [partitionId, hash] of partitionHashes) {
        message.data[partitionId] = hash
      }
      collector.process([message])
      Comms.sendGossip('snapshot_gossip', message)

      collector.once('gotAllHashes', (allHashes: PartitionHashes) => {
        // 4) create a network state hash once we have all partition hashes for that cycle number
        const networkStateHash = createNetworkStateHash(allHashes)

        log('Got all hashes: ', allHashes)

        // 5) save the partition and network hashes for that cycle number to the DB
        savePartitionAndNetworkHashes(shard, allHashes, networkStateHash)

        // 6) clean up gossip and collector for that cycle number
        partitionGossip.clean(shard.cycleNumber)
        log(`Network Hash for cycle ${shard.cycleNumber}`, networkStateHash)
      })
    }
  )
}

export async function readOldCycleRecord() {
  const oldCycles = await Context.storage.listOldCycles()
  if (oldCycles && oldCycles.length > 0) return oldCycles[0]
}

export async function readOldNetworkHash() {
  const networkStateHash = await Context.storage.getLastOldNetworkHash()
  log('Read Old network state hash', networkStateHash)
  if (networkStateHash && networkStateHash.length > 0)
    return networkStateHash[0]
}

export async function readOldPartitionHashes() {
  const partitionHashes = await Context.storage.getLastOldPartitionHashes()
  log('Read Old partition_state_hashes', partitionHashes)
  return partitionHashes
}

export async function safetySync() {
  console.log('Doing SafetySync...')
  let safetyNum: number

  // Register snapshot routes
  registerSnapshotRoutes()

  // Wait until safetyNum of nodes have joined the network
  await new Promise((resolve) => {
    Self.emitter.on('new_cycle_data', (data: CycleCreator.CycleData) => {
      if (data.syncing >= data.safetyNum) {
        safetyNum = data.safetyNum
        if (!safetyModeVals.networkStateHash) {
          safetyModeVals.networkStateHash = data.networkStateHash
          safetyModeVals.safetyNum = data.safetyNum
          safetyModeVals.safetyMode = data.safetyMode
          console.log('Empty local network state hash detected.')
          console.log('safetyModeVals', safetyModeVals)
        }
        resolve()
      }
    })
  })

  // Figure out which nodes hold which partitions in the new network
  const shardGlobals = ShardFunctions.calculateShardGlobals(
    safetyNum,
    Context.config.sharding.nodesPerConsensusGroup,
    Context.config.sharding.nodesPerConsensusGroup
  )
  const partitionShardDataMap: shardFunctionTypes.ParititionShardDataMap = new Map()
  ShardFunctions.computePartitionShardDataMap(
    shardGlobals,
    partitionShardDataMap,
    0,
    shardGlobals.numPartitions
  )
  const nodeShardDataMap: shardFunctionTypes.NodeShardDataMap = new Map()
  /**
   * [NOTE] [AS] Need to do this because type of 'cycleJoined' field differs
   * between ShardusTypes.Node (number) and P2P/NodeList.Node (string)
   */
  const nodes = (NodeList.byIdOrder as unknown) as shardusTypes.Node[]

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
        const oldAccountsWithoutCycleNumber = oldAccountCopiesInPartition.map(acc => {
          return {
            accountId: acc.accountId,
            data: acc.data,
            timestamp: acc.timestamp,
            hash: acc.hash,
            isGlobal: acc.isGlobal
          }
        })
        const computedHash = Context.crypto.hash(oldAccountsWithoutCycleNumber)
        log(`old accounts in partition: ${partitionId}: `, oldAccountCopiesInPartition)
        log(computedHash, existingHash)
  
        // make sure that we really have correct data only if hashes match
        if (computedHash === existingHash)
          oldDataMap.set(partitionId, oldAccountCopiesInPartition)
      }
    } catch(e) {
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
          isGlobal: acc.isGlobal
        }
      })
      const computedGlobalHash = Context.crypto.hash(oldGlobalAccWithoutCycleNumber)
      console.log('computed global hash: ', computedGlobalHash)
      console.log('existing global hash: ', existingGlobalHash)
      // make sure that we really have correct data only if hashes match
      if (computedGlobalHash === existingGlobalHash) {
        oldDataMap.set(-1, oldGlobalAccounts)
        dataToMigrate.set(-1, oldGlobalAccounts) // -1 is used for virtual partition for global accounts
      }
    }
  } catch (e) {
    console.log(e)
  }
      

  // check if we have data for each partition we cover in new network. We will use this array to request data from other nodes
  checkMissingPartitions(shardGlobals)

  // Send the old data you have to the new node/s responsible for it
  for (const [partitionId, oldAccountCopies] of oldDataMap) {
    await sendOldDataToNodes(partitionId, shardGlobals, nodeShardDataMap)
  }

  // Check if we have all old data. Once we get the old data you need, go active
  goActiveIfDataComplete()
}

function checkMissingPartitions(shardGlobals: shardFunctionTypes.ShardGlobals) {
  log('Checking missing partitions...')
  log('oldDataMap: ', oldDataMap)
  const { homePartition } = ShardFunctions.addressToPartition(
    shardGlobals,
    Self.id
  )
  log(`Home partition for us is: ${homePartition}`)
  const {
    partitionStart,
    partitionEnd,
  } = ShardFunctions.calculateStoredPartitions2(shardGlobals, homePartition)
  log(`partition start: `, partitionStart)
  log(`partition end: `, partitionEnd)
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
  log(`Partitions to check: `, partitionsToCheck)
  for (let i = 0; i < partitionsToCheck.length; i++) {
    const partitionId = partitionsToCheck[i]
    if (oldDataMap.has(partitionId)) {
      // [TODO] Were good, we have the data. Need to do something with it now...
      dataToMigrate.set(partitionId, oldDataMap.get(partitionId))
    } else {
      missingPartitions.push(partitionId)
    }
  }
  // check for virtual global partiton
  if (!oldDataMap.has(-1)) {
    missingPartitions.push(-1)
  }
}

async function sendOldDataToNodes(
  partitionId: number,
  shardGlobals: shardFunctionTypes.ShardGlobals,
  nodeShardDataMap: shardFunctionTypes.NodeShardDataMap
) {
  // calcuate all nodes that covers a particular partitions
  const nodesToSendData: shardusTypes.Node[] = getNodesThatCoverPartition(
    partitionId,
    shardGlobals,
    nodeShardDataMap
  )

  const offer = createOffer()

  if (offer.partitions.length === 0) {
    console.log('No partition data to offer.')
    return
  }

  // send data offer to each nodes
  for (let i = 0; i < nodesToSendData.length; i++) {
    const res = await http.post(
      `${nodesToSendData[i].externalIp}:${nodesToSendData[i].externalPort}/snapshot-data-offer`,
      offer
    )
    const answer = res.answer
    // If a node reply us as 'needed', send requested data for requested partitions
    if (answer === offerResponse.needed) {
      const requestedPartitions = res.partitions
      const dataToSend = {}
      for (const partitionId of requestedPartitions) {
        dataToSend[partitionId] = {
          data: oldDataMap.get(partitionId),
          hash: oldPartitionHashMap.get(parseInt(partitionId)),
        }
      }
      await http.post(
        `${nodesToSendData[i].externalIp}:${nodesToSendData[i].externalPort}/snapshot-data`,
        dataToSend
      )
    }
  }
}

function createOffer() {
  const partitionsToOffer = []
  for (const [partitionId] of oldDataMap) {
    partitionsToOffer.push(partitionId)
  }
  return {
    networkStateHash: safetyModeVals.networkStateHash,
    partitions: partitionsToOffer,
  }
}

function getNodesThatCoverPartition(
  partitionId,
  shardGlobals: shardFunctionTypes.ShardGlobals,
  nodeShardDataMap: shardFunctionTypes.NodeShardDataMap
): shardusTypes.Node[] {
  const nodesInPartition: shardusTypes.Node[] = []
  if (partitionId === -1) {
    nodeShardDataMap.forEach((data, nodeId) => {
      if (nodeId === Self.id) return
      const node = data.node
      nodesInPartition.push(node)
    })
  } else {
    nodeShardDataMap.forEach((data, nodeId) => {
      if (nodeId === Self.id) return
      const node = data.node
      const homePartition = data.homePartition
      const {
        partitionStart,
        partitionEnd,
      } = ShardFunctions.calculateStoredPartitions2(shardGlobals, homePartition)
      if (partitionId >= partitionStart && partitionId <= partitionEnd) {
        nodesInPartition.push(node)
      }
    })
  }
  return nodesInPartition
}

function createNetworkStateHash(
  partitionHashes: PartitionHashes
): NetworkStateHash {
  let partitionHashArray = []
  for (const [, hash] of partitionHashes) {
    partitionHashArray.push(hash)
  }
  partitionHashArray = partitionHashArray.sort()
  const hash = Context.crypto.hash(partitionHashArray)
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

async function savePartitionAndNetworkHashes(
  shard: CycleShardData,
  partitionHashes: PartitionHashes,
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

async function goActiveIfDataComplete() {
  log('Missing partitions: ', missingPartitions)
  if (missingPartitions.length === 0) {
    log('We have complete data. Ready to go active')
    // store account data to new database
    storeDataToNewDB(dataToMigrate)
    // Start state-manager (skip syncing)
    Context.stateManager.skipSync()
    // Go active
    Active.requestActive()
    await Context.stateManager.startSyncPartitions()
  }
}

async function storeDataToNewDB(dataMap) {
  // store data to new DB
  log('Storing data to new DB')
  const accountCopies: shardusTypes.AccountsCopy[] = []
  for (const [partitionId, data] of dataMap) {
    if (data && data.length > 0) {
      data.forEach((accountData) => {
        accountCopies.push(accountData)
      })
    }
  }
  await Context.stateManager._commitAccountCopies(accountCopies, {})
}

function registerSnapshotRoutes() {
  const snapshotRoute: Route<Handler> = {
    method: 'POST',
    name: 'snapshot-data',
    handler: (req, res) => {
      const err = validateTypes(req, { body: 'o' })
      if (err) {
        log('snapshot-data bad req ' + err)
        res.json([])
        return
      }
      try {
        if(Self.isActive) return res.json({ success: true })
        const receivedData = req.body
        log('Recieved missing data: ', receivedData)
        for (const partitionId in receivedData) {
          // check and store offered data
          const partitionData = receivedData[partitionId]
          const accountsInPartition = partitionData.data.map(acc => {
            return {
              accountId: acc.accountId,
              data: (typeof acc.data === 'object') ? JSON.stringify(acc.data) : acc.data,
              timestamp: acc.timestamp,
              hash: acc.hash,
              isGlobal: acc.isGlobal
            }
          })
          const computedHash = Context.crypto.hash(accountsInPartition)
          log(`Received data for partition ${partitionId} => `, accountsInPartition)
          log(computedHash, partitionData.hash)
          if (computedHash === partitionData.hash) {
            log(
              `Computed hash and received hash matches for partition ${partitionId}`
            )
            // store into dataToMigrate temporarily. Will use it to store data to new DB
            if(!dataToMigrate.has(parseInt(partitionId))) {
              dataToMigrate.set(parseInt(partitionId), partitionData.data)
              // remove partition id from missing partition list
              const index = missingPartitions.indexOf(parseInt(partitionId))
              missingPartitions.splice(index, 1)
              goActiveIfDataComplete()
            }
          } else {
            log(
              `Computed hash and received hash are DIFFERENT for ${partitionId}`
            )
          }
        }
      } catch (e) {
        log('ERROR: ', e)
      }
      res.json({ success: true })
    },
  }
  const snapshotDataOfferRoute: Route<Handler> = {
    method: 'POST',
    name: 'snapshot-data-offer',
    handler: (req, res) => {
      const err = validateTypes(req, { body: 'o' })
      if (err) {
        log('snapshot-data-offer bad req ' + err)
        res.json([])
        return
      }
      if(Self.isActive) return res.json({ answer: offerResponse.notNeeded })
      const offerRequest = req.body
      let answer = offerResponse.notNeeded
      const neededPartitonIds = []
      const neededHashes = []
      if (offerRequest.networkStateHash === safetyModeVals.networkStateHash) {
        for (const partitionId of offerRequest.partitions) {
          // request only the needed partitions
          const isNeeded = missingPartitions.includes(partitionId)
          if (isNeeded) {
            neededPartitonIds.push(partitionId)
            const hasHashForPartition = oldPartitionHashMap.has(partitionId)
            // if node does not have partition_hash for needed partition, request it too.
            if (!hasHashForPartition) neededHashes.push(partitionId)
          }
        }
        if (neededPartitonIds.length > 0) answer = offerResponse.needed
      }
      if (answer === offerResponse.needed) {
        res.json({
          answer,
          partitions: neededPartitonIds,
          hashes: neededHashes,
        })
      } else {
        res.json({ answer })
      }
    },
  }

  const routes = [snapshotRoute, snapshotDataOfferRoute]

  for (const route of routes) {
    Context.network._registerExternal(route.method, route.name, route.handler)
  }
}

function log(...things) {
  console.log('DBG', 'SNAPSHOT', ...things)
}
