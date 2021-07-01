import * as express from 'express'
import * as log4js from 'log4js'
import * as http from '../http'
import { logFlags } from '../logger'
import * as Active from '../p2p/Active'
import * as Comms from '../p2p/Comms'
import * as Context from '../p2p/Context'
import * as CycleChain from '../p2p/CycleChain'
import * as NodeList from '../p2p/NodeList'
import * as Self from '../p2p/Self'
import * as Sync from '../p2p/Sync'
import * as ShardusTypes from '../shardus/shardus-types'
import ShardFunctions from '../state-manager/shardFunctions'
import { Cycle, CycleShardData, MainHashResults } from '../state-manager/state-manager-types'
import { P2P, StateManager } from 'shardus-types'
import * as utils from '../utils'
import { profilerInstance } from '../utils/profiler'
import * as partitionGossip from './partition-gossip'
import * as SnapshotFunctions from './snapshotFunctions'

/** STATE */

export let oldDataPath: string
let oldDataMap: Map<P2P.SnapshotTypes.PartitionNum, ShardusTypes.AccountsCopy[]> = new Map()
const dataToMigrate: Map<P2P.SnapshotTypes.PartitionNum, ShardusTypes.AccountsCopy[]> = new Map()
const oldPartitionHashMap: Map<P2P.SnapshotTypes.PartitionNum, string> = new Map()
let missingPartitions: P2P.SnapshotTypes.PartitionNum[] = []
const notNeededRepliedNodes: Map<string, true> = new Map()
const alreadyOfferedNodes = new Map()
let stateHashesByCycle: Map<Cycle['counter'], P2P.SnapshotTypes.StateHashes> = new Map()
let receiptHashesByCycle: Map<Cycle['counter'], P2P.SnapshotTypes.ReceiptHashes> = new Map()
let summaryHashesByCycle: Map<Cycle['counter'], P2P.SnapshotTypes.SummaryHashes> = new Map()
const partitionBlockMapByCycle: Map<
  Cycle['counter'],
  StateManager.StateManagerTypes.ReceiptMapResult[]
> = new Map()
const statesClumpMapByCycle: Map<Cycle['counter'], StateManager.StateManagerTypes.StatsClump> = new Map()
let safetySyncing = false // to set true when data exchange occurs during safetySync

export const safetyModeVals = {
  safetyMode: false,
  safetyNum: 0,
  networkStateHash: '',
}

export let snapshotLogger: log4js.Logger

/** FUNCTIONS */

export function initLogger() {
  snapshotLogger = Context.logger.getLogger('snapshot')
}

export function setOldDataPath(path) {
  oldDataPath = path
  log('set old-data-path', oldDataPath)
}

export function getStateHashes(
  start: Cycle['counter'] = 0,
  end?: Cycle['counter']
): P2P.SnapshotTypes.StateHashes[] {
  const collector: P2P.SnapshotTypes.StateHashes[] = []
  for (const [key] of stateHashesByCycle) {
    if (key >= start) {
      // check against end cycle only if it's provided
      collector.push(stateHashesByCycle.get(key))
    }
  }
  return collector
}

export function getReceiptHashes(
  start: Cycle['counter'] = 0,
  end?: Cycle['counter']
): P2P.SnapshotTypes.ReceiptHashes[] {
  const collector: P2P.SnapshotTypes.ReceiptHashes[] = []
  for (const [key] of receiptHashesByCycle) {
    if (key >= start) {
      // check against end cycle only if it's provided
      collector.push(receiptHashesByCycle.get(key))
    }
  }
  return collector
}

export function getSummaryHashes(
  start: Cycle['counter'] = 0,
  end?: Cycle['counter']
): P2P.SnapshotTypes.SummaryHashes[] {
  const collector: P2P.SnapshotTypes.SummaryHashes[] = []
  for (const [key] of summaryHashesByCycle) {
    if (key >= start) {
      // check against end cycle only if it's provided
      collector.push(summaryHashesByCycle.get(key))
    }
  }
  return collector
}

export function getReceiptMap(
  start: Cycle['counter'] = 0,
  end?: Cycle['counter']
) : { [key: number]: ReceiptMapResult[] } {
  const collector = {}
  for (const [key] of partitionBlockMapByCycle) {
    if (key >= start) {
      // check against end cycle only if it's provided
      collector[key] = partitionBlockMapByCycle.get(key)
    }
  }
  return collector
}

export function getSummaryBlob(
  start: Cycle['counter'] = 0,
  end?: Cycle['counter']
) : { [key: number]: StatsClump } {
  const collector = {}
  for (const [key] of statesClumpMapByCycle) {
    if (key >= start) {
      // check against end cycle only if it's provided
      collector[key] = statesClumpMapByCycle.get(key)
    }
  }
  return collector
}

function hashPartitionBlocks(partitionId, partitionBlocks) {
  const partitionBlock = partitionBlocks.find(
    (b) => b.partition === partitionId
  )
  return Context.crypto.hash(partitionBlock || {})
}

export async function initSafetyModeVals() {
  const oldCycleRecord = await SnapshotFunctions.readOldCycleRecord()
  const oldNetworkHash = await SnapshotFunctions.readOldNetworkHash()
  const oldPartitionHashes = await SnapshotFunctions.readOldPartitionHashes()

  // Turn safety node on
  safetyModeVals.safetyMode = true

  // Set the safetyNum to the number of active nodes in the last cycle saved in the old data
  if (oldCycleRecord) safetyModeVals.safetyNum = oldCycleRecord.active

  // Set networkStateHash to the last network state hash saved in the old data
  if (oldNetworkHash) safetyModeVals.networkStateHash = oldNetworkHash.hash

  for (const row of oldPartitionHashes) {
    oldPartitionHashMap.set(parseInt(row.partitionId), row.hash)
  }
}

export function startSnapshotting() {
  partitionGossip.initGossip()
  Context.stateManager.eventEmitter.on(
    'cycleTxsFinalized',
    async (
      shard: CycleShardData,
      receiptMapResults: StateManager.StateManagerTypes.ReceiptMapResult[],
      statsClump: StateManager.StateManagerTypes.StatsClump,
      mainHashResults: MainHashResults
    ) => {
      try {
        profilerInstance.profileSectionStart('snapshot')
        const debugStrs = []
        // store receiptMap for this cycle number
        partitionBlockMapByCycle.set(shard.cycleNumber, receiptMapResults)

        // store summary blob map for this cycle
        const statsClumpForThisCycle: StateManager.StateManagerTypes.StatsClump = statsClump
        statesClumpMapByCycle.set(shard.cycleNumber, statsClumpForThisCycle)

        // create our own partition hashes for that cycle number
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
            if(logFlags.debug) snapshotLogger.debug(
              'Accounts in partition: ',
              partition,
              accountsInPartition
            )

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
                    .map((acct) => {
                      const id =
                        acct.accountId === null
                          ? 'null'
                          : acct.accountId.substr(0, 8)
                      const hash =
                        acct.stateId === null
                          ? 'null'
                          : acct.stateId.substr(0, 8)
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
          if(logFlags.debug) snapshotLogger.debug(`
        MEM ACCOUNTS C${shard.cycleNumber}:
        ${debugStrs.join('\n')}
        `)
        } catch (e) {
          console.log(e)
        }
        const globalAccounts = await Context.storage.getGlobalAccountCopies(
          shard.cycleNumber
        )
        const globalAccountHash = Context.crypto.hash(globalAccounts)

        // partition hash for globalAccounts
        partitionHashes.set(-1, globalAccountHash)

        if(logFlags.debug) snapshotLogger.debug('Global Accounts: ', globalAccounts)
        if(logFlags.debug) snapshotLogger.debug('Partition Hashes: ', partitionHashes)

        // process gossip from the queue for that cycle number
        const collector = partitionGossip.newCollector(shard)

        // registering event handler for 'gotAllHashes'
        collector.once('gotAllHashes', (allHashes) => {
          const { partitionHashes, receiptHashes, summaryHashes } = allHashes
          // create a network state hash once we have all partition hashes for that cycle number
          const networkStateHash = SnapshotFunctions.createNetworkHash(
            partitionHashes
          )
          const networkReceiptMapHash = SnapshotFunctions.createNetworkHash(
            receiptHashes
          )
          const networkSummaryHash = SnapshotFunctions.createNetworkHash(
            summaryHashes
          )

          // log('Got all partition hashes: ', partitionHashes)
          // log('Got all receipt hashes: ', receiptHashes)
          // log('Got all summary hashes: ', summaryHashes)

          safetyModeVals.networkStateHash = networkStateHash

          // save the partition and network hashes for that cycle number to the DB
          SnapshotFunctions.savePartitionAndNetworkHashes(
            shard,
            partitionHashes,
            networkStateHash
          )
          SnapshotFunctions.saveReceiptAndNetworkHashes(
            shard,
            receiptHashes,
            networkReceiptMapHash
          )
          SnapshotFunctions.saveSummaryAndNetworkHashes(
            shard,
            summaryHashes,
            networkSummaryHash
          )

          // Update stateHashes by Cycle map
          const newStateHash: P2P.SnapshotTypes.StateHashes = {
            counter: shard.cycleNumber,
            partitionHashes,
            networkHash: networkStateHash,
          }
          stateHashesByCycle = SnapshotFunctions.updateStateHashesByCycleMap(
            shard.cycleNumber,
            newStateHash,
            stateHashesByCycle
          )

          // Update receiptHashes by Cycle map
          const newReceiptHash: P2P.SnapshotTypes.ReceiptHashes = {
            counter: shard.cycleNumber,
            receiptMapHashes: receiptHashes,
            networkReceiptHash: networkReceiptMapHash,
          }
          receiptHashesByCycle = SnapshotFunctions.updateReceiptHashesByCycleMap(
            shard.cycleNumber,
            newReceiptHash,
            receiptHashesByCycle
          )

          // Update summaryHashes by Cycle map
          const newSummaryHash: P2P.SnapshotTypes.SummaryHashes = {
            counter: shard.cycleNumber,
            summaryHashes: summaryHashes,
            networkSummaryHash: networkSummaryHash,
          }
          summaryHashesByCycle = SnapshotFunctions.updateSummaryHashesByCycleMap(
            shard.cycleNumber,
            newSummaryHash,
            summaryHashesByCycle
          )

          // clean up gossip and collector for that cycle number
          partitionGossip.clean(shard.cycleNumber)
          log(
            `Network State Hash for cycle ${shard.cycleNumber}`,
            networkStateHash
          )
          log(
            `Network Receipt Hash for cycle ${shard.cycleNumber}`,
            networkReceiptMapHash
          )
          log(
            `Network Summary Hash for cycle ${shard.cycleNumber}`,
            networkSummaryHash
          )
        })
        partitionGossip.processMessagesInGossipQueue(shard, collector)

        // gossip our partitition hashes and receipt map to the rest of the network with that cycle number
        const message: partitionGossip.Message = {
          cycle: shard.cycleNumber,
          data: {
            partitionHash: {},
            receiptMapHash: {},
            summaryHash: {},
          },
          sender: Self.id,
        }
        // attach partition and receipt hashes to the message to be gossiped
        for (const [partitionId, hash] of partitionHashes) {
          message.data.partitionHash[partitionId] = hash
          message.data.receiptMapHash[partitionId] = hashPartitionBlocks(
            partitionId,
            partitionBlockMapByCycle.get(shard.cycleNumber)
          )
        }

        // attach summary hashes to the message to be gossiped
        const summaryDataStatHash = {}
        const summarytxStatsHash = {}
        for (const blob of statsClumpForThisCycle.dataStats) {
          summaryDataStatHash[blob.partition] = blob.opaqueBlob
        }
        for (const blob of statsClumpForThisCycle.txStats) {
          summarytxStatsHash[blob.partition] = blob.opaqueBlob
        }

        for (const partition of statsClumpForThisCycle.covered) {
          const summaryObj = {
            dataStats: summaryDataStatHash[partition]
              ? summaryDataStatHash[partition]
              : {},
            txStats: summarytxStatsHash[partition]
              ? summarytxStatsHash[partition]
              : {},
          }
          message.data.summaryHash[partition] = Context.crypto.hash(summaryObj)
          if (logFlags.console) console.log(`Summary Obj for partition ${partition}`, summaryObj)
          if (summaryObj) {
            if (logFlags.console) console.log('summaryObj', summaryObj)
            if (logFlags.console) console.log('summaryObj stringified', JSON.stringify(summaryObj))
            if (logFlags.console) console.log('summaryObj hash', Context.crypto.hash(summaryObj))
          }
        }

        const signedMessage = Context.crypto.sign(message)

        Comms.sendGossip('snapshot_gossip', signedMessage, '', null, NodeList.byIdOrder, true)
        partitionGossip.forwardedGossips.set(message.sender, true)
        collector.process([message])

        // Clean partition gossip that's older than 10 cycles
        partitionGossip.cleanOld(shard.cycleNumber, 10)
      } catch (e) {
        console.log(e)
      } finally {
        profilerInstance.profileSectionEnd('snapshot')
      }
    }
  )
}

export async function safetySync() {
  if (logFlags.console) console.log('Doing SafetySync...')
  let safetyNum: number

  // Register snapshot routes
  registerSnapshotRoutes()

  // Wait until safetyNum of nodes have joined the network
  await new Promise<void>((resolve) => {
    Self.emitter.on('new_cycle_data', (data: P2P.CycleCreatorTypes.CycleData) => {
      if (data.syncing >= data.safetyNum) {
        safetyNum = data.safetyNum
        if (!safetyModeVals.networkStateHash) {
          safetyModeVals.networkStateHash = data.networkStateHash
          safetyModeVals.safetyNum = data.safetyNum
          safetyModeVals.safetyMode = data.safetyMode
          if (logFlags.console) console.log('Empty local network state hash detected.')
          if (logFlags.console) console.log('safetyModeVals', safetyModeVals)
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
  const nodeShardDataMap: StateManager.shardFunctionTypes.NodeShardDataMap = new Map()

  // populate DataToMigrate and oldDataMap
  oldDataMap = await SnapshotFunctions.calculateOldDataMap(
    shardGlobals,
    nodeShardDataMap,
    oldPartitionHashMap
  )
  SnapshotFunctions.copyOldDataToDataToMigrate(oldDataMap, dataToMigrate)
  SnapshotFunctions.registerDownloadRoutes(
    Context.network,
    oldDataMap,
    oldPartitionHashMap
  )

  // check if we have data for each partition we cover in new network. We will use this array to request data from other nodes
  missingPartitions = SnapshotFunctions.getMissingPartitions(
    shardGlobals,
    oldDataMap
  )

  safetySyncing = true

  // Send the old data you have to the new node/s responsible for it
  for (const [partitionId] of oldDataMap) {
    await sendOldDataToNodes(partitionId, shardGlobals, nodeShardDataMap)
  }

  // Check if we have all old data. Once we get the old data you need, go active
  goActiveIfDataComplete()
}

async function sendOldDataToNodes(
  partitionId: number,
  shardGlobals: StateManager.shardFunctionTypes.ShardGlobals,
  nodeShardDataMap: StateManager.shardFunctionTypes.NodeShardDataMap
) {
  // calcuate all nodes that covers a particular partitions
  const nodesToSendData: ShardusTypes.Node[] = getNodesThatCoverPartition(
    partitionId,
    shardGlobals,
    nodeShardDataMap
  )

  const offer = createOffer()

  if (offer.partitions.length === 0) {
    if (logFlags.console) console.log('No partition data to offer.')
    return
  }

  // send data offer to each nodes
  for (let i = 0; i < nodesToSendData.length; i++) {
    const res = await http.post(
      `${nodesToSendData[i].externalIp}:${nodesToSendData[i].externalPort}/snapshot-data-offer`,
      offer
    )
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
    downloadUrl: `http://${Self.ip}:${Self.port}/download-snapshot-data`,
  }
}

function getNodesThatCoverPartition(
  partitionId,
  shardGlobals: StateManager.shardFunctionTypes.ShardGlobals,
  nodeShardDataMap: StateManager.shardFunctionTypes.NodeShardDataMap
): ShardusTypes.Node[] {
  const nodesInPartition: ShardusTypes.Node[] = []
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

function getPartitionRanges(shard: CycleShardData): P2P.SnapshotTypes.PartitionRanges {
  const partitionRanges = new Map()
  for (const partition of shard.ourStoredPartitions) {
    partitionRanges.set(
      partition,
      ShardFunctions.partitionToAddressRange2(shard.shardGlobals, partition)
    )
  }

  return partitionRanges
}

async function goActiveIfDataComplete() {
  log('Missing partitions: ', missingPartitions)
  if (missingPartitions.length === 0) {
    log('We have complete data. Ready to go active')
    // store account data to new database
    storeDataToNewDB(dataToMigrate)
    // Start state-manager (skip syncing)
    Context.stateManager.accountSync.skipSync()
    // Go active
    Active.requestActive()
    //await Context.stateManager.partitionObjects.startSyncPartitions()
    Context.stateManager.startProcessingCycleSummaries()
  }
}

export async function startWitnessMode() {
  log('Starting in witness mode...')
  const archiver = Context.config.p2p.existingArchivers[0]
  /**
   * [TODO] [AS] Instead of an interval, make this get the latest cycle,
   * calculate timstamp of the next one, and schedule a callback to run at that
   * time (like how CycleCreator works). That should prove more robust.
   */
  const witnessInterval = setInterval(async () => {
    try {
      const fullNodesSigned = await Self.getFullNodesFromArchiver()
      if (!Context.crypto.verify(fullNodesSigned, archiver.publicKey)) {
        throw Error('Fatal: Full Node list was not signed by archiver!')
      }
      const nodeList = fullNodesSigned.nodeList
      const newestCycle = await Sync.getNewestCycle(nodeList)
      const oldNetworkHash = await SnapshotFunctions.readOldNetworkHash()

      if (
        newestCycle.safetyMode === false ||
        notNeededRepliedNodes.size >= nodeList.length
      ) {
        log('Num of not_needed replied nodes => ', notNeededRepliedNodes.size)
        log('Node will exit witness mode and shutdown.')
        clearInterval(witnessInterval)
        await Context.shardus.shutdown()
        return
      }

      if (
        newestCycle.safetyMode &&
        newestCycle.networkStateHash === oldNetworkHash.hash
      ) {
        log(
          'Network is in safety mode and our network state hashes matches with newest cycle record'
        )
        // caculate which partitions data this node hold
        const shardGlobals = ShardFunctions.calculateShardGlobals(
          newestCycle.safetyNum,
          Context.config.sharding.nodesPerConsensusGroup,
          Context.config.sharding.nodesPerConsensusGroup
        )
        const nodeShardDataMap: StateManager.shardFunctionTypes.NodeShardDataMap = new Map()
        oldDataMap = await SnapshotFunctions.calculateOldDataMap(
          shardGlobals,
          nodeShardDataMap,
          oldPartitionHashMap
        )
        SnapshotFunctions.registerDownloadRoutes(
          Context.network,
          oldDataMap,
          oldPartitionHashMap
        )
        const offer = createOffer()

        // send offer to each syncing + active nodes unless data is already offered
        for (let i = 0; i < nodeList.length; i++) {
          const node = nodeList[i]
          if (!alreadyOfferedNodes.has(node.id)) {
            try {
              log(`Sending witness offer to new node ${node.ip}:${node.port}`)
              sendOfferToNode(node, offer)
              alreadyOfferedNodes.set(node.id, true)
            } catch (e) {
              log('ERROR: ', e)
            }
          }
        }
      }
    } catch (e) {
      log('ERROR: ', e)
    }
  }, Context.config.p2p.cycleDuration * 1000)
}

async function sendOfferToNode(node, offer, isSuggestedByNetwork = false) {
  let answer
  let res
  try {
    res = await http.post(
      `${node.ip}:${node.port}/snapshot-witness-data`,
      offer
    )
    answer = res.answer
  } catch (e) {
    log('ERROR: unable to send offer to node')
    log('ERROR: ', e)
  }
  log(`Offer response from ${node.ip}:${node.port} is => `, answer)
  // If a node reply us as 'needed', send requested data for requested partitions
  if (answer === P2P.SnapshotTypes.offerResponse.needed) {
    const requestedPartitions = res.partitions
    const dataToSend = {}
    for (const partitionId of requestedPartitions) {
      dataToSend[partitionId] = {
        data: oldDataMap.get(partitionId),
        hash: oldPartitionHashMap.get(parseInt(partitionId)),
      }
    }
    await http.post(`${node.ip}:${node.port}/snapshot-data`, dataToSend)
    // If a node reply us 'try_later', wait X amount of time provided by node (OR) cycleDuration/2
  } else if (answer === P2P.SnapshotTypes.offerResponse.tryLater) {
    const waitTime = res.waitTime || 5 * Context.config.p2p.cycleDuration * 1000
    setTimeout(() => {
      log(
        `Trying again to send to ${node.ip}:${node.port} after waiting ${waitTime} ms`
      )
      sendOfferToNode(node, offer, isSuggestedByNetwork)
    }, waitTime)
    // If a node reply us 'send_to', send data to those provided nodes
  } else if (answer === P2P.SnapshotTypes.offerResponse.sendTo) {
    if (isSuggestedByNetwork) {
      // this node is suggesed by other nodes in the network, so send_to response is ignored to prevent infinite loop
      return
    }
    const suggestedNodes = res.nodes
    if (suggestedNodes && suggestedNodes.length > 0) {
      for (let i = 0; i < suggestedNodes.length; i++) {
        const suggestedNode = suggestedNodes[i]
        if (!alreadyOfferedNodes.has(suggestedNode.id)) {
          log(`Sending offer to suggested Node ${node.ip}:${node.port}`)
          sendOfferToNode(suggestedNode, offer, true)
        }
      }
    }
  } else if (answer === P2P.SnapshotTypes.offerResponse.notNeeded) {
    increaseNotNeededNodes(node.id)
  }
}

function increaseNotNeededNodes(id) {
  notNeededRepliedNodes.set(id, true)
}

async function storeDataToNewDB(dataMap) {
  const currentCycle = CycleChain.getNewest()
  // store data to new DB
  log('Storing data to new DB')
  const accountCopies: ShardusTypes.AccountsCopy[] = []
  for (const [, data] of dataMap) {
    if (data && data.length > 0) {
      data.forEach((accountData) => {
        accountCopies.push({
          ...accountData,
          cycleNumber: currentCycle.counter,
        })
      })
    }
  }
  await Context.stateManager._commitAccountCopies(accountCopies)
}

function processDownloadedMissingData(missingData) {
  if (missingPartitions.length === 0) return // we don't have missing data anymore
  log('Processing downloaded data')
  for (const partitionId in missingData) {
    // check and store offered data
    const partitionData = missingData[partitionId]
    const accountsInPartition = partitionData.data.map((acc) => {
      return {
        accountId: acc.accountId,
        data:
          typeof acc.data === 'object' ? JSON.stringify(acc.data) : acc.data,
        timestamp: acc.timestamp,
        hash: acc.hash,
        isGlobal: acc.isGlobal,
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
      if (!dataToMigrate.has(parseInt(partitionId))) {
        dataToMigrate.set(parseInt(partitionId), partitionData.data)
        // remove partition id from missing partition list
        const index = missingPartitions.indexOf(parseInt(partitionId))
        missingPartitions.splice(index, 1)
        goActiveIfDataComplete()
      }
    } else {
      log(`Computed hash and received hash are DIFFERENT for ${partitionId}`)
    }
  }
}

function registerSnapshotRoutes() {
  const snapshotDataOfferRoute: P2P.P2PTypes.Route<express.Handler> = {
    method: 'POST',
    name: 'snapshot-data-offer',
    handler: async (req, res) => {
      const err = utils.validateTypes(req, { body: 'o' })
      if (err) {
        log('snapshot-data-offer bad req ' + err)
        res.json([])
        return
      }
      if (Self.isActive) return res.json({ answer: P2P.SnapshotTypes.offerResponse.notNeeded })
      const offerRequest = req.body
      let answer = P2P.SnapshotTypes.offerResponse.notNeeded
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
        if (neededPartitonIds.length > 0) answer = P2P.SnapshotTypes.offerResponse.needed
      }
      res.json({ answer })
      if (answer === P2P.SnapshotTypes.offerResponse.needed && missingPartitions.length > 0) {
        const downloadedSnapshotData = await SnapshotFunctions.downloadDataFromNode(
          offerRequest.downloadUrl
        )
        if (downloadedSnapshotData)
          processDownloadedMissingData(downloadedSnapshotData)
      }
    },
  }
  const snapshotWitnessDataOfferRoute: P2P.P2PTypes.Route<express.Handler> = {
    method: 'POST',
    name: 'snapshot-witness-data',
    handler: (req, res) => {
      const err = utils.validateTypes(req, { body: 'o' })
      if (err) {
        log('snapshot-witness-data bad req ' + err)
        res.json([])
        return
      }
      if (Self.isActive) {
        return res.json({ answer: P2P.SnapshotTypes.offerResponse.notNeeded })
      }
      const offerRequest = req.body
      const neededPartitonIds = []
      const neededHashes = []
      if (!safetySyncing || !safetyModeVals.networkStateHash) {
        if (!safetySyncing)
          log('We are not doing data exchange yet. Try agian later')
        if (!safetyModeVals.networkStateHash)
          log('We have empty network state hash. Try agian later')
        return res.json({
          answer: P2P.SnapshotTypes.offerResponse.tryLater,
          waitTime: Context.config.p2p.cycleDuration * 1000 * 0.5,
        })
      }
      if (offerRequest.networkStateHash === safetyModeVals.networkStateHash) {
        // ask witnessing node to try offering data later
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
        if (neededPartitonIds.length > 0) {
          return res.json({
            answer: P2P.SnapshotTypes.offerResponse.needed,
            partitions: neededPartitonIds,
            hashes: neededHashes,
          })
        }
      }
      return res.json({ answer: P2P.SnapshotTypes.offerResponse.notNeeded })
    },
  }

  const routes = [snapshotDataOfferRoute, snapshotWitnessDataOfferRoute]

  for (const route of routes) {
    Context.network._registerExternal(route.method, route.name, route.handler)
  }
}

function log(...things) {
  if (logFlags.console) console.log('DBG', 'SNAPSHOT', ...things)
}
