import * as Shardus from '../shardus/shardus-types'
import { StateManager as StateManagerTypes } from '@shardus/types'
import * as utils from '../utils'
const stringify = require('fast-stable-stringify')

import Profiler, { cUninitializedSize, profilerInstance } from '../utils/profiler'

//import { SimpleRange } from "./state-manager-types"
import {
  SimpleRange,
  AccountStateHashReq,
  AccountStateHashResp,
  GetAccountStateReq,
  GetAccountData3Req,
  GetAccountDataByRangeSmart,
  GlobalAccountReportResp,
  GetAccountData3Resp,
  CycleShardData,
  QueueEntry,
} from './state-manager-types'
import { nestedCountersInstance } from '../utils/nestedCounters'
import AccountSync from './AccountSync'
import { logFlags } from '../logger'
import { errorToStringFull } from '../utils'
import * as Comms from '../p2p/Comms'
import ShardFunctions from './shardFunctions'
import StateManager from '.'
import { potentiallyRemoved } from '../p2p/NodeList'

/**
 * Help provide a list of nodes that can be used to ask for data
 * Intialize the list and use the dataSourceNode
 * If you need another node to talk to call tryNextDataSourceNode
 */
export default class DataSourceHelper {
  stateManager: StateManager

  dataSourceNode: Shardus.Node
  dataSourceNodeList: Shardus.Node[]
  dataSourceNodeIndex: number

  constructor(stateManager: StateManager) {
    this.stateManager = stateManager
  }

  initWithList(listOfNdoes: Shardus.Node[]) {
    this.dataSourceNodeIndex = 0
    this.dataSourceNode = listOfNdoes[this.dataSourceNodeIndex] // Todo random index
    this.dataSourceNodeList = [...listOfNdoes]
  }

  initByRange(lowAddress: string, highAddress: string) {
    if (this.stateManager.currentCycleShardData == null) {
      return
    }

    let queryLow
    let queryHigh

    queryLow = lowAddress
    queryHigh = highAddress

    let centerNode = ShardFunctions.getCenterHomeNode(this.stateManager.currentCycleShardData.shardGlobals, this.stateManager.currentCycleShardData.parititionShardDataMap, lowAddress, highAddress)
    if (centerNode == null) {
      if (logFlags.error) this.stateManager.mainLogger.error(`getDataSourceNode: centerNode not found`)
      return
    }

    let nodes: Shardus.Node[] = ShardFunctions.getNodesByProximity(
      this.stateManager.currentCycleShardData.shardGlobals,
      this.stateManager.currentCycleShardData.activeNodes,
      centerNode.ourNodeIndex,
      this.stateManager.p2p.id,
      40
    )
    let nodesInProximity = nodes.length
    nodes = nodes.filter(this.removePotentiallyRemovedNodes)
    let filteredNodes1 = nodes.length
    let filteredNodes = []
    for (let node of nodes) {
      let nodeShardData = this.stateManager.currentCycleShardData.nodeShardDataMap.get(node.id)
      if (nodeShardData != null) {
        if (ShardFunctions.testAddressInRange(queryLow, nodeShardData.consensusPartitions) === false) {
          if (logFlags.error) this.stateManager.mainLogger.error(`node cant fit range: queryLow:${queryLow}  ${utils.stringifyReduce(nodeShardData.consensusPartitions)}  `)
          continue
        }
        if (ShardFunctions.testAddressInRange(queryHigh, nodeShardData.consensusPartitions) === false) {
          if (logFlags.error) this.stateManager.mainLogger.error(`node cant fit range: queryHigh:${queryHigh}  ${utils.stringifyReduce(nodeShardData.consensusPartitions)}  `)
          continue
        }
        filteredNodes.push(node)
      }
    }
    nodes = filteredNodes
    let filteredNodes2 = nodes.length
    if (nodes.length > 0) {
      this.dataSourceNode = nodes[Math.floor(Math.random() * nodes.length)]
      //this next line is not an error: comment it out later
      if (logFlags.error)
        this.stateManager.mainLogger.error(`data source nodes found: ${nodes.length}  nodesInProximity:${nodesInProximity} filteredNodes1:${filteredNodes1} filteredNodes2:${filteredNodes2} `)
    } else {
      if (logFlags.error) this.stateManager.mainLogger.error(`no data source nodes found nodesInProximity:${nodesInProximity} filteredNodes1:${filteredNodes1} filteredNodes2:${filteredNodes2} `)
    }
  }

  /**
   * tryNextDataSourceNode
   * @param debugString
   */
  tryNextDataSourceNode(debugString): boolean {
    this.dataSourceNodeIndex++
    if (logFlags.error) this.stateManager.mainLogger.error(`tryNextDataSourceNode ${debugString} try next node: ${this.dataSourceNodeIndex}`)
    if (this.dataSourceNodeIndex >= this.dataSourceNodeList.length) {
      if (logFlags.error) this.stateManager.mainLogger.error(`tryNextDataSourceNode ${debugString} ran out of nodes ask for data`)
      this.dataSourceNodeIndex = 0
      nestedCountersInstance.countEvent('sync', `tryNextDataSourceNode Out of tries: ${this.dataSourceNodeIndex} of ${this.dataSourceNodeList.length} `, 1)
      return false
    }
    nestedCountersInstance.countEvent('sync', `tryNextDataSourceNode next try: ${this.dataSourceNodeIndex} of ${this.dataSourceNodeList.length} `, 1)
    // pick new data source node
    this.dataSourceNode = this.dataSourceNodeList[this.dataSourceNodeIndex]
    return true
  }

  removePotentiallyRemovedNodes(node) {
    return potentiallyRemoved.has(node.id) != true
  }
}
