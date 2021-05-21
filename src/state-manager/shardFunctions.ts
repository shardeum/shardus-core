import { Utils } from 'sequelize/types'
import Logger, {logFlags} from '../logger'
import * as Shardus from '../shardus/shardus-types'

const stringify = require('fast-stable-stringify')

//import {ShardGlobals,ShardInfo,StoredPartition,NodeShardData,AddressRange,HomeNodeSummary,ParititionShardDataMap,NodeShardDataMap,MergeResults,BasicAddressRange } from  './shardFunction2Types'
import { ShardGlobals, ShardInfo, StoredPartition, NodeShardData, AddressRange, HomeNodeSummary, ParititionShardDataMap, NodeShardDataMap, MergeResults, BasicAddressRange } from './shardFunctionTypes'

class ShardFunctions {
  static logger: Logger = null
  static mainLogger: any = null
  static fatalLogger: any = null

  /**
   * calculateShardGlobals
   * @param {number} numNodes
   * @param {number} nodesPerConsenusGroup
   */
  static calculateShardGlobals(numNodes: number, nodesPerConsenusGroup: number, nodesPerEdge: number): ShardGlobals {
    let shardGlobals = {} as ShardGlobals

    if (nodesPerConsenusGroup % 2 === 0) {
      nodesPerConsenusGroup++
      if (logFlags.console) console.log('upgrading consensus size to odd number: ' + nodesPerConsenusGroup)
    }
    //OLD math before "E" became separate term
    // shardGlobals.numActiveNodes = numNodes
    // shardGlobals.nodesPerConsenusGroup = nodesPerConsenusGroup
    // shardGlobals.numPartitions = shardGlobals.numActiveNodes
    // shardGlobals.numVisiblePartitions = 2 * shardGlobals.nodesPerConsenusGroup
    // shardGlobals.consensusRadius = Math.floor((nodesPerConsenusGroup - 1) / 2)
    // let partitionStoreRadius = (((shardGlobals.numVisiblePartitions) / 2) + 0) // removed the +1.0 that was getting added before we divded by two.  also the .5
    // shardGlobals.nodeLookRange = Math.floor((partitionStoreRadius / shardGlobals.numPartitions) * 0xffffffff) // 0.5 added since our search will look from the center of a partition

    //Calculate with E
    shardGlobals.numActiveNodes = numNodes
    shardGlobals.nodesPerConsenusGroup = nodesPerConsenusGroup
    shardGlobals.numPartitions = shardGlobals.numActiveNodes

    shardGlobals.consensusRadius = Math.floor((nodesPerConsenusGroup - 1) / 2)

    // NOT ready for using nodes per edge as an input, so we will force it to a procedural value
    // if(nodesPerEdge == null){
    //   nodesPerEdge = shardGlobals.consensusRadius
    // }
    nodesPerEdge = shardGlobals.consensusRadius
    shardGlobals.nodesPerEdge = nodesPerEdge

    let partitionStoreRadius = shardGlobals.consensusRadius + shardGlobals.nodesPerEdge
    shardGlobals.numVisiblePartitions = shardGlobals.nodesPerConsenusGroup + nodesPerEdge * 2

    shardGlobals.nodeLookRange = Math.floor((partitionStoreRadius / shardGlobals.numPartitions) * 0xffffffff) // 0.5 added since our search will look from the center of a partition

    return shardGlobals
  }

  static leadZeros8(input: string): string {
    return ('00000000' + input).slice(-8)
  }

  static calculateShardValues(shardGlobals: ShardGlobals, address: string): ShardInfo {
    let shardinfo = {} as ShardInfo
    shardinfo.address = address
    shardinfo.homeNodes = []
    shardinfo.addressPrefix = parseInt(address.slice(0, 8), 16)
    shardinfo.addressPrefixHex = ShardFunctions.leadZeros8(shardinfo.addressPrefix.toString(16))
    // old calculation
    //shardinfo.homePartition = Math.floor(shardGlobals.numPartitions * (shardinfo.addressPrefix / 0xffffffff))
    shardinfo.homePartition = ShardFunctions.addressNumberToPartition(shardGlobals, shardinfo.addressPrefix)

    shardinfo.homeRange = ShardFunctions.partitionToAddressRange2(shardGlobals, shardinfo.homePartition)
    shardinfo.coveredBy = {} // consensus nodes that cover us.
    shardinfo.storedBy = {}
    return shardinfo
  }

  static calculateStoredPartitions2(shardGlobals: ShardGlobals, homePartition: number): StoredPartition {
    let storedPartitions = {} as StoredPartition

    storedPartitions.homeRange = ShardFunctions.partitionToAddressRange2(shardGlobals, homePartition)
    // test if we will cover the full range by default
    if (shardGlobals.numPartitions / 2 <= shardGlobals.nodesPerConsenusGroup) {
      storedPartitions.rangeIsSplit = false
      storedPartitions.partitionStart = 0
      storedPartitions.partitionEnd = shardGlobals.numPartitions - 1

      ShardFunctions.calculateStoredPartitions2Ranges(shardGlobals, storedPartitions)
      return storedPartitions
    }

    let x = shardGlobals.nodesPerConsenusGroup
    let n = homePartition
    storedPartitions.x = x // for debug
    storedPartitions.n = n

    storedPartitions.partitionStart = n - x
    storedPartitions.partitionEnd = n + x

    ShardFunctions.calculateStoredPartitions2Ranges(shardGlobals, storedPartitions)

    return storedPartitions
  }

  /**
   * @param {ShardGlobals} shardGlobals
   * @param {StoredPartition} storedPartitions
   */
  static calculateStoredPartitions2Ranges(shardGlobals: ShardGlobals, storedPartitions: StoredPartition) {
    storedPartitions.partitionRangeVector = { start: storedPartitions.partitionStart, dist: 1 + 2 * shardGlobals.nodesPerConsenusGroup, end: storedPartitions.partitionEnd }
    storedPartitions.rangeIsSplit = false

    storedPartitions.partitionsCovered = 0
    if (storedPartitions.partitionStart < 0) {
      storedPartitions.rangeIsSplit = true
      storedPartitions.partitionStart2 = storedPartitions.partitionStart + shardGlobals.numPartitions
      storedPartitions.partitionEnd2 = shardGlobals.numPartitions - 1
      storedPartitions.partitionStart1 = 0
      storedPartitions.partitionEnd1 = storedPartitions.partitionEnd
      storedPartitions.partitionRangeVector.start = storedPartitions.partitionStart2
      storedPartitions.partitionStart = storedPartitions.partitionRangeVector.start
    }
    if (storedPartitions.partitionEnd >= shardGlobals.numPartitions) {
      storedPartitions.rangeIsSplit = true
      storedPartitions.partitionEnd1 = storedPartitions.partitionEnd - shardGlobals.numPartitions
      storedPartitions.partitionStart1 = 0
      storedPartitions.partitionStart2 = storedPartitions.partitionStart
      storedPartitions.partitionEnd2 = shardGlobals.numPartitions - 1
      storedPartitions.partitionRangeVector.end = storedPartitions.partitionEnd1
      storedPartitions.partitionEnd = storedPartitions.partitionRangeVector.end
    }

    if (storedPartitions.partitionEnd < storedPartitions.partitionStart) {
      storedPartitions.rangeIsSplit = true

      storedPartitions.partitionEnd1 = storedPartitions.partitionEnd
      storedPartitions.partitionStart1 = 0
      storedPartitions.partitionStart2 = storedPartitions.partitionStart
      storedPartitions.partitionEnd2 = shardGlobals.numPartitions - 1
      storedPartitions.partitionRangeVector.end = storedPartitions.partitionEnd1
      storedPartitions.partitionEnd = storedPartitions.partitionRangeVector.end
    }

    // need to collapse a split range that covers all partitions?
    if(storedPartitions.rangeIsSplit === true && storedPartitions.partitionEnd1 + 1 === storedPartitions.partitionStart2){
      storedPartitions.rangeIsSplit = false
      storedPartitions.partitionStart = 0
      storedPartitions.partitionEnd = shardGlobals.numPartitions - 1 

      storedPartitions.partitionRangeVector = { start: storedPartitions.partitionStart, dist: 1 + 2 * shardGlobals.nodesPerConsenusGroup, end: storedPartitions.partitionEnd }

    }

    // alias to start and end 1 in the simple case.  sync code expects values for these
    if (storedPartitions.rangeIsSplit === false) {
      storedPartitions.partitionStart1 = storedPartitions.partitionStart
      storedPartitions.partitionEnd1 = storedPartitions.partitionEnd
    }

    // did we wrap to cover the entire range, that should have early outed at the top of the function
    if (storedPartitions.rangeIsSplit === true && (storedPartitions.partitionStart1 === storedPartitions.partitionEnd2 || storedPartitions.partitionStart2 === storedPartitions.partitionEnd1)) {
      throw new Error('this should never happen: ' + stringify(storedPartitions) + 'globals: ' + stringify(shardGlobals))
    }
    if (storedPartitions.rangeIsSplit) {
      if (storedPartitions.partitionStart2 >= 0 && storedPartitions.partitionEnd2 >= 0) {
        storedPartitions.partitionRange = ShardFunctions.partitionToAddressRange2(shardGlobals, storedPartitions.partitionStart1, storedPartitions.partitionEnd1)
        storedPartitions.partitionRange2 = ShardFunctions.partitionToAddressRange2(shardGlobals, storedPartitions.partitionStart2, storedPartitions.partitionEnd2)
        storedPartitions.partitionsCovered = 2 + (storedPartitions.partitionEnd1 - storedPartitions.partitionStart1) + (storedPartitions.partitionEnd2 - storedPartitions.partitionStart2)
      } else {
        throw new Error('missing ranges in storedPartitions 1')
      }
    } else {
      storedPartitions.partitionRange = ShardFunctions.partitionToAddressRange2(shardGlobals, storedPartitions.partitionStart, storedPartitions.partitionEnd)
      if (storedPartitions.partitionStart1 >= 0 && storedPartitions.partitionEnd1 >= 0) {
        storedPartitions.partitionsCovered = 1 + (storedPartitions.partitionEnd1 - storedPartitions.partitionStart1)
      } else {
        // throw new Error('missing ranges in storedPartitions 2')
        throw new Error(`missing ranges in storedPartitions 2b  ${storedPartitions.partitionStart1} ${storedPartitions.partitionEnd1} ${stringify(storedPartitions)}`)
      }
    }
    // if (storedPartitions.partitionsCovered <= 2) {
    //   let a = 1
    //   a++
    // }
  }

  static testAddressInRange(address: string, storedPartitions: StoredPartition): boolean {
    if (storedPartitions.rangeIsSplit) {
      if (
        (address >= storedPartitions.partitionRange.low && address <= storedPartitions.partitionRange.high) ||
        (address >= storedPartitions.partitionRange2.low && address <= storedPartitions.partitionRange2.high)
      ) {
        return true
      }
    } else {
      if (address >= storedPartitions.partitionRange.low && address <= storedPartitions.partitionRange.high) {
        return true
      }
    }
    return false
  }

  static testAddressNumberInRange(address: number, storedPartitions: StoredPartition): boolean {
    if (storedPartitions.rangeIsSplit) {
      if (
        (address >= storedPartitions.partitionRange.startAddr && address <= storedPartitions.partitionRange.endAddr) ||
        (address >= storedPartitions.partitionRange2.startAddr && address <= storedPartitions.partitionRange2.endAddr)
      ) {
        return true
      }
    } else {
      if (address >= storedPartitions.partitionRange.startAddr && address <= storedPartitions.partitionRange.endAddr) {
        return true
      }
    }
    return false
  }

  static testInRange(partition: number, storedPartitions: StoredPartition): boolean {
    if (storedPartitions.rangeIsSplit) {
      if (
        (partition >= storedPartitions.partitionStart1 && partition <= storedPartitions.partitionEnd1) ||
        (partition >= storedPartitions.partitionStart2 && partition <= storedPartitions.partitionEnd2)
      ) {
        return true
      }
    } else {
      if (partition >= storedPartitions.partitionStart && partition <= storedPartitions.partitionEnd) {
        return true
      }
    }
    return false
  }

  static getPartitionsCovered(storedPartitions: StoredPartition): number {
    let covered = 0
    if (storedPartitions.rangeIsSplit === true) {
      covered = 2 + (storedPartitions.partitionEnd2 - storedPartitions.partitionStart2) + (storedPartitions.partitionEnd1 - storedPartitions.partitionStart1)
    } else {
      covered = 1 + storedPartitions.partitionEnd - storedPartitions.partitionStart
    }
    if (covered < 20) {
      covered += 0
    }

    return covered
  }

  static computePartitionShardDataMap(shardGlobals: ShardGlobals, parititionShardDataMap: ParititionShardDataMap, partitionStart: number, partitionsToScan: number) {
    let partitionIndex = partitionStart

    let numPartitions = shardGlobals.numPartitions

    for (let i = 0; i < partitionsToScan; ++i) {
      if (partitionIndex >= numPartitions) {
        partitionIndex = 0
      }
      let fpAdressCenter = (i + 0.5) / numPartitions
      let addressPrefix = Math.floor(fpAdressCenter * 0xffffffff)

      let addressPrefixHex = ShardFunctions.leadZeros8(addressPrefix.toString(16))
      let address = addressPrefixHex + '7' + 'f'.repeat(55) // 55 + 1 + 8 = 64

      let shardinfo = ShardFunctions.calculateShardValues(shardGlobals, address)
      parititionShardDataMap.set(i, shardinfo)
      // increment index:
      partitionIndex++
      if (partitionIndex === partitionStart) {
        break // we looped
      }
    }
  }

  static computeNodePartitionDataMap(
    shardGlobals: ShardGlobals,
    nodeShardDataMap: NodeShardDataMap,
    nodesToGenerate: Shardus.Node[],
    parititionShardDataMap: ParititionShardDataMap,
    activeNodes: Shardus.Node[],
    extendedData: boolean
  ) {
    for (let node of nodesToGenerate) {
      let nodeShardData = nodeShardDataMap.get(node.id)
      if (!nodeShardData) {
        nodeShardData = ShardFunctions.computeNodePartitionData(shardGlobals, node, nodeShardDataMap, parititionShardDataMap, activeNodes, false)
      }
    }
    // second pass for extended data
    for (let node of nodesToGenerate) {
      let nodeShardData = nodeShardDataMap.get(node.id)
      if (nodeShardData == null) {
        //log error?
        continue
      }

      if (extendedData) {
        ShardFunctions.computeExtendedNodePartitionData(shardGlobals, nodeShardDataMap, parititionShardDataMap, nodeShardData, activeNodes)
      }
    }
  }

  static computeNodePartitionDataMapExt(
    shardGlobals: ShardGlobals,
    nodeShardDataMap: NodeShardDataMap,
    nodesToGenerate: Shardus.Node[],
    parititionShardDataMap: ParititionShardDataMap,
    activeNodes: Shardus.Node[]
  ) {
    // for (let node of nodesToGenerate) {
    //   let nodeShardData = nodeShardDataMap.get(node.id)
    //   if (!nodeShardData) {
    //     nodeShardData = ShardFunctions.computeNodePartitionData(shardGlobals, node, nodeShardDataMap, parititionShardDataMap, activeNodes)
    //   }
    //   // ShardFunctions.computeExtendedNodePartitionData(shardGlobals, nodeShardDataMap, parititionShardDataMap, nodeShardData, activeNodes)
    //   //
    //   // this wont be able to extend things though.
    //   ShardFunctions.updateFullConsensusGroup(shardGlobals, nodeShardDataMap, parititionShardDataMap, nodeShardData, activeNodes)
    // }
  }

  static computeNodePartitionData(
    shardGlobals: ShardGlobals,
    node: Shardus.Node,
    nodeShardDataMap: NodeShardDataMap,
    parititionShardDataMap: ParititionShardDataMap,
    activeNodes: Shardus.Node[],
    extendedData?: boolean
  ): NodeShardData {
    let numPartitions = shardGlobals.numPartitions

    let nodeShardData = {} as NodeShardData

    nodeShardData.ourNodeIndex = activeNodes.findIndex(function (_node) {
      return _node.id === node.id
    })

    if (nodeShardData.ourNodeIndex === -1) {
      //todo node is syncing need to find closest index.
      for (let i = 0; i < activeNodes.length; i++) {
        nodeShardData.ourNodeIndex = i
        if (activeNodes[i].id >= node.id) {
          break
        }
      }
    }

    let homePartition = nodeShardData.ourNodeIndex
    let centeredAddress = Math.floor(((homePartition + 0.5) * 0xffffffff) / numPartitions)
    let nodeAddressNum = centeredAddress

    nodeShardData.node = node
    nodeShardData.nodeAddressNum = nodeAddressNum
    nodeShardData.homePartition = homePartition
    nodeShardData.centeredAddress = centeredAddress

    nodeShardData.consensusStartPartition = homePartition
    nodeShardData.consensusEndPartition = homePartition

    nodeShardData.patchedOnNodes = []

    // push the data in to the correct homenode list for the home partition
    let partitionShard = parititionShardDataMap.get(homePartition)
    if (partitionShard == null) {
      partitionShard = parititionShardDataMap.get(homePartition)
    }

    if (partitionShard == null) {
      throw new Error(`computeNodePartitionData: cant find partitionShard for index:${nodeShardData.ourNodeIndex} size:${parititionShardDataMap.size} activeNodes:${activeNodes.length}  `)
    }

    if (nodeShardData.ourNodeIndex !== -1) {
      partitionShard.homeNodes = []
      partitionShard.homeNodes.push(nodeShardData)
    }

    nodeShardData.extendedData = false
    if (extendedData) {
      ShardFunctions.computeExtendedNodePartitionData(shardGlobals, nodeShardDataMap, parititionShardDataMap, nodeShardData, activeNodes)
    }

    // set the data in our map
    nodeShardDataMap.set(node.id, nodeShardData)
    nodeShardData.needsUpdateToFullConsensusGroup = true

    return nodeShardData
  }

  //   static updateFullConsensusGroup (shardGlobals: ShardGlobals, nodeShardDataMap: NodeShardDataMap, parititionShardDataMap: ParititionShardDataMap, nodeShardData: NodeShardData, activeNodes: Shardus.Node[]) {
  //     let homePartition = nodeShardData.homePartition
  //     let shardPartitionData = parititionShardDataMap.get(homePartition)

  //     if(shardPartitionData == null){
  //       throw new Error('updateFullConsensusGroup: shardPartitionData==null')
  //     }

  //     nodeShardData.consensusNodeForOurNodeFull = Object.values(shardPartitionData.coveredBy)
  //     nodeShardData.needsUpdateToFullConsensusGroup = false
  //     nodeShardData.consensusNodeForOurNodeFull.sort(ShardFunctions.nodeSortAsc)

  //     // merge into our full list for sake of TX calcs.  todo could try to be smart an only do this in some cases.
  //     // let [results] = ShardFunctions.mergeNodeLists(nodeShardData.nodeThatStoreOurParition, nodeShardData.consensusNodeForOurNodeFull)
  //     // switched nodeThatStoreOurParition to nodeThatStoreOurParitionFull to improve the quality of the results.
  //     let [results] = ShardFunctions.mergeNodeLists(nodeShardData.nodeThatStoreOurParitionFull, nodeShardData.consensusNodeForOurNodeFull)

  //     // not sure if we need to do this
  //     // if (extras.length > 0) {
  //     //   ShardFunctions.dilateNeighborCoverage(shardGlobals, nodeShardDataMap, parititionShardDataMap, activeNodes, nodeShardData, extras)
  //     // }

  //     nodeShardData.nodeThatStoreOurParitionFull = results
  //     nodeShardData.nodeThatStoreOurParitionFull.sort(ShardFunctions.nodeSortAsc)
  //   }

  /**
   * @param {ShardGlobals} shardGlobals
   * @param {Map<string, NodeShardData>} nodeShardDataMap
   * @param {Map<number, ShardInfo>} parititionShardDataMap
   * @param {NodeShardData} nodeShardData
   * @param {Node[]} activeNodes
   */
  static computeExtendedNodePartitionData(
    shardGlobals: ShardGlobals,
    nodeShardDataMap: NodeShardDataMap,
    parititionShardDataMap: ParititionShardDataMap,
    nodeShardData: NodeShardData,
    activeNodes: Shardus.Node[]
  ) {
    if (nodeShardData.extendedData) {
      return
    }

    nodeShardData.extendedData = true
    if (nodeShardData.storedPartitions == null) {
      nodeShardData.storedPartitions = ShardFunctions.calculateStoredPartitions2(shardGlobals, nodeShardData.homePartition)
    }

    let nodeIsActive = nodeShardData.ourNodeIndex !== -1
    let exclude = [nodeShardData.node.id]
    let excludeNodeArray = [nodeShardData.node]

    // tried a better way but it dies of needing data we dont have yet..
    nodeShardData.nodeThatStoreOurParition = ShardFunctions.getNodesThatCoverParitionRaw(shardGlobals, nodeShardDataMap, nodeShardData.homePartition, exclude, activeNodes)
    // nodeShardData.nodeThatStoreOurParition = ShardFunctions.getNodesThatCoverRange(shardGlobals, nodeShardData.storedPartitions.homeRange.low, nodeShardData.storedPartitions.homeRange.high, exclude, activeNodes)

    // check if node is active because there are many calculations that are invalid or wrong if you try to compute them with a node that is not active in the network.
    // This is because consenus calcualtions are based on distance to other active nodes.
    if (nodeIsActive) {
      nodeShardData.consensusNodeForOurNode = ShardFunctions.getNeigborNodesInRange(nodeShardData.ourNodeIndex, shardGlobals.consensusRadius, exclude, activeNodes)
      nodeShardData.consensusNodeForOurNodeFull = ShardFunctions.getNeigborNodesInRange(nodeShardData.ourNodeIndex, shardGlobals.consensusRadius, [], activeNodes)

      // calcuate partition range for consensus
      // note we must use consensusNodeForOurNodeFull because consensusNodeForOurNode is not our node,
      //     but our node could be at the front or back of the not wrapped list of nodes.
      //     if we left our node out then it would truncate the consensus range
      if (nodeShardData.consensusNodeForOurNodeFull.length >= 2) {
        // this logic only works because we know that getNeigborNodesInRange starts at the starting point
        let startNode = nodeShardData.consensusNodeForOurNodeFull[0]
        let endNode = nodeShardData.consensusNodeForOurNodeFull[nodeShardData.consensusNodeForOurNodeFull.length - 1]

        let startPartition = nodeShardDataMap.get(startNode.id).homePartition
        let endPartition = nodeShardDataMap.get(endNode.id).homePartition

        // special case when there are very small networks and the consensus range should wrap around.
        if (startPartition === endPartition && startNode.id > endNode.id) {
          startPartition = 0
          endPartition = shardGlobals.numPartitions - 1
        }

        nodeShardData.consensusStartPartition = startPartition
        nodeShardData.consensusEndPartition = endPartition
      }

      //update covered by list
      if (nodeShardData.consensusStartPartition <= nodeShardData.consensusEndPartition) {
        for (let i = nodeShardData.consensusStartPartition; i <= nodeShardData.consensusEndPartition; i++) {
          let shardPartitionData = parititionShardDataMap.get(i)
          if (shardPartitionData == null) {
            throw new Error('computeExtendedNodePartitionData: shardPartitionData==null 1')
          }
          shardPartitionData.coveredBy[nodeShardData.node.id] = nodeShardData.node // { idx: nodeShardData.ourNodeIndex }
        }
      } else {
        for (let i = 0; i <= nodeShardData.consensusEndPartition; i++) {
          let shardPartitionData = parititionShardDataMap.get(i)
          if (shardPartitionData == null) {
            throw new Error('computeExtendedNodePartitionData: shardPartitionData==null 2')
          }
          shardPartitionData.coveredBy[nodeShardData.node.id] = nodeShardData.node // { idx: nodeShardData.ourNodeIndex }
        }
        for (let i = nodeShardData.consensusStartPartition; i < shardGlobals.numPartitions; i++) {
          let shardPartitionData = parititionShardDataMap.get(i)
          if (shardPartitionData == null) {
            throw new Error('computeExtendedNodePartitionData: shardPartitionData==null 3')
          }
          shardPartitionData.coveredBy[nodeShardData.node.id] = nodeShardData.node // { idx: nodeShardData.ourNodeIndex }
        }
      }

      // this list is a temporary list that counts as 2c range.  Stored nodes are the merged max of 2c range (2r on each side) and node in the 2c partition range
      nodeShardData.c2NodeForOurNode = ShardFunctions.getNeigborNodesInRange(nodeShardData.ourNodeIndex, 2 * shardGlobals.consensusRadius, exclude, activeNodes)

      let [results, extras] = ShardFunctions.mergeNodeLists(nodeShardData.nodeThatStoreOurParition, nodeShardData.c2NodeForOurNode)

      nodeShardData.nodeThatStoreOurParitionFull = results
      nodeShardData.outOfDefaultRangeNodes = extras

      nodeShardData.edgeNodes = ShardFunctions.subtractNodeLists(nodeShardData.nodeThatStoreOurParitionFull, nodeShardData.consensusNodeForOurNode)
      nodeShardData.edgeNodes = ShardFunctions.subtractNodeLists(nodeShardData.edgeNodes, excludeNodeArray) // remove ourself!

      if (extras.length > 0) {
        //ShardFunctions.dilateNeighborCoverage(shardGlobals, nodeShardDataMap, parititionShardDataMap, activeNodes, nodeShardData, extras)
        //can get rid of some of the above merge logic if this never shows up in testing
        let message = `computeExtendedNodePartitionData: failed`
        try {
          let list1 = nodeShardData.nodeThatStoreOurParition.map((n) => n.id.substring(0, 5))
          let list2 = nodeShardData.nodeThatStoreOurParition.map((n) => n.id.substring(0, 5))
          let extraLists = extras.map((n) => n.id.substring(0, 5))
          message = `computeExtendedNodePartitionData: should never have extras. node:${nodeShardData.node.id.substring(0, 5)} ${stringify({ list1, list2, extraLists })}`
        } catch (ex) {
          this.fatalLogger.fatal('computeExtendedNodePartitionData: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack)
        }
        if (ShardFunctions.fatalLogger) {
          ShardFunctions.fatalLogger.fatal(message)
        }

        // throw new Error(message)
      }
      nodeShardData.edgeNodes.sort(ShardFunctions.nodeSortAsc)
      nodeShardData.consensusNodeForOurNodeFull.sort(ShardFunctions.nodeSortAsc)
      nodeShardData.nodeThatStoreOurParitionFull.sort(ShardFunctions.nodeSortAsc)
    } else {
      nodeShardData.consensusNodeForOurNode = []
      nodeShardData.consensusNodeForOurNodeFull = []
      nodeShardData.c2NodeForOurNode = []

      nodeShardData.nodeThatStoreOurParitionFull = nodeShardData.nodeThatStoreOurParition.slice(0)
      nodeShardData.outOfDefaultRangeNodes = []
      nodeShardData.edgeNodes = nodeShardData.nodeThatStoreOurParitionFull.slice(0) // just dupe the stored list.
      nodeShardData.edgeNodes = ShardFunctions.subtractNodeLists(nodeShardData.edgeNodes, excludeNodeArray) // remove ourself!

      nodeShardData.edgeNodes.sort(ShardFunctions.nodeSortAsc)
      nodeShardData.consensusNodeForOurNodeFull.sort(ShardFunctions.nodeSortAsc)
      nodeShardData.nodeThatStoreOurParitionFull.sort(ShardFunctions.nodeSortAsc)
    }

    // storedBy
    if (nodeShardData.storedPartitions.rangeIsSplit === false) {
      for (let i = nodeShardData.storedPartitions.partitionStart; i <= nodeShardData.storedPartitions.partitionEnd; i++) {
        let shardPartitionData = parititionShardDataMap.get(i)
        if (shardPartitionData == null) {
          throw new Error('computeExtendedNodePartitionData: shardPartitionData==null 4')
        }
        shardPartitionData.storedBy[nodeShardData.node.id] = nodeShardData.node // { idx: nodeShardData.ourNodeIndex }
      }
    } else {
      for (let i = 0; i <= nodeShardData.storedPartitions.partitionEnd; i++) {
        let shardPartitionData = parititionShardDataMap.get(i)
        if (shardPartitionData == null) {
          throw new Error('computeExtendedNodePartitionData: shardPartitionData==null 5')
        }
        shardPartitionData.storedBy[nodeShardData.node.id] = nodeShardData.node // { idx: nodeShardData.ourNodeIndex }
      }
      for (let i = nodeShardData.storedPartitions.partitionStart; i < shardGlobals.numPartitions; i++) {
        let shardPartitionData = parititionShardDataMap.get(i)
        if (shardPartitionData == null) {
          throw new Error('computeExtendedNodePartitionData: shardPartitionData==null 6')
        }
        shardPartitionData.storedBy[nodeShardData.node.id] = nodeShardData.node // { idx: nodeShardData.ourNodeIndex }
      }
    }
  }

  static nodeSortAsc(a: Shardus.Node, b: Shardus.Node) {
    return a.id === b.id ? 0 : a.id < b.id ? -1 : 1
  }

  /**
   * getConsenusPartitions
   * @param {ShardGlobals} shardGlobals
   * @param {NodeShardData} nodeShardData the node we want to get a list of consensus partions from
   * @returns {number[]} a list of partitions
   */
  static getConsenusPartitionList(shardGlobals: ShardGlobals, nodeShardData: NodeShardData): number[] {
    let consensusPartitions = [] as number[]
    if (nodeShardData.consensusStartPartition <= nodeShardData.consensusEndPartition) {
      for (let i = nodeShardData.consensusStartPartition; i <= nodeShardData.consensusEndPartition; i++) {
        consensusPartitions.push(i)
      }
    } else {
      for (let i = 0; i <= nodeShardData.consensusEndPartition; i++) {
        consensusPartitions.push(i)
      }
      for (let i = nodeShardData.consensusStartPartition; i < shardGlobals.numPartitions; i++) {
        consensusPartitions.push(i)
      }
    }
    return consensusPartitions
  }

  /**
   * getStoredPartitions
   * @param {ShardGlobals} shardGlobals
   * @param {NodeShardData} nodeShardData the node we want to get a list of consensus partions from
   * @returns {number[]} a list of partitions
   */
  static getStoredPartitionList(shardGlobals: ShardGlobals, nodeShardData: NodeShardData): number[] {
    let storedPartitionList = [] as number[]
    if (nodeShardData.storedPartitions.partitionStart <= nodeShardData.storedPartitions.partitionEnd) {
      for (let i = nodeShardData.storedPartitions.partitionStart; i <= nodeShardData.storedPartitions.partitionEnd; i++) {
        storedPartitionList.push(i)
      }
    } else {
      for (let i = 0; i <= nodeShardData.storedPartitions.partitionEnd; i++) {
        storedPartitionList.push(i)
      }
      for (let i = nodeShardData.storedPartitions.partitionStart; i < shardGlobals.numPartitions; i++) {
        storedPartitionList.push(i)
      }
    }
    return storedPartitionList
  }

  //  a=old, b=new
  static setOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
    return !(bStart >= aEnd || bEnd <= aStart)
  }

  static setEpanded(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
    return bStart < aStart || bEnd > aEnd
  }

  static setEpandedLeft(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
    return bStart < aStart
  }
  static setEpandedRight(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
    return bEnd > aEnd
  }
  //  a=old, b=new
  static setShrink(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
    return (bStart > aStart && bStart < aEnd) || (bEnd > aStart && bEnd < aEnd)
  }

  // static setErrors (aStart, aEnd, bStart, bEnd) {
  //   return !((aStart < aEnd) && (bStart < bEnd))
  // }
  // const cSetNoOverlapIfGTE = 16
  // const cSetSuperIfGTE = 4
  // const cSetEqualIfEQ = 0
  // const cSetSuperLeftMask = 8
  // const cSetSuperRightMask = 4

  // overshoot.

  // calculate this for self and neighbor nodes!!  how far to scan into neighors. // oldShardData_shardGlobals, newSharddata_shardGlobals,

  // TSConversion  fix up any[]
  static computeCoverageChanges(oldShardDataNodeShardData: NodeShardData, newSharddataNodeShardData: NodeShardData): { start: number; end: number }[] {
    let coverageChanges = [] as { start: number; end: number }[]

    let oldStoredPartitions = oldShardDataNodeShardData.storedPartitions
    let newStoredPartitions = newSharddataNodeShardData.storedPartitions

    // let d1s = 0
    // let d1e = 0
    // let d2s = 0
    // let d2e = 0
    // calcs will all be in integers and assume we have 0000s for start ranges and ffffs for end ranges.
    if (oldStoredPartitions.rangeIsSplit) {
      if (newStoredPartitions.rangeIsSplit) {
        // OLD:  [xxxxx-----------------------xx]
        // NEW:  [xxxxxxx-------------------xxxx]

        // partitionRange, partitionRange2
        let oldStart1 = oldStoredPartitions.partitionRange.startAddr
        let oldEnd1 = oldStoredPartitions.partitionRange.endAddr

        let newStart1 = newStoredPartitions.partitionRange.startAddr
        let newEnd1 = newStoredPartitions.partitionRange.endAddr

        // d1s = newStart1 - oldStart1
        // d1e = newEnd1 - oldEnd1

        let oldStart2 = oldStoredPartitions.partitionRange2.startAddr
        let oldEnd2 = oldStoredPartitions.partitionRange2.endAddr

        let newStart2 = newStoredPartitions.partitionRange2.startAddr
        let newEnd2 = newStoredPartitions.partitionRange2.endAddr

        // d2s = newStart2 - oldStart2
        // d2e = newEnd2 - oldEnd2

        if (oldStart1 >= oldEnd1 || oldStart2 >= oldEnd2 || newStart1 >= newEnd1 || newStart2 >= newEnd2) {
          throw new Error('invalid ranges')
        }

        if (ShardFunctions.setOverlap(oldStart1, oldEnd1, newStart1, newEnd1)) {
          if (ShardFunctions.setEpandedLeft(oldStart1, oldEnd1, newStart1, newEnd1)) {
            coverageChanges.push({ start: newStart1, end: oldStart1 })
          }
          if (ShardFunctions.setEpandedRight(oldStart1, oldEnd1, newStart1, newEnd1)) {
            coverageChanges.push({ start: oldEnd1, end: newEnd1 })
          }
        }

        if (ShardFunctions.setOverlap(oldStart2, oldEnd2, newStart2, newEnd2)) {
          if (ShardFunctions.setEpandedLeft(oldStart2, oldEnd2, newStart2, newEnd2)) {
            coverageChanges.push({ start: newStart2, end: oldStart2 })
          }
          if (ShardFunctions.setEpandedRight(oldStart2, oldEnd2, newStart2, newEnd2)) {
            coverageChanges.push({ start: oldEnd2, end: newEnd2 })
          }
        }
      } else {
        // old is split, new is single
        //  node this is not all cass.
        // case 1:
        // OLD:  [xxxxxxxxxxxx--------------xx]
        // NEW:  [----xxxxxxxx----------------]
        // case 2:
        // OLD:  [xxx---------------xxxxxxxxxx]
        // NEW:  [------------------xxxxxxxx--]
        // case 3:
        // OLD:  [xxx-------------xxxxxxxxxxxx]
        // NEW:  [------------------xxxxxxxx--]
        // case 4:  overlaps both new sets...  compare to both..
        // OLD:  [xxx-------------xxxxxxxxxxxx]
        // NEW:  [--xxxxxxxxxxxxxxxxxxxxxxxx--]
        //          post pass.  need to not overlap expanded areas.
        //
        let oldStart1 = oldStoredPartitions.partitionRange.startAddr
        let oldEnd1 = oldStoredPartitions.partitionRange.endAddr
        let oldStart2 = oldStoredPartitions.partitionRange2.startAddr
        let oldEnd2 = oldStoredPartitions.partitionRange2.endAddr

        let newStart1 = newStoredPartitions.partitionRange.startAddr
        let newEnd1 = newStoredPartitions.partitionRange.endAddr

        if (oldStart1 >= oldEnd1 || oldStart2 >= oldEnd2 || newStart1 >= newEnd1) {
          throw new Error('invalid ranges')
        }

        // Test overlaps first, need permutations
        // Then can get differences.
        // If no overlap then entire value is a difference.

        if (ShardFunctions.setOverlap(oldStart1, oldEnd1, newStart1, newEnd1)) {
          if (ShardFunctions.setEpandedLeft(oldStart1, oldEnd1, newStart1, newEnd1)) {
            coverageChanges.push({ start: newStart1, end: oldStart1 })
          }
          if (ShardFunctions.setEpandedRight(oldStart1, oldEnd1, newStart1, newEnd1)) {
            coverageChanges.push({ start: oldEnd1, end: newEnd1 })
          }
        } else if (ShardFunctions.setOverlap(oldStart2, oldEnd2, newStart1, newEnd1)) {
          // TODO I am not sure if else-if is correct also these calculations can make results that overlap the old range.
          // the overlap gets corrected in the post process, because that was a faster way to feel certain
          if (ShardFunctions.setEpandedLeft(oldStart2, oldEnd2, newStart1, newEnd1)) {
            coverageChanges.push({ start: newStart1, end: oldStart2 })
          }
          if (ShardFunctions.setEpandedRight(oldStart2, oldEnd2, newStart1, newEnd1)) {
            coverageChanges.push({ start: oldEnd2, end: newEnd1 })
          }
        }
      }
    } else {
      if (newStoredPartitions.rangeIsSplit) {
        // old is single, new is split
        //  node this is not all cass.
        // case 1:
        // OLD:  [----xxxxxxxx----------------]
        // NEW:  [xxxxxxxxxxxx--------------xx]
        // case 2:
        // OLD:  [------------------xxxxxxxx--]
        // NEW:  [xxx---------------xxxxxxxxxx]
        // case 3:  expansion in both directions.
        // OLD:  [------------------xxxxxxxx--]
        // NEW:  [xxx-------------xxxxxxxxxxxx]
        // case 4:  overlaps both new sets...  compare to both..
        // OLD:  [--xxxxxxxxxxxxxxxxxxxxxxxx--]
        // NEW:  [xxx-------------xxxxxxxxxxxx]
        let oldStart1 = oldStoredPartitions.partitionRange.startAddr
        let oldEnd1 = oldStoredPartitions.partitionRange.endAddr

        let newStart1 = newStoredPartitions.partitionRange.startAddr
        let newEnd1 = newStoredPartitions.partitionRange.endAddr
        let newStart2 = newStoredPartitions.partitionRange2.startAddr
        let newEnd2 = newStoredPartitions.partitionRange2.endAddr

        if (oldStart1 >= oldEnd1 || newStart1 >= newEnd1 || newStart2 >= newEnd2) {
          throw new Error('invalid ranges')
        }
        // d1s = newStart1 - oldStart1
        // d1e = newEnd1 - oldEnd1

        // d2s = newStart2 - oldStart2
        // d2e = newEnd2 - oldEnd2

        // Test overlaps first, need permutations
        // Then can get differences.
        // If no overlap then entire value is a difference.

        if (ShardFunctions.setOverlap(oldStart1, oldEnd1, newStart1, newEnd1)) {
          if (ShardFunctions.setEpandedLeft(oldStart1, oldEnd1, newStart1, newEnd1)) {
            coverageChanges.push({ start: newStart1, end: oldStart1 })
          }
          if (ShardFunctions.setEpandedRight(oldStart1, oldEnd1, newStart1, newEnd1)) {
            coverageChanges.push({ start: oldEnd1, end: newEnd1 })
          }
        }

        if (ShardFunctions.setOverlap(oldStart1, oldEnd1, newStart2, newEnd2)) {
          if (ShardFunctions.setEpandedLeft(oldStart1, oldEnd1, newStart2, newEnd2)) {
            coverageChanges.push({ start: newStart2, end: oldStart1 })
          }
          if (ShardFunctions.setEpandedRight(oldStart1, oldEnd1, newStart2, newEnd2)) {
            coverageChanges.push({ start: oldEnd1, end: newEnd2 })
          }
        }
      } else {
        // partitionRange

        let oldStart1 = oldStoredPartitions.partitionRange.startAddr
        let oldEnd1 = oldStoredPartitions.partitionRange.endAddr

        let newStart1 = newStoredPartitions.partitionRange.startAddr
        let newEnd1 = newStoredPartitions.partitionRange.endAddr

        // d1s = newStart1 - oldStart1
        // d1e = newEnd1 - oldEnd1

        if (oldStart1 >= oldEnd1 || newStart1 >= newEnd1) {
          throw new Error('invalid ranges')
        }

        if (ShardFunctions.setOverlap(oldStart1, oldEnd1, newStart1, newEnd1)) {
          if (ShardFunctions.setEpandedLeft(oldStart1, oldEnd1, newStart1, newEnd1)) {
            coverageChanges.push({ start: newStart1, end: oldStart1 })
          }
          if (ShardFunctions.setEpandedRight(oldStart1, oldEnd1, newStart1, newEnd1)) {
            coverageChanges.push({ start: oldEnd1, end: newEnd1 })
          }
        }
      }
    }

    if(coverageChanges.length === 0){
      return coverageChanges
    }

    let oldStart1 = oldStoredPartitions.partitionRange.startAddr
    let oldEnd1 = oldStoredPartitions.partitionRange.endAddr
    let oldStart2 = oldStoredPartitions.partitionRange2?.startAddr
    let oldEnd2 = oldStoredPartitions.partitionRange2?.endAddr

    let finalChanges = []
    // post process our coverage changes.  If any of our old range overlaps subtract out the old range
    for(let coverageChange of coverageChanges){

      if (ShardFunctions.setOverlap(oldStart1, oldEnd1, coverageChange.start, coverageChange.end)){
        if(oldStart1 <= coverageChange.start){
          coverageChange.start = oldEnd1
        }
        if(oldEnd1 >= coverageChange.end){
          coverageChange.end = oldStart1
        }
        if(coverageChange.start >= coverageChange.end){
          continue
        }
      }
      if(oldStoredPartitions.rangeIsSplit){
        if (ShardFunctions.setOverlap(oldStart2, oldEnd2, coverageChange.start, coverageChange.end)){
          if(oldStart2 <= coverageChange.start){
            coverageChange.start = oldEnd2
          }
          if(oldEnd2 >= coverageChange.end){
            coverageChange.end = oldStart2
          }
          if(coverageChange.start >= coverageChange.end){
            continue
          }
        }      
      }

      finalChanges.push(coverageChange)
    }

    return finalChanges
    // this needs to understande address ranges.

    // should it also understand changed in what partitions are covered.
    // oldShardData_nodeShardData

    // calculate new and edge partitions?   then calculate change between partitions? --- NO!
  }

  static getHomeNodeSummaryObject(nodeShardData: NodeShardData): HomeNodeSummary {
    if (nodeShardData.extendedData === false) {
      return { noExtendedData: true, edge: [], consensus: [], storedFull: [] } as HomeNodeSummary
    }
    let result = { edge: [], consensus: [], storedFull: [] } as HomeNodeSummary

    for (let node of nodeShardData.edgeNodes) {
      result.edge.push(node.id)
    }
    for (let node of nodeShardData.consensusNodeForOurNodeFull) {
      result.consensus.push(node.id)
    }
    for (let node of nodeShardData.nodeThatStoreOurParitionFull) {
      result.storedFull.push(node.id)
    }

    result.edge.sort(function (a, b) {
      return a === b ? 0 : a < b ? -1 : 1
    })
    result.consensus.sort(function (a, b) {
      return a === b ? 0 : a < b ? -1 : 1
    })
    result.storedFull.sort(function (a, b) {
      return a === b ? 0 : a < b ? -1 : 1
    })
    return result
  }

  static getNodeRelation(nodeShardData: NodeShardData, nodeId: string) {
    if (nodeShardData.extendedData === false) {
      return 'failed, no extended data'
    }
    let result = ''
    if (nodeShardData.node.id === nodeId) {
      result = 'home, '
    }

    for (let node of nodeShardData.nodeThatStoreOurParitionFull) {
      if (node.id === nodeId) {
        result += 'stored,'
      }
    }

    for (let node of nodeShardData.edgeNodes) {
      if (node.id === nodeId) {
        result += 'edge,'
      }
    }

    for (let node of nodeShardData.consensusNodeForOurNodeFull) {
      if (node.id === nodeId) {
        result += 'consensus,'
      }
    }
    return result
  }

  static addressToPartition(shardGlobals: ShardGlobals, address: string): { homePartition: number; addressNum: number } {
    let numPartitions = shardGlobals.numPartitions
    let addressNum = parseInt(address.slice(0, 8), 16)

    // 2^32  4294967296 or 0xFFFFFFFF + 1
    let size = Math.round((0xffffffff + 1) / numPartitions)
    let homePartition = Math.floor(addressNum / size)
    if (homePartition === numPartitions) {
      homePartition = homePartition - 1
    }

    return { homePartition, addressNum }
  }

  static addressNumberToPartition(shardGlobals: ShardGlobals, addressNum: number): number {
    let numPartitions = shardGlobals.numPartitions
    // 2^32  4294967296 or 0xFFFFFFFF + 1
    let size = Math.round((0xffffffff + 1) / numPartitions)
    let preround = addressNum / size
    let homePartition = Math.floor(addressNum / size)
    let asdf = preround
    if (homePartition === numPartitions) {
      homePartition = homePartition - 1
    }

    return homePartition
  }

  static findHomeNode(shardGlobals: ShardGlobals, address: string, parititionShardDataMap: Map<number, ShardInfo>): NodeShardData | null {
    let { homePartition, addressNum } = ShardFunctions.addressToPartition(shardGlobals, address)
    let partitionShard = parititionShardDataMap.get(homePartition)

    if (partitionShard == null) {
      return null
    }
    if (partitionShard.homeNodes.length === 0) {
      return null
    }
    return partitionShard.homeNodes[0]
  }

  static circularDistance(a: number, b: number, max: number): number {
    let directDist = Math.abs(a - b)
    let wrapDist = directDist
    // if (a < b) {
    //   wrapDist = Math.abs(a + (max - b))
    // } else if (b < a) {
    //   wrapDist = Math.abs(b + (max - a))
    // }
    let wrapDist1 = Math.abs(a + (max - b))
    let wrapDist2 = Math.abs(b + (max - a))
    wrapDist = Math.min(wrapDist1, wrapDist2)

    return Math.min(directDist, wrapDist)
  }

  // should be able to get rid of this soon
  //   static dilateNeighborCoverage (shardGlobals: ShardGlobals, nodeShardDataMap: Map<string, NodeShardData>, parititionShardDataMap: Map<number, ShardInfo>, activeNodes: Shardus.Node[], nodeShardDataToModify:NodeShardData, extras: Shardus.Node[]) {
  //     // let circularDistance = function (a, b, max) {
  //     //   let directDist = Math.abs(a - b)
  //     //   let wrapDist = directDist
  //     //   // if (a < b) {
  //     //   //   wrapDist = Math.abs(a + (max - b))
  //     //   // } else if (b < a) {
  //     //   //   wrapDist = Math.abs(b + (max - a))
  //     //   // }
  //     //   let wrapDist1 = Math.abs(a + (max - b))
  //     //   let wrapDist2 = Math.abs(b + (max - a))
  //     //   wrapDist = Math.min(wrapDist1, wrapDist2)

  //     //   return Math.min(directDist, wrapDist)
  //     // }

  //     let changed = false
  //     for (let node of extras) {
  //       let otherNodeShardData = nodeShardDataMap.get(node.id)

  //       if (!otherNodeShardData) {
  //         otherNodeShardData = ShardFunctions.computeNodePartitionData(shardGlobals, node, nodeShardDataMap, parititionShardDataMap, activeNodes, false)
  //       }

  //       let partition = otherNodeShardData.homePartition
  //       // double check that this is not in our range.

  //       if (ShardFunctions.testInRange(partition, nodeShardDataToModify.storedPartitions)) {
  //         continue
  //       }

  //       let partitionDistanceStart = ShardFunctions.circularDistance(partition, nodeShardDataToModify.storedPartitions.partitionStart, shardGlobals.numPartitions)
  //       let partitionDistanceEnd = ShardFunctions.circularDistance(partition, nodeShardDataToModify.storedPartitions.partitionEnd, shardGlobals.numPartitions)

  //       if (partitionDistanceStart < partitionDistanceEnd) {
  //         nodeShardDataToModify.storedPartitions.partitionStart = partition
  //         changed = true
  //         // ShardFunctions.calculateStoredPartitions2Ranges(shardGlobals, nodeShardDataToModify.storedPartitions)
  //       } else {
  //         nodeShardDataToModify.storedPartitions.partitionEnd = partition
  //         changed = true
  //         // ShardFunctions.calculateStoredPartitions2Ranges(shardGlobals, nodeShardDataToModify.storedPartitions)
  //       }
  //     }
  //     if (changed) {
  //       ShardFunctions.calculateStoredPartitions2Ranges(shardGlobals, nodeShardDataToModify.storedPartitions)
  //     }
  //   }

  /**
   * Merges two node lists
   * could make a faster version for sorted lists.. but not worth the complexity unless it shows up on a benchmark
   * @param {Shardus.Node[]} listA
   * @param {Shardus.Node[]} listB
   * @returns {array} result [results, extras]  TODO TSConversion  get a better output type than any.. switch to an object maybe.
   */
  static mergeNodeLists(listA: Shardus.Node[], listB: Shardus.Node[]): any[] {
    let results = [] as Shardus.Node[]
    let extras = [] as Shardus.Node[]
    let map = {} as { [id: string]: boolean }
    for (let node of listA) {
      map[node.id] = true
      results.push(node)
    }
    for (let node of listB) {
      if (map[node.id] !== true) {
        results.push(node)
        extras.push(node)
      }
    }
    return [results, extras]
  }

  // A - B
  /**
   * @param {Shardus.Node[]} listA
   * @param {Shardus.Node[]} listB
   * @returns {Shardus.Node[]} results list
   */
  static subtractNodeLists(listA: Shardus.Node[], listB: Shardus.Node[]): Shardus.Node[] {
    let results = [] as Shardus.Node[]
    let map = {} as { [id: string]: boolean }
    for (let node of listB) {
      map[node.id] = true
    }
    for (let node of listA) {
      if (map[node.id] !== true) {
        results.push(node)
      }
    }
    return results
  }

  static partitionToAddressRange2(shardGlobals: ShardGlobals, partition: number, paritionMax?: number): AddressRange {
    let result = {} as AddressRange
    result.partition = partition

    // 2^32  4294967296 or 0xFFFFFFFF + 1
    let size = Math.round((0xffffffff + 1) / shardGlobals.numPartitions)
    let startAddr = partition * size

    result.p_low = partition

    let endPartition = partition + 1
    if (paritionMax) {
      result.p_high = paritionMax
      endPartition = paritionMax + 1
    } else {
      //result.p_high = partition
    }
    result.partitionEnd = endPartition
    let endAddr = endPartition * size

    // compounded rounding errors can reach up to num partitions at worst
    let roundingErrorSupport = shardGlobals.numPartitions

    //fix for int precision problem where id of the highest shard rolls over
    if (endAddr >= 4294967295 - roundingErrorSupport) {
      endAddr = 4294967295
    } else {
      // If we are not at the end of our max range then need to back up one to stay in the same partition as the start address
      endAddr = endAddr - 1 //subtract 1 so we do not overlap!
    }

    if (endPartition === shardGlobals.numPartitions) {
      endPartition = shardGlobals.numPartitions - 1
      result.partitionEnd = endPartition
    }

    result.startAddr = startAddr
    result.endAddr = endAddr

    result.low = ('00000000' + startAddr.toString(16)).slice(-8) + '0'.repeat(56)
    result.high = ('00000000' + endAddr.toString(16)).slice(-8) + 'f'.repeat(56)

    return result
  }

  // todo save off per node calculations?
  // get nodes with coverage of this range (does not support wrapping)
  // todo could make a faster partition based versoin of this!

  /**
   * NOTE this is a raw answer.  edge cases with consensus node coverage can increase the results of our raw answer that is given here
   * @param {ShardGlobals} shardGlobals
   * @param {Map<string, NodeShardData>} nodeShardDataMap
   * @param {number} partition
   * @param {string[]} exclude
   * @param {Node[]} activeNodes
   */
  static getNodesThatCoverParitionRaw(shardGlobals: ShardGlobals, nodeShardDataMap: Map<string, NodeShardData>, partition: number, exclude: string[], activeNodes: Shardus.Node[]): Shardus.Node[] {
    let results = [] as Shardus.Node[]

    // TODO perf.  faster verison that expands from our node index. (needs a sorted list of nodes.)
    for (let i = 0; i < activeNodes.length; i++) {
      let node = activeNodes[i]
      if (exclude.includes(node.id)) {
        continue
      }
      let nodeShardData = nodeShardDataMap.get(node.id)

      if (nodeShardData == null) {
        continue
      }
      if (nodeShardData.storedPartitions == null) {
        nodeShardData.storedPartitions = ShardFunctions.calculateStoredPartitions2(shardGlobals, nodeShardData.homePartition)
      }
      if (ShardFunctions.testInRange(partition, nodeShardData.storedPartitions) !== true) {
        continue
      }

      results.push(node)
    }
    return results
  }

  /**
   * getNeigborNodesInRange
   * get nodes in count range to either side of our node
   * position should be the position of the home node
   * @param {number} position
   * @param {number} radius
   * @param {any[]} exclude
   * @param {any[]} allNodes
   */
  static getNeigborNodesInRange(position: number, radius: number, exclude: any[], allNodes: any[]): Shardus.Node[] {
    // let allNodes = this.p2p.state.getNodesOrdered() // possibly faster version that does not need a copy
    let results = [] as Shardus.Node[]
    let scanStart = position - radius // have to pick floor or ceiling and be consistent.
    if (scanStart < 0) {
      scanStart = allNodes.length + scanStart

      // //not sure if this is bad... need to make things work in the case there is only one node to look
      if (scanStart < 0) {
        scanStart = 0
      }
    }

    // if (exclude.length === allNodes.length) {
    //   return results
    // }

    //TODO found a bug here. the consensus radius needs to hold one more node!!!

    //let expectedNodes = Math.min(allNodes.length - exclude.length, radius * 2)

    //or check radius being geater than max nodes... and do simple loop minus exclude..
    let scanAmount = radius * 2 + 1
    let scanCount = 0
    //this isn't quite perfect, but the only current use of exclude is for a the self node.
    let expectedNodes = Math.min(allNodes.length - exclude.length, scanAmount - exclude.length)

    // if we need to scan all the nodes, just do that here in a simple way
    if (scanAmount >= allNodes.length) {
      for (let i = 0; i < allNodes.length; i++) {
        let node = allNodes[i]
        if (exclude.includes(node.id)) {
          continue
        }
        if (node.status === 'active') {
          results.push(node)
        }
      }
      return results
    }

    // this got a bit ugly should think about how to clean it up
    let scanIndex = scanStart
    for (let i = 0; i < scanAmount; i++) {
      scanCount++
      if (scanCount >= allNodes.length) {
        break
      }

      if (scanIndex >= allNodes.length) {
        scanIndex = 0
      }

      let node = allNodes[scanIndex]

      if (exclude.includes(node.id)) {
        scanIndex++
        continue
      }

      if (node.status === 'active') {
        results.push(node)
      }

      scanIndex++
      // This does not work if we skip over it due to exclude
      if (scanIndex === scanStart) {
        break // we looped
      }
      if (results.length >= expectedNodes) {
        break
      }
    }
    return results
  }

  // This builds a sorted list of nodes based on how close they are to a given address
  // todo count should be based off of something in shard globals.  this will matter for large networks.

  /**
   * @param {ShardGlobals} shardGlobals
   * @param {Shardus.Node[]} activeNodes
   * @param {number} position
   * @param {string} excludeID
   * @param {number} [count]
   * @param {boolean} [centeredScan]
   */
  static getNodesByProximity(shardGlobals: ShardGlobals, activeNodes: Shardus.Node[], position: number, excludeID: string, count: number = 10, centeredScan: boolean = false): Shardus.Node[] {
    let allNodes = activeNodes
    let results = [] as Shardus.Node[]
    let leftScanIndex = position
    let rightScanIndex = position - 1
    let maxIterations = Math.ceil(count / 2)
    if (centeredScan) {
      maxIterations++
    }
    for (let i = 0; i < maxIterations; i++) {
      leftScanIndex--
      rightScanIndex++
      if (rightScanIndex >= allNodes.length) {
        rightScanIndex = 0
      }
      if (leftScanIndex < 0) {
        leftScanIndex = allNodes.length - 1
      }
      let node = allNodes[rightScanIndex]
      if (node.id !== excludeID) {
        if (node.status === 'active') {
          results.push(node)
          if (results.length === count) {
            return results
          }
        }
      }

      if (centeredScan && i === maxIterations - 1) {
        break // done, because we don't need the left index.
      }

      node = allNodes[leftScanIndex]
      if (node.id !== excludeID) {
        if (node.status === 'active') {
          results.push(node)
          if (results.length === count) {
            return results
          }
        }
      }

      if (rightScanIndex === leftScanIndex) {
        break // we looped
      }
      // check if our pointers have looped around
      if ((rightScanIndex - leftScanIndex) * (rightScanIndex - leftScanIndex) === 1) {
        // but only if we are past the first step. (since on the first step we are 1 apart.)
        // but if maxIterations is really low can bail early, not sure that would matte anyways.
        if (i > 0 || maxIterations <= 1) {
          break // we almost looped
        }
      }
    }
    return results
  }

  /**
   * findCenterAddressPair
   * @param {string} lowAddress
   * @param {string} highAddress
   * TSConversion  fix up any[] with a wrapped object.
   */
  static findCenterAddressPair(lowAddress: string, highAddress: string): any[] {
    let leftAddressNum = parseInt(lowAddress.slice(0, 8), 16)
    let nodeAddressNum = parseInt(highAddress.slice(0, 8), 16)

    let centerNum = Math.round((leftAddressNum + nodeAddressNum) * 0.5)

    let addressPrefixHex = ShardFunctions.leadZeros8(centerNum.toString(16))
    let addressPrefixHex2 = ShardFunctions.leadZeros8((centerNum + 1).toString(16))

    let centerAddr = addressPrefixHex + 'f'.repeat(56)
    let centerAddrPlusOne = addressPrefixHex2 + '0'.repeat(56)
    return [centerAddr, centerAddrPlusOne]
  }

  /**
   * This will find two address that are close to what we want
   * @param {string} address
   * @returns {{address1:string; address2:string}}
   * WARNING this only works input ends in all Fs after first byte.
   *
   */
  static getNextAdjacentAddresses(address: string) {
    let addressNum = parseInt(address.slice(0, 8), 16)

    let addressPrefixHex = ShardFunctions.leadZeros8(addressNum.toString(16))
    let addressPrefixHex2 = ShardFunctions.leadZeros8((addressNum + 1).toString(16))

    let address1 = addressPrefixHex + 'f'.repeat(56)
    let address2 = addressPrefixHex2 + '0'.repeat(56)
    return { address1, address2 } // is this valid: as {address1:string; address2:string}
  }

  static getCenterHomeNode(shardGlobals: ShardGlobals, parititionShardDataMap: ParititionShardDataMap, lowAddress: string, highAddress: string): NodeShardData | null {
    let [centerAddr] = ShardFunctions.findCenterAddressPair(lowAddress, highAddress)

    return ShardFunctions.findHomeNode(shardGlobals, centerAddr, parititionShardDataMap)
  }

  /**
   * @param {number} size1
   * @param {number} size2
   * @param {number} index1
   */
  static debugFastStableCorrespondingIndicies(size1: number, size2: number, index1: number): number[] {
    let results = [] as number[]
    try {
      results = ShardFunctions.fastStableCorrespondingIndicies(size1, size2, index1)
    } catch (ex) {
      throw new Error(`stack overflow fastStableCorrespondingIndicies( ${size1},  ${size2}, ${index1} )`)
    }

    return results
  }

  /**
   * @param {number} size1
   * @param {number} size2
   * @param {number} index1
   */
  static fastStableCorrespondingIndicies(size1: number, size2: number, index1: number): number[] {
    let results = [] as number[]
    if (size1 >= size2) {
      let value = Math.round((index1 / size1) * size2)
      if (value === 0) {
        value = 1
      }
      results.push(value)
    } else {
      let targetIndex = Math.round(index1 * (size2 / size1))
      let range = Math.round(size2 / size1)
      let start = Math.max(1, targetIndex - range)
      let stop = Math.min(size2, targetIndex + range)
      for (let i = start; i <= stop; i++) {
        let res = ShardFunctions.fastStableCorrespondingIndicies(size2, size1, i)
        if (res[0] === index1) {
          results.push(i)
        }
      }
    }
    return results
  }

  /**
   * @param {number} i
   * @param {number} minP
   * @param {number} maxP
   */
  static partitionInConsensusRange(i: number, minP: number, maxP: number): boolean {
    let key = i
    if (minP === maxP) {
      if (i !== minP) {
        return false
      }
    } else if (maxP > minP) {
      // are we outside the min to max range
      if (key < minP || key > maxP) {
        return false
      }
    } else {
      // are we inside the min to max range (since the covered rage is inverted)
      if (key > maxP && key < minP) {
        return false
      }
    }
    return true
  }
}
//module.exports = ShardFunctions

export default ShardFunctions
