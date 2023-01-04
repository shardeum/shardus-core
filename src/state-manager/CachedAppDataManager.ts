import * as Shardus from '../shardus/shardus-types'
import { StateManager as StateManagerTypes } from '@shardus/types'
import * as utils from '../utils'
import { P2PModuleContext as P2P } from '../p2p/Context'
import Crypto from '../crypto'
import Logger, { logFlags } from '../logger'
import ShardFunctions from './shardFunctions'
import StateManager from '.'
import { nestedCountersInstance } from '../utils/nestedCounters'
import Profiler, { cUninitializedSize, profilerInstance } from '../utils/profiler'
import {
  CachedAppData,
  CacheTopic,
  CacheAppDataResponse,
  CacheAppDataRequest,
  QueueEntry,
  AccountHashCache,
  AccountHashCacheMain3,
  CycleShardData,
  MainHashResults,
  AccountHashCacheHistory,
  AccountHashCacheList,
  PartitionHashResults,
  GetAccountDataWithQueueHintsResp,
  StringNodeObjectMap,
} from './state-manager-types'
import { reversed } from '../utils'

class CachedAppDataManager {
  app: Shardus.App
  crypto: Crypto
  config: Shardus.StrictServerConfiguration
  profiler: Profiler
  p2p: P2P

  logger: Logger

  mainLogger: any
  fatalLogger: any
  shardLogger: any
  statsLogger: any

  statemanager_fatal: (key: string, log: string) => void
  stateManager: StateManager

  // cachedAppDataArray: CachedAppData[]
  cacheTopicMap: Map<string, CacheTopic>

  constructor(
    stateManager: StateManager,
    profiler: Profiler,
    app: Shardus.App,
    logger: Logger,
    crypto: Crypto,
    p2p: P2P,
    config: Shardus.StrictServerConfiguration
  ) {
    this.crypto = crypto
    this.app = app
    this.logger = logger
    this.config = config
    this.profiler = profiler
    this.p2p = p2p

    if (logger == null) {
      return // for debug
    }

    this.mainLogger = logger.getLogger('main')
    this.fatalLogger = logger.getLogger('fatal')
    this.shardLogger = logger.getLogger('shardDump')
    this.statsLogger = logger.getLogger('statsDump')
    this.statemanager_fatal = stateManager.statemanager_fatal
    this.stateManager = stateManager

    this.cacheTopicMap = new Map()
  }

  setupHandlers() {
    this.p2p.registerInternal('send_cachedAppData', async (payload: CacheAppDataResponse, respond: any) => {
      profilerInstance.scopedProfileSectionStart('send_cachedAppData')
      try {
        let cachedAppData = payload.cachedAppData
        let existingCachedAppData = this.getCachedItem(payload.topic, cachedAppData.dataID)
        if (existingCachedAppData) {
          console.log(`We have already processed this cached data`, cachedAppData)
          return
        }
        // insert cachedAppData
        this.insertCachedItem(payload.topic, cachedAppData.dataID, cachedAppData, cachedAppData.cycle)
      } catch (e) {
        this.mainLogger.error(`Error while processing send_cacheAppData`, e)
      } finally {
        profilerInstance.scopedProfileSectionEnd('send_cachedAppData')
      }
    })

    this.p2p.registerInternal('get_cached_app_data', async (payload: CacheAppDataRequest, respond: any) => {
      profilerInstance.scopedProfileSectionStart('get_cached_app_data')
      try {
        let { topic, dataId } = payload
        let foundCachedAppData = this.getCachedItem(topic, dataId)
        if (foundCachedAppData == null) {
          this.mainLogger.error(`Cannot find cached data for topic: ${topic}, dataId: ${dataId}`)
        }
        await respond(foundCachedAppData)
        profilerInstance.scopedProfileSectionEnd('get_cached_app_data')
        return
      } catch (e) {
        this.mainLogger.error(`Error while processing get_cachedAppData`, e)
      } finally {
        profilerInstance.scopedProfileSectionEnd('get_cached_app_data')
      }
    })
  }

  registerTopic(topic: string, maxCycleAge: number, maxCacheElements: number) {
    const cacheTopic: CacheTopic = {
      topic,
      maxCycleAge,
      maxCacheElements,
      cacheAppDataMap: new Map(),
      cachedAppDataArray: [],
    }
    if (this.cacheTopicMap.has(topic)) return false
    this.cacheTopicMap.set(topic, cacheTopic)
    if (logFlags.verbose) this.mainLogger.debug(`Cache topic ${topic} is successfully registered.`)
    return true
  }

  getCachedItem(topic: string, dataID: string) {
    const cacheTopic = this.cacheTopicMap.get(topic)
    if (!cacheTopic) return
    const cachedAppData = cacheTopic.cacheAppDataMap.get(dataID)
    return cachedAppData
  }

  insertCachedItem(topic: string, dataID: string, appData: any, cycle: number) {
    const cachedAppData: CachedAppData = {
      dataID,
      appData,
      cycle,
    }
    const cacheTopic: CacheTopic = this.cacheTopicMap.get(topic)
    if (!cacheTopic) {
      this.statemanager_fatal(
        'insertCachedItem',
        `Topic ${topic} is not registered yet. ${JSON.stringify(this.cacheTopicMap)}`
      )
      return
    }
    const { maxCycleAge, maxCacheElements } = cacheTopic
    cacheTopic.cachedAppDataArray.push(cachedAppData)
    cacheTopic.cacheAppDataMap.set(dataID, cachedAppData)

    // check and prune cache items for this topic
    let count = 0
    const filteredCachedAppDataArray: CachedAppData[] = []
    for (const cachedAppData of reversed(cacheTopic.cachedAppDataArray)) {
      count += 1
      let cycleAge = this.stateManager.currentCycleShardData.cycleNumber - cachedAppData.cycle
      if (cycleAge > maxCycleAge || count > maxCacheElements) {
        if (logFlags.verbose)
          this.mainLogger.debug(
            `Deleting dataId ${cachedAppData.dataID} from cache map. cycleAge: ${cycleAge}, count: ${count}`
          )
        cacheTopic.cacheAppDataMap.delete(cachedAppData.dataID)
      } else {
        filteredCachedAppDataArray.unshift(cachedAppData)
      }
    }
    cacheTopic.cachedAppDataArray = [...filteredCachedAppDataArray]
    if (logFlags.verbose)
      this.mainLogger.debug(
        `Updated cached array size: ${cacheTopic.cachedAppDataArray.length}, cacheMapSize: ${cacheTopic.cacheAppDataMap.size}`
      )
  }

  async sendCorrespondingCachedAppData(
    topic: string,
    dataID: string,
    appData: any,
    cycle: number,
    formId: string,
    txId: string
  ) {
    if (this.stateManager.currentCycleShardData == null) {
      throw new Error('sendCorrespondingCachedAppData: currentCycleShardData == null')
    }
    if (dataID == null) {
      throw new Error('sendCorrespondingCachedAppData: dataId == null')
    }
    const queueEntry: QueueEntry = this.stateManager.transactionQueue.getQueueEntry(txId)
    const fromKey = queueEntry.executionShardKey
    const uniqueKeys = [fromKey, dataID]
    const ourNodeData = this.stateManager.currentCycleShardData.nodeShardData
    let correspondingAccNodes: Shardus.Node[] = []
    const dataKeysWeHave = []
    const dataValuesWeHave = []
    const datas: { [accountID: string]: any } = {}
    const remoteShardsByKey: { [accountID: string]: StateManagerTypes.shardFunctionTypes.NodeShardData } = {} // shard homenodes that we do not have the data for.
    let loggedPartition = false

    let localHomeNode = ShardFunctions.findHomeNode(
      this.stateManager.currentCycleShardData.shardGlobals,
      fromKey,
      this.stateManager.currentCycleShardData.parititionShardDataMap
    )

    let remoteHomeNode = ShardFunctions.findHomeNode(
      this.stateManager.currentCycleShardData.shardGlobals,
      dataID,
      this.stateManager.currentCycleShardData.parititionShardDataMap
    )

    for (const key of uniqueKeys) {
      let hasKey = false
      if (remoteHomeNode.node.id === ourNodeData.node.id) {
        hasKey = true
      } else {
        //perf todo: this seems like a slow calculation, coult improve this
        for (const node of remoteHomeNode.nodeThatStoreOurParitionFull) {
          if (node.id === ourNodeData.node.id) {
            hasKey = true
            break
          }
        }
      }

      const isGlobalKey = false

      if (hasKey === false) {
        if (loggedPartition === false) {
          loggedPartition = true
          /* prettier-ignore */
          if (logFlags.verbose) this.mainLogger.debug(`sendCorrespondingCachedAppData hasKey=false: ${utils.stringifyReduce(remoteHomeNode.nodeThatStoreOurParitionFull.map((v) => v.id))}`);
          /* prettier-ignore */
          if (logFlags.verbose) this.mainLogger.debug(`sendCorrespondingCachedAppData hasKey=false: full: ${utils.stringifyReduce(remoteHomeNode.nodeThatStoreOurParitionFull)}`);
        }
        /* prettier-ignore */
        if (logFlags.verbose) this.mainLogger.debug(`sendCorrespondingCachedAppData hasKey=false  key: ${utils.stringifyReduce(key)}`);
      }

      if (hasKey) {
        const data = appData

        if (isGlobalKey === false) {
          datas[key] = data
          dataKeysWeHave.push(key)
          dataValuesWeHave.push(data)
        }
        this.insertCachedItem(topic, dataID, data, cycle)
      } else {
        remoteShardsByKey[key] = remoteHomeNode
      }
    }

    let edgeNodeIds = []
    let consensusNodeIds = []

    const nodesToSendTo: StringNodeObjectMap = {}
    const doOnceNodeAccPair = new Set<string>() //can skip  node+acc if it happens more than once.

    for (const key of uniqueKeys) {
      for (let key2 of uniqueKeys) {
        if (key !== key2) {
          const ourLocalConsensusIndex = localHomeNode.consensusNodeForOurNodeFull.findIndex(
            (a) => a.id === ourNodeData.node.id
          )
          if (ourLocalConsensusIndex === -1) {
            continue
          }
          edgeNodeIds = []
          consensusNodeIds = []
          correspondingAccNodes = []
          const ourSendingGroupSize = localHomeNode.consensusNodeForOurNodeFull.length
          const targetConsensusGroupSize = remoteHomeNode.consensusNodeForOurNodeFull.length
          const targetEdgeGroupSize = remoteHomeNode.edgeNodes.length
          const pachedListSize = remoteHomeNode.patchedOnNodes.length
          const indicies = ShardFunctions.debugFastStableCorrespondingIndicies(
            ourSendingGroupSize,
            targetConsensusGroupSize,
            ourLocalConsensusIndex + 1
          )
          const edgeIndicies = ShardFunctions.debugFastStableCorrespondingIndicies(
            ourSendingGroupSize,
            targetEdgeGroupSize,
            ourLocalConsensusIndex + 1
          )

          let patchIndicies = []
          if (remoteHomeNode.patchedOnNodes.length > 0) {
            patchIndicies = ShardFunctions.debugFastStableCorrespondingIndicies(
              ourSendingGroupSize,
              remoteHomeNode.patchedOnNodes.length,
              ourLocalConsensusIndex + 1
            )
          }
          for (const index of indicies) {
            const node = remoteHomeNode.consensusNodeForOurNodeFull[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array
            if (node != null && node.id !== ourNodeData.node.id) {
              nodesToSendTo[node.id] = node
              consensusNodeIds.push(node.id)
            }
          }
          for (const index of edgeIndicies) {
            const node = remoteHomeNode.edgeNodes[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array
            if (node != null && node.id !== ourNodeData.node.id) {
              nodesToSendTo[node.id] = node
              edgeNodeIds.push(node.id)
            }
          }
          for (const index of patchIndicies) {
            const node = remoteHomeNode.edgeNodes[index - 1] // fastStableCorrespondingIndicies is one based so adjust for 0 based array

            if (node != null && node.id !== ourNodeData.node.id) {
              nodesToSendTo[node.id] = node
            }
          }
          let cacheAppDataToSend: CachedAppData = {
            dataID,
            appData,
            cycle,
          }
          let message: CacheAppDataResponse = { topic, cachedAppData: cacheAppDataToSend }
          for (const [accountID, node] of Object.entries(nodesToSendTo)) {
            const keyPair = accountID + key
            if (node != null && doOnceNodeAccPair.has(keyPair) === false) {
              doOnceNodeAccPair.add(keyPair)
              correspondingAccNodes.push(node)
            }
          }

          if (logFlags.verbose) {
            if (logFlags.playback) {
              this.logger.playbackLogNote(
                'sendCorrespondingCachedAppData',
                dataID,
                `sendCorrespondingCachedAppData nodesToSendTo:${
                  Object.keys(nodesToSendTo).length
                } doOnceNodeAccPair:${doOnceNodeAccPair.size} indicies:${JSON.stringify(
                  indicies
                )} edgeIndicies:${JSON.stringify(edgeIndicies)} patchIndicies:${JSON.stringify(
                  patchIndicies
                )}  doOnceNodeAccPair: ${JSON.stringify([
                  ...doOnceNodeAccPair.keys(),
                ])} ourLocalConsensusIndex:${ourLocalConsensusIndex} ourSendingGroupSize:${ourSendingGroupSize} targetEdgeGroupSize:${targetEdgeGroupSize} targetEdgeGroupSize:${targetEdgeGroupSize} pachedListSize:${pachedListSize}`
              )
            }
          }

          if (correspondingAccNodes.length > 0) {
            const remoteRelation = ShardFunctions.getNodeRelation(
              remoteHomeNode,
              this.stateManager.currentCycleShardData.ourNode.id
            )
            const localRelation = ShardFunctions.getNodeRelation(
              localHomeNode,
              this.stateManager.currentCycleShardData.ourNode.id
            )
            /* prettier-ignore */
            if (logFlags.playback) this.logger.playbackLogNote("shrd_sendCorrespondingCachedAppData", `${dataID}`, `remoteRel: ${remoteRelation} localrel: ${localRelation} qId: ${dataID} AccountBeingShared: ${utils.makeShortHash(key)} EdgeNodes:${utils.stringifyReduce(edgeNodeIds)} ConsesusNodes${utils.stringifyReduce(consensusNodeIds)}`);

            // Filter nodes before we send tell()
            const filteredNodes = this.stateManager.filterValidNodesForInternalMessage(
              correspondingAccNodes,
              'tellCorrespondingNodes',
              true,
              true
            )
            if (filteredNodes.length === 0) {
              /* prettier-ignore */
              if (logFlags.error) this.mainLogger.error("tellCorrespondingNodes: filterValidNodesForInternalMessage no valid nodes left to try");
              return null
            }
            const filterdCorrespondingAccNodes = filteredNodes

            // TODO Perf: need a tellMany enhancement.  that will minimize signing and stringify required!
            this.p2p.tell(filterdCorrespondingAccNodes, 'send_cachedAppData', message)
          }
        }
      }
    }
  }

  async getLocalOrRemoteCachedAppData(topic: string, dataId: string): Promise<CachedAppData | null> {
    let cachedAppData: CachedAppData | null = null

    if (this.stateManager.currentCycleShardData == null) {
      await this.stateManager.waitForShardData()
    }

    if (this.stateManager.currentCycleShardData == null) {
      throw new Error('getLocalOrRemoteCachedAppData: network not ready')
    }
    let address = dataId

    let forceLocalGlobalLookup = false

    if (this.stateManager.accountGlobals.isGlobalAccount(address)) {
      forceLocalGlobalLookup = true
    }
    let accountIsRemote = this.stateManager.transactionQueue.isAccountRemote(address)

    if (
      this.stateManager.currentCycleShardData.activeNodes.length <=
      this.stateManager.currentCycleShardData.shardGlobals.consensusRadius
    ) {
      accountIsRemote = false
    }
    if (forceLocalGlobalLookup) {
      accountIsRemote = false
    }

    if (accountIsRemote) {
      const randomConsensusNode = this.stateManager.transactionQueue.getRandomConsensusNodeForAccount(address)
      if (randomConsensusNode == null) {
        throw new Error('getLocalOrRemoteAccount: no consensus node found')
      }

      // Node Precheck!
      if (
        this.stateManager.isNodeValidForInternalMessage(
          randomConsensusNode.id,
          'getLocalOrRemoteCachedAppData',
          true,
          true
        ) === false
      ) {
        //throw new Error(`getLocalOrRemoteAccount: no retry implmented yet`)
        /* prettier-ignore */
        if (logFlags.verbose) this.stateManager.getAccountFailDump(address, "getLocalOrRemoteCachedAppData: isNodeValidForInternalMessage failed, no retry");
        return null
      }

      const message = { topic, dataId }
      const r: CachedAppData | boolean = await this.p2p.ask(
        randomConsensusNode,
        'get_cached_app_data',
        message
      )
      if (r === false) {
        if (logFlags.error) this.mainLogger.error('ASK FAIL getLocalOrRemoteCachedAppData r === false')
      }

      const result = r as CachedAppData
      if (result != null) {
        return result.appData
      } else {
        if (logFlags.verbose)
          this.stateManager.getAccountFailDump(address, 'remote request missing data: result == null')
      }
    } else {
      // we are local!
      cachedAppData = this.getCachedItem(topic, dataId)
      if (cachedAppData != null) {
        return cachedAppData.appData
      }
    }
    return null
  }
}

export default CachedAppDataManager