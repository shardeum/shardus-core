import Logger, { logFlags } from '../logger';
import * as Shardus from '../shardus/shardus-types';
import { StateManager, P2P } from '@shardus/types';
import log4js from 'log4js';
import { Ordering } from '../utils';
import { Utils } from '@shardus/types';

type ShardGlobals = StateManager.shardFunctionTypes.ShardGlobals;
type ShardInfo = StateManager.shardFunctionTypes.ShardInfo;
type NodeShardData = StateManager.shardFunctionTypes.NodeShardData;
type NodeShardDataMap = StateManager.shardFunctionTypes.NodeShardDataMap;
type PartitionShardDataMap = StateManager.shardFunctionTypes.ParititionShardDataMap;
type WrappablePartitionRange = StateManager.shardFunctionTypes.WrappableParitionRange;
type HomeNodeSummary = StateManager.shardFunctionTypes.HomeNodeSummary;
type AddressRange = StateManager.shardFunctionTypes.AddressRange;

class ShardFunctions {
  static logger: Logger = null;
  static mainLogger: log4js.Logger = null;
  static fatalLogger: log4js.Logger = null;

  /**
   * calculateShardGlobals
   * @param {number} numNodes
   * @param {number} nodesPerConsenusGroup
   */
  static calculateShardGlobals(
    numNodes: number,
    nodesPerConsenusGroup: number,
    nodesPerEdge: number
  ): ShardGlobals {
    const shardGlobals = {} as ShardGlobals;

    if (nodesPerConsenusGroup % 2 === 0) {
      nodesPerConsenusGroup++;
      if (logFlags.console) console.log('upgrading consensus size to odd number: ' + nodesPerConsenusGroup);
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
    shardGlobals.numActiveNodes = numNodes;
    shardGlobals.nodesPerConsenusGroup = nodesPerConsenusGroup;
    shardGlobals.numPartitions = shardGlobals.numActiveNodes;

    //make sure nodesPerConsenusGroup is an odd number >= 3
    if (nodesPerConsenusGroup % 2 === 0 || nodesPerConsenusGroup < 3) {
      throw new Error(`nodesPerConsenusGroup:${nodesPerConsenusGroup} must be odd and >= 3`);
    }

    shardGlobals.consensusRadius = Math.floor((nodesPerConsenusGroup - 1) / 2);

    // NOT ready for using nodes per edge as an input, so we will force it to a procedural value
    if (nodesPerEdge == null) {
      nodesPerEdge = shardGlobals.consensusRadius;
    }
    // nodesPerEdge = shardGlobals.consensusRadius
    shardGlobals.nodesPerEdge = nodesPerEdge;

    const partitionStoreRadius = shardGlobals.consensusRadius + shardGlobals.nodesPerEdge;
    shardGlobals.numVisiblePartitions = shardGlobals.nodesPerConsenusGroup + nodesPerEdge * 2;

    shardGlobals.nodeLookRange = Math.floor((partitionStoreRadius / shardGlobals.numPartitions) * 0xffffffff); // 0.5 added since our search will look from the center of a partition

    return shardGlobals;
  }

  static leadZeros8(input: string): string {
    return ('00000000' + input).slice(-8);
  }

  static calculateShardValues(shardGlobals: ShardGlobals, address: string): ShardInfo {
    const shardinfo = {} as ShardInfo;
    shardinfo.address = address;
    shardinfo.homeNodes = [];
    shardinfo.addressPrefix = parseInt(address.slice(0, 8), 16);
    shardinfo.addressPrefixHex = ShardFunctions.leadZeros8(shardinfo.addressPrefix.toString(16));
    // old calculation
    //shardinfo.homePartition = Math.floor(shardGlobals.numPartitions * (shardinfo.addressPrefix / 0xffffffff))
    shardinfo.homePartition = ShardFunctions.addressNumberToPartition(shardGlobals, shardinfo.addressPrefix);

    shardinfo.homeRange = ShardFunctions.partitionToAddressRange2(shardGlobals, shardinfo.homePartition);
    shardinfo.coveredBy = {}; // consensus nodes that cover us.
    shardinfo.storedBy = {};
    return shardinfo;
  }

  /**
   * calculateStoredPartitions2
   * gets the WrappablePartitionRange for a node's stored partitions
   * this uses nodesPerConsenusGroup as the radius to include, so we will end up with 1 + 2*nodesPerConsenusGroup stored partitions
   * @param shardGlobals
   * @param homePartition
   */
  static calculateStoredPartitions2(
    shardGlobals: ShardGlobals,
    homePartition: number
  ): WrappablePartitionRange {
    const storedPartitionRadius = shardGlobals.consensusRadius + shardGlobals.nodesPerEdge;
    return ShardFunctions.calculateParitionRange(shardGlobals, homePartition, storedPartitionRadius);
  }

  static calculateConsensusPartitions(
    shardGlobals: ShardGlobals,
    homePartition: number
  ): WrappablePartitionRange {
    return ShardFunctions.calculateParitionRange(shardGlobals, homePartition, shardGlobals.consensusRadius);
  }

  /**
   * calculateParitionRange
   * give a center partition and the radius to calculate a WrappablePartitionRange
   * @param shardGlobals
   * @param homePartition
   * @param partitionRadius
   */
  static calculateParitionRange(
    shardGlobals: ShardGlobals,
    homePartition: number,
    partitionRadius: number
  ): WrappablePartitionRange {
    const wrappableParitionRange = {} as WrappablePartitionRange;

    wrappableParitionRange.homeRange = ShardFunctions.partitionToAddressRange2(shardGlobals, homePartition);
    // test if we will cover the full range by default
    if (shardGlobals.numPartitions / 2 <= partitionRadius) {
      wrappableParitionRange.rangeIsSplit = false;
      wrappableParitionRange.partitionStart = 0;
      wrappableParitionRange.partitionEnd = shardGlobals.numPartitions - 1;

      ShardFunctions.calculatePartitionRangeInternal(shardGlobals, wrappableParitionRange, partitionRadius);
      return wrappableParitionRange;
    }

    const x = partitionRadius;
    const n = homePartition;
    wrappableParitionRange.x = x; // for debug
    wrappableParitionRange.n = n;

    wrappableParitionRange.partitionStart = n - x;
    wrappableParitionRange.partitionEnd = n + x;

    ShardFunctions.calculatePartitionRangeInternal(shardGlobals, wrappableParitionRange, partitionRadius);

    return wrappableParitionRange;
  }

  /**
   * calculatePartitionRangeInternal
   * additional calculations required to fill out a WrappablePartitionRange and make sure the wrapping is correct
   * @param {ShardGlobals} shardGlobals
   * @param {WrappablePartitionRange} wrappablePartitionRange
   */
  static calculatePartitionRangeInternal(
    shardGlobals: ShardGlobals,
    wrappablePartitionRange: WrappablePartitionRange,
    partitionRadius: number
  ): void {
    wrappablePartitionRange.partitionRangeVector = {
      start: wrappablePartitionRange.partitionStart,
      dist: 1 + 2 * shardGlobals.nodesPerConsenusGroup,
      end: wrappablePartitionRange.partitionEnd,
    };
    wrappablePartitionRange.rangeIsSplit = false;

    wrappablePartitionRange.partitionsCovered = 0;
    if (wrappablePartitionRange.partitionStart < 0) {
      wrappablePartitionRange.rangeIsSplit = true;
      wrappablePartitionRange.partitionStart2 =
        wrappablePartitionRange.partitionStart + shardGlobals.numPartitions;
      wrappablePartitionRange.partitionEnd2 = shardGlobals.numPartitions - 1;
      wrappablePartitionRange.partitionStart1 = 0;
      wrappablePartitionRange.partitionEnd1 = wrappablePartitionRange.partitionEnd;
      wrappablePartitionRange.partitionRangeVector.start = wrappablePartitionRange.partitionStart2;
      wrappablePartitionRange.partitionStart = wrappablePartitionRange.partitionRangeVector.start;
    }
    if (wrappablePartitionRange.partitionEnd >= shardGlobals.numPartitions) {
      wrappablePartitionRange.rangeIsSplit = true;
      wrappablePartitionRange.partitionEnd1 =
        wrappablePartitionRange.partitionEnd - shardGlobals.numPartitions;
      wrappablePartitionRange.partitionStart1 = 0;
      wrappablePartitionRange.partitionStart2 = wrappablePartitionRange.partitionStart;
      wrappablePartitionRange.partitionEnd2 = shardGlobals.numPartitions - 1;
      wrappablePartitionRange.partitionRangeVector.end = wrappablePartitionRange.partitionEnd1;
      wrappablePartitionRange.partitionEnd = wrappablePartitionRange.partitionRangeVector.end;
    }

    if (wrappablePartitionRange.partitionEnd < wrappablePartitionRange.partitionStart) {
      wrappablePartitionRange.rangeIsSplit = true;

      wrappablePartitionRange.partitionEnd1 = wrappablePartitionRange.partitionEnd;
      wrappablePartitionRange.partitionStart1 = 0;
      wrappablePartitionRange.partitionStart2 = wrappablePartitionRange.partitionStart;
      wrappablePartitionRange.partitionEnd2 = shardGlobals.numPartitions - 1;
      wrappablePartitionRange.partitionRangeVector.end = wrappablePartitionRange.partitionEnd1;
      wrappablePartitionRange.partitionEnd = wrappablePartitionRange.partitionRangeVector.end;
    }

    // need to collapse a split range that covers all partitions?
    if (
      wrappablePartitionRange.rangeIsSplit === true &&
      wrappablePartitionRange.partitionEnd1 + 1 === wrappablePartitionRange.partitionStart2
    ) {
      wrappablePartitionRange.rangeIsSplit = false;
      wrappablePartitionRange.partitionStart = 0;
      wrappablePartitionRange.partitionEnd = shardGlobals.numPartitions - 1;

      wrappablePartitionRange.partitionRangeVector = {
        start: wrappablePartitionRange.partitionStart,
        dist: 1 + 2 * partitionRadius,
        end: wrappablePartitionRange.partitionEnd,
      };
    }

    // alias to start and end 1 in the simple case.  sync code expects values for these
    if (wrappablePartitionRange.rangeIsSplit === false) {
      wrappablePartitionRange.partitionStart1 = wrappablePartitionRange.partitionStart;
      wrappablePartitionRange.partitionEnd1 = wrappablePartitionRange.partitionEnd;
    }

    // did we wrap to cover the entire range, that should have early outed at the top of the function
    if (
      wrappablePartitionRange.rangeIsSplit === true &&
      (wrappablePartitionRange.partitionStart1 === wrappablePartitionRange.partitionEnd2 ||
        wrappablePartitionRange.partitionStart2 === wrappablePartitionRange.partitionEnd1)
    ) {
      throw new Error(
        'this should never happen: ' +
          Utils.safeStringify(wrappablePartitionRange) +
          'globals: ' +
          Utils.safeStringify(shardGlobals)
      );
    }
    if (wrappablePartitionRange.rangeIsSplit) {
      if (wrappablePartitionRange.partitionStart2 >= 0 && wrappablePartitionRange.partitionEnd2 >= 0) {
        wrappablePartitionRange.partitionRange = ShardFunctions.partitionToAddressRange2(
          shardGlobals,
          wrappablePartitionRange.partitionStart1,
          wrappablePartitionRange.partitionEnd1
        );
        wrappablePartitionRange.partitionRange2 = ShardFunctions.partitionToAddressRange2(
          shardGlobals,
          wrappablePartitionRange.partitionStart2,
          wrappablePartitionRange.partitionEnd2
        );
        wrappablePartitionRange.partitionsCovered =
          2 +
          (wrappablePartitionRange.partitionEnd1 - wrappablePartitionRange.partitionStart1) +
          (wrappablePartitionRange.partitionEnd2 - wrappablePartitionRange.partitionStart2);
      } else {
        throw new Error('missing ranges in partitionRange 1');
      }
    } else {
      wrappablePartitionRange.partitionRange = ShardFunctions.partitionToAddressRange2(
        shardGlobals,
        wrappablePartitionRange.partitionStart,
        wrappablePartitionRange.partitionEnd
      );
      if (wrappablePartitionRange.partitionStart1 >= 0 && wrappablePartitionRange.partitionEnd1 >= 0) {
        wrappablePartitionRange.partitionsCovered =
          1 + (wrappablePartitionRange.partitionEnd1 - wrappablePartitionRange.partitionStart1);
      } else {
        // throw new Error('missing ranges in storedPartitions 2')
        throw new Error(
          `missing ranges in partitionRange 2b  ${wrappablePartitionRange.partitionStart1} ${
            wrappablePartitionRange.partitionEnd1
          } ${Utils.safeStringify(wrappablePartitionRange)}`
        );
      }
    }
  }

  static testAddressInRange(address: string, wrappableParitionRange: WrappablePartitionRange): boolean {
    if (wrappableParitionRange.rangeIsSplit) {
      if (
        (address >= wrappableParitionRange.partitionRange.low &&
          address <= wrappableParitionRange.partitionRange.high) ||
        (address >= wrappableParitionRange.partitionRange2.low &&
          address <= wrappableParitionRange.partitionRange2.high)
      ) {
        return true;
      }
    } else {
      if (
        address >= wrappableParitionRange.partitionRange.low &&
        address <= wrappableParitionRange.partitionRange.high
      ) {
        return true;
      }
    }
    return false;
  }

  static testAddressNumberInRange(address: number, wrappableParitionRange: WrappablePartitionRange): boolean {
    if (wrappableParitionRange.rangeIsSplit) {
      if (
        (address >= wrappableParitionRange.partitionRange.startAddr &&
          address <= wrappableParitionRange.partitionRange.endAddr) ||
        (address >= wrappableParitionRange.partitionRange2.startAddr &&
          address <= wrappableParitionRange.partitionRange2.endAddr)
      ) {
        return true;
      }
    } else {
      if (
        address >= wrappableParitionRange.partitionRange.startAddr &&
        address <= wrappableParitionRange.partitionRange.endAddr
      ) {
        return true;
      }
    }
    return false;
  }

  static testInRange(partition: number, wrappableParitionRange: WrappablePartitionRange): boolean {
    if (wrappableParitionRange.rangeIsSplit) {
      if (
        (partition >= wrappableParitionRange.partitionStart1 &&
          partition <= wrappableParitionRange.partitionEnd1) ||
        (partition >= wrappableParitionRange.partitionStart2 &&
          partition <= wrappableParitionRange.partitionEnd2)
      ) {
        return true;
      }
    } else {
      if (
        partition >= wrappableParitionRange.partitionStart &&
        partition <= wrappableParitionRange.partitionEnd
      ) {
        return true;
      }
    }
    return false;
  }

  static getPartitionsCovered(wrappableParitionRange: WrappablePartitionRange): number {
    let covered = 0;
    if (wrappableParitionRange.rangeIsSplit === true) {
      covered =
        2 +
        (wrappableParitionRange.partitionEnd2 - wrappableParitionRange.partitionStart2) +
        (wrappableParitionRange.partitionEnd1 - wrappableParitionRange.partitionStart1);
    } else {
      covered = 1 + wrappableParitionRange.partitionEnd - wrappableParitionRange.partitionStart;
    }
    if (covered < 20) {
      covered += 0;
    }

    return covered;
  }

  static computePartitionShardDataMap(
    shardGlobals: ShardGlobals,
    partitionShardDataMap: PartitionShardDataMap,
    partitionStart: number,
    partitionsToScan: number
  ): void {
    let partitionIndex = partitionStart;

    const numPartitions = shardGlobals.numPartitions;

    for (let i = 0; i < partitionsToScan; ++i) {
      if (partitionIndex >= numPartitions) {
        partitionIndex = 0;
      }
      const fpAdressCenter = (i + 0.5) / numPartitions;
      const addressPrefix = Math.floor(fpAdressCenter * 0xffffffff);

      const addressPrefixHex = ShardFunctions.leadZeros8(addressPrefix.toString(16));
      const address = addressPrefixHex + '7' + 'f'.repeat(55); // 55 + 1 + 8 = 64

      const shardinfo = ShardFunctions.calculateShardValues(shardGlobals, address);
      partitionShardDataMap.set(i, shardinfo);
      // increment index:
      partitionIndex++;
      if (partitionIndex === partitionStart) {
        break; // we looped
      }
    }
  }

  static computeNodePartitionDataMap(
    shardGlobals: ShardGlobals,
    nodeShardDataMap: NodeShardDataMap,
    nodesToGenerate: P2P.NodeListTypes.Node[], //Shardus.Node[],
    partitionShardDataMap: PartitionShardDataMap,
    activeNodes: Shardus.Node[],
    extendedData: boolean,
    isActiveNodeList = true
  ): void {
    let index = 0;
    for (const node of nodesToGenerate) {
      let nodeShardData = nodeShardDataMap.get(node.id);
      if (!nodeShardData) {
        let thisNodeIndex = undefined;
        if (isActiveNodeList) {
          thisNodeIndex = index;
        }
        nodeShardData = ShardFunctions.computeNodePartitionData(
          shardGlobals,
          node,
          nodeShardDataMap,
          partitionShardDataMap,
          activeNodes,
          false,
          thisNodeIndex
        );
      }
      index++;
    }
    if (extendedData) {
      index = 0;
      // second pass for extended data
      for (const node of nodesToGenerate) {
        const nodeShardData = nodeShardDataMap.get(node.id);
        if (nodeShardData == null) {
          //log error?
          continue;
        }
        ShardFunctions.computeExtendedNodePartitionData(
          shardGlobals,
          nodeShardDataMap,
          partitionShardDataMap,
          nodeShardData,
          activeNodes
        );
      }
    }
  }

  static computeNodePartitionData(
    shardGlobals: ShardGlobals,
    node: Shardus.Node,
    nodeShardDataMap: NodeShardDataMap,
    partitionShardDataMap: PartitionShardDataMap,
    activeNodes: Shardus.Node[],
    extendedData?: boolean,
    thisNodeIndex?: number
  ): NodeShardData {
    const numPartitions = shardGlobals.numPartitions;

    const nodeShardData = {} as NodeShardData;

    if (thisNodeIndex != undefined) {
      nodeShardData.ourNodeIndex = thisNodeIndex;

      // //temp test
      // let test = activeNodes.findIndex(function (_node) {
      //   return _node.id === node.id
      // })
      // if (test != nodeShardData.ourNodeIndex){
      //   throw new Error(`index failure : ${thisNodeIndex}`)
      // }
    } else {
      //this is way too slow
      nodeShardData.ourNodeIndex = activeNodes.findIndex((_node) => {
        //have seen a null node here but it makes no sense
        return _node.id === node.id;
      });
      //find closest index if our node is not in the active list.  Not sure this is valid
      //I think we need a more direct path for computing info on nodes that are not active yet
      if (nodeShardData.ourNodeIndex === -1) {
        for (let i = 0; i < activeNodes.length; i++) {
          nodeShardData.ourNodeIndex = i;
          // eslint-disable-next-line security/detect-object-injection
          if (activeNodes[i].id >= node.id) {
            break;
          }
        }
      }
    }
    const homePartition = nodeShardData.ourNodeIndex;
    const centeredAddress = Math.floor(((homePartition + 0.5) * 0xffffffff) / numPartitions);
    const nodeAddressNum = centeredAddress;

    nodeShardData.node = node;
    nodeShardData.nodeAddressNum = nodeAddressNum;
    nodeShardData.homePartition = homePartition;
    nodeShardData.centeredAddress = centeredAddress;

    nodeShardData.consensusStartPartition = homePartition;
    nodeShardData.consensusEndPartition = homePartition;

    nodeShardData.patchedOnNodes = [];

    // push the data in to the correct homenode list for the home partition
    let partitionShard = partitionShardDataMap.get(homePartition);
    if (partitionShard == null) {
      partitionShard = partitionShardDataMap.get(homePartition);
    }

    if (partitionShard == null) {
      throw new Error(
        `computeNodePartitionData: cant find partitionShard for index:${nodeShardData.ourNodeIndex} size:${partitionShardDataMap.size} activeNodes:${activeNodes.length}  `
      );
    }

    if (nodeShardData.ourNodeIndex !== -1) {
      partitionShard.homeNodes = [];
      partitionShard.homeNodes.push(nodeShardData);
    }

    nodeShardData.extendedData = false;
    if (extendedData) {
      ShardFunctions.computeExtendedNodePartitionData(
        shardGlobals,
        nodeShardDataMap,
        partitionShardDataMap,
        nodeShardData,
        activeNodes
      );
    }

    // set the data in our map
    nodeShardDataMap.set(node.id, nodeShardData);
    nodeShardData.needsUpdateToFullConsensusGroup = true;

    return nodeShardData;
  }

  /**
   * @param {ShardGlobals} shardGlobals
   * @param {Map<string, NodeShardData>} nodeShardDataMap
   * @param {Map<number, ShardInfo>} partitionShardDataMap
   * @param {NodeShardData} nodeShardData
   * @param {Node[]} activeNodes
   */
  static computeExtendedNodePartitionData(
    shardGlobals: ShardGlobals,
    nodeShardDataMap: NodeShardDataMap,
    partitionShardDataMap: PartitionShardDataMap,
    nodeShardData: NodeShardData,
    activeNodes: Shardus.Node[]
  ): void {
    if (nodeShardData.extendedData) {
      return;
    }
    const useCombinedCalculation = true;
    const checkNewCalculation = false; // to make sure new calculation produce same nodelist as old calculation

    nodeShardData.extendedData = true;
    if (nodeShardData.storedPartitions == null) {
      nodeShardData.storedPartitions = ShardFunctions.calculateStoredPartitions2(
        shardGlobals,
        nodeShardData.homePartition
      );
    }
    if (nodeShardData.consensusPartitions == null) {
      nodeShardData.consensusPartitions = ShardFunctions.calculateConsensusPartitions(
        shardGlobals,
        nodeShardData.homePartition
      );
    }

    const nodeIsActive = nodeShardData.ourNodeIndex !== -1;
    const exclude = [nodeShardData.node.id];
    const excludeNodeArray = [nodeShardData.node];

    // let temp = ShardFunctions.getNodesThatCoverPartitionRaw(shardGlobals, nodeShardDataMap, nodeShardData.homePartition, exclude, activeNodes)
    // //temp validation that the functions above are equal
    // let diffA = ShardFunctions.subtractNodeLists(temp, nodeShardData.nodeThatStoreOurParition)
    // let diffB = ShardFunctions.subtractNodeLists(nodeShardData.nodeThatStoreOurParition, temp)
    // if(diffA.length > 0){
    //   throw new Error( `diffA ${diffA.length}`)
    // }
    // if(diffB.length > 0){
    //   throw new Error( `diffB ${diffB.length}`)
    // }

    // nodeShardData.nodeThatStoreOurParition = ShardFunctions.getNodesThatCoverRange(shardGlobals, nodeShardData.storedPartitions.homeRange.low, nodeShardData.storedPartitions.homeRange.high, exclude, activeNodes)

    // check if node is active because there are many calculations that are invalid or wrong if you try to compute them with a node that is not active in the network.
    // This is because consenus calcualtions are based on distance to other active nodes.
    if (nodeIsActive) {
      if (useCombinedCalculation) {
        const combinedNodes = ShardFunctions.getCombinedNodeLists(
          shardGlobals,
          nodeShardData,
          nodeShardDataMap,
          activeNodes
        );
        nodeShardData.consensusNodeForOurNode = combinedNodes.consensusNodeForOurNode;
        nodeShardData.consensusNodeForOurNodeFull = combinedNodes.consensusNodeForOurNodeFull;
        nodeShardData.nodeThatStoreOurParition = combinedNodes.nodeThatStoreOurPartition;
        nodeShardData.nodeThatStoreOurParitionFull = combinedNodes.nodeThatStoreOurPartitionFull;
        nodeShardData.edgeNodes = combinedNodes.edgeNodes;
      } else {
        nodeShardData.nodeThatStoreOurParition = ShardFunctions.getNodesThatCoverHomePartition(
          shardGlobals,
          nodeShardData,
          nodeShardDataMap,
          activeNodes
        );
        nodeShardData.consensusNodeForOurNode = ShardFunctions.getNeigborNodesInRange(
          nodeShardData.ourNodeIndex,
          shardGlobals.consensusRadius,
          exclude,
          activeNodes
        );
        nodeShardData.consensusNodeForOurNodeFull = ShardFunctions.getNeigborNodesInRange(
          nodeShardData.ourNodeIndex,
          shardGlobals.consensusRadius,
          [],
          activeNodes
        );
      }
      // calcuate partition range for consensus
      // note we must use consensusNodeForOurNodeFull because consensusNodeForOurNode is not our node,
      //     but our node could be at the front or back of the not wrapped list of nodes.
      //     if we left our node out then it would truncate the consensus range
      if (nodeShardData.consensusNodeForOurNodeFull.length >= 2) {
        // this logic only works because we know that getNeigborNodesInRange starts at the starting point
        const startNode = nodeShardData.consensusNodeForOurNodeFull[0];
        const endNode =
          nodeShardData.consensusNodeForOurNodeFull[nodeShardData.consensusNodeForOurNodeFull.length - 1];

        let startPartition = nodeShardDataMap.get(startNode.id).homePartition;
        let endPartition = nodeShardDataMap.get(endNode.id).homePartition;

        // special case when there are very small networks and the consensus range should wrap around.
        if (startPartition === endPartition && startNode.id > endNode.id) {
          startPartition = 0;
          endPartition = shardGlobals.numPartitions - 1;
        }

        nodeShardData.consensusStartPartition = startPartition;
        nodeShardData.consensusEndPartition = endPartition;
      }

      //update covered by list
      if (nodeShardData.consensusStartPartition <= nodeShardData.consensusEndPartition) {
        for (let i = nodeShardData.consensusStartPartition; i <= nodeShardData.consensusEndPartition; i++) {
          const shardPartitionData = partitionShardDataMap.get(i);
          if (shardPartitionData == null) {
            throw new Error('computeExtendedNodePartitionData: shardPartitionData==null 1');
          }
          shardPartitionData.coveredBy[nodeShardData.node.id] = nodeShardData.node; // { idx: nodeShardData.ourNodeIndex }
        }
      } else {
        for (let i = 0; i <= nodeShardData.consensusEndPartition; i++) {
          const shardPartitionData = partitionShardDataMap.get(i);
          if (shardPartitionData == null) {
            throw new Error('computeExtendedNodePartitionData: shardPartitionData==null 2');
          }
          shardPartitionData.coveredBy[nodeShardData.node.id] = nodeShardData.node; // { idx: nodeShardData.ourNodeIndex }
        }
        for (let i = nodeShardData.consensusStartPartition; i < shardGlobals.numPartitions; i++) {
          const shardPartitionData = partitionShardDataMap.get(i);
          if (shardPartitionData == null) {
            throw new Error('computeExtendedNodePartitionData: shardPartitionData==null 3');
          }
          shardPartitionData.coveredBy[nodeShardData.node.id] = nodeShardData.node; // { idx: nodeShardData.ourNodeIndex }
        }
      }

      if (!useCombinedCalculation) {
        // this list is a temporary list that counts as 2c range.  Stored nodes are the merged max of 2c range (2r on each side) and node in the 2c partition range
        nodeShardData.c2NodeForOurNode = ShardFunctions.getNeigborNodesInRange(
          nodeShardData.ourNodeIndex,
          2 * shardGlobals.consensusRadius,
          exclude,
          activeNodes
        );
        const [results, extras] = ShardFunctions.mergeNodeLists(
          nodeShardData.nodeThatStoreOurParition,
          nodeShardData.c2NodeForOurNode
        );
        nodeShardData.nodeThatStoreOurParitionFull = results;
        nodeShardData.outOfDefaultRangeNodes = extras;
        nodeShardData.edgeNodes = ShardFunctions.subtractNodeLists(
          nodeShardData.nodeThatStoreOurParitionFull,
          nodeShardData.consensusNodeForOurNode
        );
        nodeShardData.edgeNodes = ShardFunctions.subtractNodeLists(nodeShardData.edgeNodes, excludeNodeArray); // remove ourself!
      }

      if (checkNewCalculation) {
        // COMPARE COMBINED LIST and Original calculations
        const combinedNodes = ShardFunctions.getCombinedNodeLists(
          shardGlobals,
          nodeShardData,
          nodeShardDataMap,
          activeNodes
        );
        const diffA1 = ShardFunctions.subtractNodeLists(
          nodeShardData.nodeThatStoreOurParition,
          combinedNodes.nodeThatStoreOurPartition
        );
        const diffA2 = ShardFunctions.subtractNodeLists(
          combinedNodes.nodeThatStoreOurPartition,
          nodeShardData.nodeThatStoreOurParition
        );

        const diffB1 = ShardFunctions.subtractNodeLists(
          combinedNodes.consensusNodeForOurNode,
          nodeShardData.consensusNodeForOurNode
        );
        const diffB2 = ShardFunctions.subtractNodeLists(
          nodeShardData.consensusNodeForOurNode,
          combinedNodes.consensusNodeForOurNode
        );

        const diffC1 = ShardFunctions.subtractNodeLists(
          combinedNodes.consensusNodeForOurNodeFull,
          nodeShardData.consensusNodeForOurNodeFull
        );
        const diffC2 = ShardFunctions.subtractNodeLists(
          nodeShardData.consensusNodeForOurNodeFull,
          combinedNodes.consensusNodeForOurNodeFull
        );

        const diffD1 = ShardFunctions.subtractNodeLists(combinedNodes.edgeNodes, nodeShardData.edgeNodes);
        const diffD2 = ShardFunctions.subtractNodeLists(nodeShardData.edgeNodes, combinedNodes.edgeNodes);

        console.log('diffA1', diffA1);
        console.log('diffA2', diffA2);
        console.log('diffB1', diffB1);
        console.log('diffB2', diffB2);
        console.log('diffC1', diffC1);
        console.log('diffC2', diffC2);
        console.log('diffD1', diffD1);
        console.log('diffD2', diffD2);
        if (diffA1.length > 0) throw new Error('Different calculation');
        if (diffA2.length > 0) throw new Error('Different calculation');
        if (diffB1.length > 0) throw new Error('Different calculation');
        if (diffB2.length > 0) throw new Error('Different calculation');
        if (diffC1.length > 0) throw new Error('Different calculation');
        if (diffC2.length > 0) throw new Error('Different calculation');
        if (diffD1.length > 0) throw new Error('Different calculation');
        if (diffD2.length > 0) throw new Error('Different calculation');
      }

      const extras = []; // TODO: remove "extras" check if possible
      if (extras.length > 0) {
        //ShardFunctions.dilateNeighborCoverage(shardGlobals, nodeShardDataMap, partitionShardDataMap, activeNodes, nodeShardData, extras)
        //can get rid of some of the above merge logic if this never shows up in testing
        let message = 'computeExtendedNodePartitionData: failed';
        try {
          const list1 = nodeShardData.nodeThatStoreOurParition.map((n) => n.id.substring(0, 5));
          const list2 = nodeShardData.nodeThatStoreOurParition.map((n) => n.id.substring(0, 5));
          const extraLists = extras.map((n) => n.id.substring(0, 5));
          message = `computeExtendedNodePartitionData: should never have extras. node:${nodeShardData.node.id.substring(
            0,
            5
          )} ${Utils.safeStringify({
            list1,
            list2,
            extraLists,
          })}`;
        } catch (ex) {
          this.fatalLogger.fatal(
            'computeExtendedNodePartitionData: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack
          );
        }
        if (ShardFunctions.fatalLogger) {
          ShardFunctions.fatalLogger.fatal(message);
        }

        // throw new Error(message)
      }
      nodeShardData.edgeNodes.sort(ShardFunctions.nodeSortAsc);
      nodeShardData.consensusNodeForOurNodeFull.sort(ShardFunctions.nodeSortAsc);
      nodeShardData.nodeThatStoreOurParitionFull.sort(ShardFunctions.nodeSortAsc);
    } else {
      nodeShardData.consensusNodeForOurNode = [];
      nodeShardData.consensusNodeForOurNodeFull = [];
      nodeShardData.c2NodeForOurNode = [];

      nodeShardData.nodeThatStoreOurParitionFull = nodeShardData.nodeThatStoreOurParition.slice(0);
      nodeShardData.outOfDefaultRangeNodes = [];
      nodeShardData.edgeNodes = nodeShardData.nodeThatStoreOurParitionFull.slice(0); // just dupe the stored list.
      nodeShardData.edgeNodes = ShardFunctions.subtractNodeLists(nodeShardData.edgeNodes, excludeNodeArray); // remove ourself!

      nodeShardData.edgeNodes.sort(ShardFunctions.nodeSortAsc);
      nodeShardData.consensusNodeForOurNodeFull.sort(ShardFunctions.nodeSortAsc);
      nodeShardData.nodeThatStoreOurParitionFull.sort(ShardFunctions.nodeSortAsc);
    }

    // storedBy
    if (nodeShardData.storedPartitions.rangeIsSplit === false) {
      for (
        let i = nodeShardData.storedPartitions.partitionStart;
        i <= nodeShardData.storedPartitions.partitionEnd;
        i++
      ) {
        const shardPartitionData = partitionShardDataMap.get(i);
        if (shardPartitionData == null) {
          throw new Error('computeExtendedNodePartitionData: shardPartitionData==null 4');
        }
        shardPartitionData.storedBy[nodeShardData.node.id] = nodeShardData.node; // { idx: nodeShardData.ourNodeIndex }
      }
    } else {
      for (let i = 0; i <= nodeShardData.storedPartitions.partitionEnd; i++) {
        const shardPartitionData = partitionShardDataMap.get(i);
        if (shardPartitionData == null) {
          throw new Error('computeExtendedNodePartitionData: shardPartitionData==null 5');
        }
        shardPartitionData.storedBy[nodeShardData.node.id] = nodeShardData.node; // { idx: nodeShardData.ourNodeIndex }
      }
      for (let i = nodeShardData.storedPartitions.partitionStart; i < shardGlobals.numPartitions; i++) {
        const shardPartitionData = partitionShardDataMap.get(i);
        if (shardPartitionData == null) {
          throw new Error('computeExtendedNodePartitionData: shardPartitionData==null 6');
        }
        shardPartitionData.storedBy[nodeShardData.node.id] = nodeShardData.node; // { idx: nodeShardData.ourNodeIndex }
      }
    }
  }

  static nodeSortAsc(a: Shardus.Node, b: Shardus.Node): Ordering {
    return a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
  }

  /**
   * getConsenusPartitions
   * @param {ShardGlobals} shardGlobals
   * @param {NodeShardData} nodeShardData the node we want to get a list of consensus partions from
   * @returns {number[]} a list of partitions
   */
  static getConsenusPartitionList(shardGlobals: ShardGlobals, nodeShardData: NodeShardData): number[] {
    const consensusPartitions = [] as number[];
    if (nodeShardData.consensusStartPartition <= nodeShardData.consensusEndPartition) {
      for (let i = nodeShardData.consensusStartPartition; i <= nodeShardData.consensusEndPartition; i++) {
        consensusPartitions.push(i);
      }
    } else {
      for (let i = 0; i <= nodeShardData.consensusEndPartition; i++) {
        consensusPartitions.push(i);
      }
      for (let i = nodeShardData.consensusStartPartition; i < shardGlobals.numPartitions; i++) {
        consensusPartitions.push(i);
      }
    }
    return consensusPartitions;
  }

  /**
   * getStoredPartitions
   * @param {ShardGlobals} shardGlobals
   * @param {NodeShardData} nodeShardData the node we want to get a list of consensus partions from
   * @returns {number[]} a list of partitions
   */
  static getStoredPartitionList(shardGlobals: ShardGlobals, nodeShardData: NodeShardData): number[] {
    const storedPartitionList = [] as number[];
    if (nodeShardData.storedPartitions.partitionStart <= nodeShardData.storedPartitions.partitionEnd) {
      for (
        let i = nodeShardData.storedPartitions.partitionStart;
        i <= nodeShardData.storedPartitions.partitionEnd;
        i++
      ) {
        storedPartitionList.push(i);
      }
    } else {
      for (let i = 0; i <= nodeShardData.storedPartitions.partitionEnd; i++) {
        storedPartitionList.push(i);
      }
      for (let i = nodeShardData.storedPartitions.partitionStart; i < shardGlobals.numPartitions; i++) {
        storedPartitionList.push(i);
      }
    }
    return storedPartitionList;
  }

  //  a=old, b=new
  static setOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
    return !(bStart >= aEnd || bEnd <= aStart);
  }

  static setEpanded(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
    return bStart < aStart || bEnd > aEnd;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static setEpandedLeft(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
    return bStart < aStart;
  }

  static setEpandedRight(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
    return bEnd > aEnd;
  }

  //  a=old, b=new
  static setShrink(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
    return (bStart > aStart && bStart < aEnd) || (bEnd > aStart && bEnd < aEnd);
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
  static computeCoverageChanges(
    oldShardDataNodeShardData: NodeShardData,
    newSharddataNodeShardData: NodeShardData
  ): { start: number; end: number }[] {
    const coverageChanges = [] as { start: number; end: number }[];

    const oldStoredPartitions = oldShardDataNodeShardData.storedPartitions;
    const newStoredPartitions = newSharddataNodeShardData.storedPartitions;

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
        const oldStart1 = oldStoredPartitions.partitionRange.startAddr;
        const oldEnd1 = oldStoredPartitions.partitionRange.endAddr;

        const newStart1 = newStoredPartitions.partitionRange.startAddr;
        const newEnd1 = newStoredPartitions.partitionRange.endAddr;

        // d1s = newStart1 - oldStart1
        // d1e = newEnd1 - oldEnd1

        const oldStart2 = oldStoredPartitions.partitionRange2.startAddr;
        const oldEnd2 = oldStoredPartitions.partitionRange2.endAddr;

        const newStart2 = newStoredPartitions.partitionRange2.startAddr;
        const newEnd2 = newStoredPartitions.partitionRange2.endAddr;

        // d2s = newStart2 - oldStart2
        // d2e = newEnd2 - oldEnd2

        if (oldStart1 >= oldEnd1 || oldStart2 >= oldEnd2 || newStart1 >= newEnd1 || newStart2 >= newEnd2) {
          throw new Error('invalid ranges');
        }

        if (ShardFunctions.setOverlap(oldStart1, oldEnd1, newStart1, newEnd1)) {
          if (ShardFunctions.setEpandedLeft(oldStart1, oldEnd1, newStart1, newEnd1)) {
            coverageChanges.push({ start: newStart1, end: oldStart1 });
          }
          if (ShardFunctions.setEpandedRight(oldStart1, oldEnd1, newStart1, newEnd1)) {
            coverageChanges.push({ start: oldEnd1, end: newEnd1 });
          }
        }

        if (ShardFunctions.setOverlap(oldStart2, oldEnd2, newStart2, newEnd2)) {
          if (ShardFunctions.setEpandedLeft(oldStart2, oldEnd2, newStart2, newEnd2)) {
            coverageChanges.push({ start: newStart2, end: oldStart2 });
          }
          if (ShardFunctions.setEpandedRight(oldStart2, oldEnd2, newStart2, newEnd2)) {
            coverageChanges.push({ start: oldEnd2, end: newEnd2 });
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
        const oldStart1 = oldStoredPartitions.partitionRange.startAddr;
        const oldEnd1 = oldStoredPartitions.partitionRange.endAddr;
        const oldStart2 = oldStoredPartitions.partitionRange2.startAddr;
        const oldEnd2 = oldStoredPartitions.partitionRange2.endAddr;

        const newStart1 = newStoredPartitions.partitionRange.startAddr;
        const newEnd1 = newStoredPartitions.partitionRange.endAddr;

        if (oldStart1 >= oldEnd1 || oldStart2 >= oldEnd2 || newStart1 >= newEnd1) {
          throw new Error('invalid ranges');
        }

        // Test overlaps first, need permutations
        // Then can get differences.
        // If no overlap then entire value is a difference.

        if (ShardFunctions.setOverlap(oldStart1, oldEnd1, newStart1, newEnd1)) {
          if (ShardFunctions.setEpandedLeft(oldStart1, oldEnd1, newStart1, newEnd1)) {
            coverageChanges.push({ start: newStart1, end: oldStart1 });
          }
          if (ShardFunctions.setEpandedRight(oldStart1, oldEnd1, newStart1, newEnd1)) {
            coverageChanges.push({ start: oldEnd1, end: newEnd1 });
          }
        } else if (ShardFunctions.setOverlap(oldStart2, oldEnd2, newStart1, newEnd1)) {
          // Note: I was not sure if else-if is correct also these calculations can make results that overlap the old range.
          // Note response: the overlap gets corrected in the post process, because that was a faster way to feel certain
          if (ShardFunctions.setEpandedLeft(oldStart2, oldEnd2, newStart1, newEnd1)) {
            coverageChanges.push({ start: newStart1, end: oldStart2 });
          }
          if (ShardFunctions.setEpandedRight(oldStart2, oldEnd2, newStart1, newEnd1)) {
            coverageChanges.push({ start: oldEnd2, end: newEnd1 });
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
        const oldStart1 = oldStoredPartitions.partitionRange.startAddr;
        const oldEnd1 = oldStoredPartitions.partitionRange.endAddr;

        const newStart1 = newStoredPartitions.partitionRange.startAddr;
        const newEnd1 = newStoredPartitions.partitionRange.endAddr;
        const newStart2 = newStoredPartitions.partitionRange2.startAddr;
        const newEnd2 = newStoredPartitions.partitionRange2.endAddr;

        if (oldStart1 >= oldEnd1 || newStart1 >= newEnd1 || newStart2 >= newEnd2) {
          throw new Error('invalid ranges');
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
            coverageChanges.push({ start: newStart1, end: oldStart1 });
          }
          if (ShardFunctions.setEpandedRight(oldStart1, oldEnd1, newStart1, newEnd1)) {
            coverageChanges.push({ start: oldEnd1, end: newEnd1 });
          }
        }

        if (ShardFunctions.setOverlap(oldStart1, oldEnd1, newStart2, newEnd2)) {
          if (ShardFunctions.setEpandedLeft(oldStart1, oldEnd1, newStart2, newEnd2)) {
            coverageChanges.push({ start: newStart2, end: oldStart1 });
          }
          if (ShardFunctions.setEpandedRight(oldStart1, oldEnd1, newStart2, newEnd2)) {
            coverageChanges.push({ start: oldEnd1, end: newEnd2 });
          }
        }
      } else {
        // partitionRange

        const oldStart1 = oldStoredPartitions.partitionRange.startAddr;
        const oldEnd1 = oldStoredPartitions.partitionRange.endAddr;

        const newStart1 = newStoredPartitions.partitionRange.startAddr;
        const newEnd1 = newStoredPartitions.partitionRange.endAddr;

        // d1s = newStart1 - oldStart1
        // d1e = newEnd1 - oldEnd1

        if (oldStart1 >= oldEnd1 || newStart1 >= newEnd1) {
          throw new Error('invalid ranges');
        }

        if (ShardFunctions.setOverlap(oldStart1, oldEnd1, newStart1, newEnd1)) {
          if (ShardFunctions.setEpandedLeft(oldStart1, oldEnd1, newStart1, newEnd1)) {
            coverageChanges.push({ start: newStart1, end: oldStart1 });
          }
          if (ShardFunctions.setEpandedRight(oldStart1, oldEnd1, newStart1, newEnd1)) {
            coverageChanges.push({ start: oldEnd1, end: newEnd1 });
          }
        }
      }
    }

    if (coverageChanges.length === 0) {
      return coverageChanges;
    }

    const oldStart1 = oldStoredPartitions.partitionRange.startAddr;
    const oldEnd1 = oldStoredPartitions.partitionRange.endAddr;
    const oldStart2 = oldStoredPartitions.partitionRange2?.startAddr;
    const oldEnd2 = oldStoredPartitions.partitionRange2?.endAddr;

    const finalChanges = [];
    // post process our coverage changes.  If any of our old range overlaps subtract out the old range
    for (const coverageChange of coverageChanges) {
      if (ShardFunctions.setOverlap(oldStart1, oldEnd1, coverageChange.start, coverageChange.end)) {
        if (oldStart1 <= coverageChange.start) {
          coverageChange.start = oldEnd1;
        }
        if (oldEnd1 >= coverageChange.end) {
          coverageChange.end = oldStart1;
        }
        if (coverageChange.start >= coverageChange.end) {
          continue;
        }
      }
      if (oldStoredPartitions.rangeIsSplit) {
        if (ShardFunctions.setOverlap(oldStart2, oldEnd2, coverageChange.start, coverageChange.end)) {
          if (oldStart2 <= coverageChange.start) {
            coverageChange.start = oldEnd2;
          }
          if (oldEnd2 >= coverageChange.end) {
            coverageChange.end = oldStart2;
          }
          if (coverageChange.start >= coverageChange.end) {
            continue;
          }
        }
      }

      finalChanges.push(coverageChange);
    }

    return finalChanges;
    // this needs to understande address ranges.

    // should it also understand changed in what partitions are covered.
    // oldShardData_nodeShardData

    // calculate new and edge partitions?   then calculate change between partitions? --- NO!
  }

  static getHomeNodeSummaryObject(nodeShardData: NodeShardData): HomeNodeSummary {
    if (nodeShardData.extendedData === false) {
      return { noExtendedData: true, edge: [], consensus: [], storedFull: [] } as HomeNodeSummary;
    }
    const result = { edge: [], consensus: [], storedFull: [] } as HomeNodeSummary;

    for (const node of nodeShardData.edgeNodes) {
      result.edge.push(node.id);
    }
    for (const node of nodeShardData.consensusNodeForOurNodeFull) {
      result.consensus.push(node.id);
    }
    for (const node of nodeShardData.nodeThatStoreOurParitionFull) {
      result.storedFull.push(node.id);
    }

    result.edge.sort((a, b) => {
      return a === b ? 0 : a < b ? -1 : 1;
    });
    result.consensus.sort((a, b) => {
      return a === b ? 0 : a < b ? -1 : 1;
    });
    result.storedFull.sort((a, b) => {
      return a === b ? 0 : a < b ? -1 : 1;
    });
    return result;
  }

  static getNodeRelation(nodeShardData: NodeShardData, nodeId: string): string {
    if (nodeShardData.extendedData === false) {
      return 'failed, no extended data';
    }
    let result = '';
    if (nodeShardData.node.id === nodeId) {
      result = 'home, ';
    }

    for (const node of nodeShardData.nodeThatStoreOurParitionFull) {
      if (node.id === nodeId) {
        result += 'stored,';
      }
    }

    for (const node of nodeShardData.edgeNodes) {
      if (node.id === nodeId) {
        result += 'edge,';
      }
    }

    for (const node of nodeShardData.consensusNodeForOurNodeFull) {
      if (node.id === nodeId) {
        result += 'consensus,';
      }
    }
    return result;
  }

  static getPartitionRangeFromRadix(
    shardGlobals: ShardGlobals,
    radix: string
  ): { low: number; high: number } {
    const filledAddress = radix + '0'.repeat(64 - radix.length);
    const partition = ShardFunctions.addressToPartition(shardGlobals, filledAddress);

    const filledAddress2 = radix + 'f'.repeat(64 - radix.length);
    const partition2 = ShardFunctions.addressToPartition(shardGlobals, filledAddress2);

    return { low: partition.homePartition, high: partition2.homePartition };
  }

  static addressToPartition(
    shardGlobals: ShardGlobals,
    address: string
  ): { homePartition: number; addressNum: number } {
    const numPartitions = shardGlobals.numPartitions;
    const addressNum = parseInt(address.slice(0, 8), 16);

    // 2^32  4294967296 or 0xFFFFFFFF + 1
    const size = Math.round((0xffffffff + 1) / numPartitions);
    let homePartition = Math.floor(addressNum / size);
    if (homePartition === numPartitions) {
      homePartition = homePartition - 1;
    }

    return { homePartition, addressNum };
  }

  static addressNumberToPartition(shardGlobals: ShardGlobals, addressNum: number): number {
    const numPartitions = shardGlobals.numPartitions;
    // 2^32  4294967296 or 0xFFFFFFFF + 1
    const size = Math.round((0xffffffff + 1) / numPartitions);
    let homePartition = Math.floor(addressNum / size);
    if (homePartition === numPartitions) {
      homePartition = homePartition - 1;
    }

    return homePartition;
  }

  static findHomeNode(
    shardGlobals: ShardGlobals,
    address: string,
    partitionShardDataMap: Map<number, ShardInfo>
  ): NodeShardData | null {
    const { homePartition } = ShardFunctions.addressToPartition(shardGlobals, address);
    const partitionShard = partitionShardDataMap.get(homePartition);

    if (partitionShard == null) {
      return null;
    }
    if (partitionShard.homeNodes.length === 0) {
      return null;
    }
    return partitionShard.homeNodes[0];
  }

  static circularDistance(a: number, b: number, max: number): number {
    const directDist = Math.abs(a - b);
    let wrapDist = directDist;
    // if (a < b) {
    //   wrapDist = Math.abs(a + (max - b))
    // } else if (b < a) {
    //   wrapDist = Math.abs(b + (max - a))
    // }
    const wrapDist1 = Math.abs(a + (max - b));
    const wrapDist2 = Math.abs(b + (max - a));
    wrapDist = Math.min(wrapDist1, wrapDist2);

    return Math.min(directDist, wrapDist);
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
   * @returns {array} result [results, extras]  TODO, convert the array response to a type object that has results and extras
   */
  static mergeNodeLists(listA: Shardus.Node[], listB: Shardus.Node[]): Shardus.Node[][] {
    const results = [] as Shardus.Node[];
    const extras = [] as Shardus.Node[];
    const nodeSet = new Set();
    for (const node of listA) {
      nodeSet.add(node);
      results.push(node);
    }
    for (const node of listB) {
      if (!nodeSet.has(node)) {
        results.push(node);
        extras.push(node);
      }
    }
    return [results, extras];
  }

  // A - B
  /**
   * @param {Shardus.Node[]} listA
   * @param {Shardus.Node[]} listB
   * @returns {Shardus.Node[]} results list
   */
  static subtractNodeLists(listA: Shardus.Node[], listB: Shardus.Node[]): Shardus.Node[] {
    const results = [] as Shardus.Node[];
    const nodeSet = new Set();
    for (const node of listB) {
      nodeSet.add(node);
    }
    for (const node of listA) {
      if (!nodeSet.has(node)) {
        results.push(node);
      }
    }
    return results;
  }

  static partitionToAddressRange2(
    shardGlobals: ShardGlobals,
    partition: number,
    partitionMax?: number
  ): AddressRange {
    const result = {} as AddressRange;
    result.partition = partition;

    // 2^32  4294967296 or 0xFFFFFFFF + 1
    const size = Math.round((0xffffffff + 1) / shardGlobals.numPartitions);
    const startAddr = partition * size;

    result.p_low = partition;

    let endPartition = partition + 1;
    if (partitionMax) {
      result.p_high = partitionMax;
      endPartition = partitionMax + 1;
    } else {
      //result.p_high = partition
    }
    result.partitionEnd = endPartition;
    let endAddr = endPartition * size;

    // compounded rounding errors can reach up to num partitions at worst
    const roundingErrorSupport = shardGlobals.numPartitions;

    //fix for int precision problem where id of the highest shard rolls over
    if (endAddr >= 4294967295 - roundingErrorSupport) {
      endAddr = 4294967295;
    } else {
      // If we are not at the end of our max range then need to back up one to stay in the same partition as the start address
      endAddr = endAddr - 1; //subtract 1 so we do not overlap!
    }

    if (endPartition === shardGlobals.numPartitions) {
      endPartition = shardGlobals.numPartitions - 1;
      result.partitionEnd = endPartition;
    }

    result.startAddr = startAddr;
    result.endAddr = endAddr;

    result.low = ('00000000' + startAddr.toString(16)).slice(-8) + '0'.repeat(56);
    result.high = ('00000000' + endAddr.toString(16)).slice(-8) + 'f'.repeat(56);

    return result;
  }

  /**
   * NOTE this is a raw answer.  edge cases with consensus node coverage can increase the results of our raw answer that is given here
   * @param {ShardGlobals} shardGlobals
   * @param {Map<string, NodeShardData>} nodeShardDataMap
   * @param {number} partition
   * @param {string[]} exclude
   * @param {Node[]} activeNodes
   */
  static getNodesThatCoverPartitionRaw(
    shardGlobals: ShardGlobals,
    nodeShardDataMap: Map<string, NodeShardData>,
    partition: number,
    exclude: string[],
    activeNodes: Shardus.Node[]
  ): Shardus.Node[] {
    const results = [] as Shardus.Node[];

    // TODO perf.  (may be tricky to improve), should probably be part of a comprehensive set of improvements that consider networks with millions of nodes
    // -is there a smart way to cache results.
    // -is there a more efficient way to pre calculate this (but keep in mind we may need to be lazy about shard calculations in the future)
    // -  instead of looking at all nodes could we pick a staring point and expand our search
    for (let i = 0; i < activeNodes.length; i++) {
      // eslint-disable-next-line security/detect-object-injection
      const node = activeNodes[i];

      if (exclude.includes(node.id)) {
        continue;
      }
      const nodeShardData = nodeShardDataMap.get(node.id);

      if (nodeShardData == null) {
        continue;
      }
      if (nodeShardData.storedPartitions == null) {
        nodeShardData.storedPartitions = ShardFunctions.calculateStoredPartitions2(
          shardGlobals,
          nodeShardData.homePartition
        );
      }
      if (ShardFunctions.testInRange(partition, nodeShardData.storedPartitions) !== true) {
        continue;
      }

      results.push(node);
    }
    return results;
  }

  static getCombinedNodeLists(
    shardGlobals: ShardGlobals,
    thisNode: NodeShardData,
    nodeShardDataMap: NodeShardDataMap,
    activeNodes: Shardus.Node[]
  ): Record<string, P2P.NodeListTypes.Node[]> {
    const consensusNodeForOurNode = [] as Shardus.Node[];
    const consensusNodeForOurNodeFull = [] as Shardus.Node[];
    const nodeThatStoreOurPartition = [] as Shardus.Node[];
    const nodeThatStoreOurPartitionFull = [] as Shardus.Node[];
    const edgeNodes = [] as Shardus.Node[];
    const homePartition = thisNode.homePartition;

    let partition =
      this.modulo(
        homePartition - (shardGlobals.consensusRadius + shardGlobals.nodesPerEdge),
        shardGlobals.numPartitions
      ) - 1;
    let maxScanNeeded = 2 * shardGlobals.consensusRadius + 2 * shardGlobals.nodesPerEdge + 1;
    if (maxScanNeeded > activeNodes.length) maxScanNeeded = activeNodes.length;

    for (let i = 0; i < maxScanNeeded; i++) {
      let isInConsensusRange = false;
      let isInPartitionRange = false;
      partition = this.modulo(partition + 1, shardGlobals.numPartitions);
      if (partition >= activeNodes.length) {
        partition = 0;
      }

      // eslint-disable-next-line security/detect-object-injection
      const node = activeNodes[partition];

      if (node == thisNode.node) {
        nodeThatStoreOurPartitionFull.push(node);
        consensusNodeForOurNodeFull.push(node);
        continue;
      }

      if (ShardFunctions.testInRange(partition, thisNode.storedPartitions)) {
        nodeThatStoreOurPartition.push(node);
        nodeThatStoreOurPartitionFull.push(node);
        isInPartitionRange = true;
      }
      if (ShardFunctions.testInRange(partition, thisNode.consensusPartitions)) {
        consensusNodeForOurNode.push(node);
        consensusNodeForOurNodeFull.push(node);
        isInConsensusRange = true;
      }
      if (isInPartitionRange && !isInConsensusRange) {
        edgeNodes.push(node);
      }
    }
    // console.log('Running getCombinedNodeList', shardGlobals, thisNode, nodeShardDataMap, edgeNodes)
    // console.log('Home Partition', thisNode.homePartition)
    // console.log(
    //   'nodeThatStoreOurPartition',
    //   nodeThatStoreOurPartition.map((node) => {
    //     return nodeShardDataMap.get(node.id).ourNodeIndex
    //   })
    // )
    return {
      nodeThatStoreOurPartition,
      nodeThatStoreOurPartitionFull,
      consensusNodeForOurNode,
      consensusNodeForOurNodeFull,
      edgeNodes,
    };
  }

  /**
   * NOTE this is a raw answer.  edge cases with consensus node coverage can increase the results of our raw answer that is given here
   * @param {ShardGlobals} shardGlobals
   * @param {Map<string, NodeShardData>} nodeShardDataMap
   * @param {number} partition
   * @param {string[]} exclude
   * @param {Node[]} activeNodes
   */
  static getNodesThatCoverHomePartition(
    shardGlobals: ShardGlobals,
    thisNode: NodeShardData,
    nodeShardDataMap: Map<string, NodeShardData>,
    activeNodes: Shardus.Node[]
  ): Shardus.Node[] {
    const results = [] as Shardus.Node[];
    const homePartition = thisNode.homePartition;

    const searchRight = true;
    let index = homePartition;
    //let failCount = 0
    const startIndex = index;
    let once = false;
    while (searchRight) {
      // if (failCount > 1) {
      //   searchRight = false
      //   break
      // }

      if (index >= activeNodes.length) {
        index = 0;
      }
      //check for a complete wrap if we have full coverage
      //this only happens when there is no sharding yet. numnodes *2 = consenus range  (approx)
      //we could break this logic out above in a separate check but I think this is ok for now (not too costly)
      if (startIndex === index && once) {
        return results;
      }
      once = true;

      // eslint-disable-next-line security/detect-object-injection
      const node = activeNodes[index];
      index++;

      if (node == thisNode.node) continue;

      const nodeShardData = nodeShardDataMap.get(node.id);
      if (nodeShardData == null) {
        continue;
      }
      if (nodeShardData.storedPartitions == null) {
        nodeShardData.storedPartitions = ShardFunctions.calculateStoredPartitions2(
          shardGlobals,
          nodeShardData.homePartition
        );
      }
      if (ShardFunctions.testInRange(homePartition, nodeShardData.storedPartitions) !== true) {
        //failCount++
        break;
      }
      results.push(node);
    }
    const searchLeft = true;
    index = homePartition;
    //failCount = 0
    while (searchLeft) {
      // if (failCount > 2) {
      //   searchLeft = false
      //   break
      // }

      if (index < 0) {
        index = activeNodes.length - 1;
      }
      // eslint-disable-next-line security/detect-object-injection
      const node = activeNodes[index];
      index--;

      if (node == thisNode.node) continue;

      const nodeShardData = nodeShardDataMap.get(node.id);
      if (nodeShardData == null) {
        continue;
      }
      if (nodeShardData.storedPartitions == null) {
        nodeShardData.storedPartitions = ShardFunctions.calculateStoredPartitions2(
          shardGlobals,
          nodeShardData.homePartition
        );
      }
      if (ShardFunctions.testInRange(homePartition, nodeShardData.storedPartitions) !== true) {
        //failCount++
        break;
      }
      results.push(node);
    }
    return results;
  }

  static getEdgeNodes(
    shardGlobals: ShardGlobals,
    thisNode: NodeShardData,
    nodeShardDataMap: Map<string, NodeShardData>,
    activeNodes: Shardus.Node[]
  ): Shardus.Node[] {
    const results = [];
    const homePartition = thisNode.homePartition;

    let rightIndex = homePartition - shardGlobals.consensusRadius;
    const startIndex = rightIndex;
    let once = false;
    let edgeRadius = shardGlobals.nodesPerConsenusGroup - shardGlobals.consensusRadius;
    if (activeNodes.length <= shardGlobals.nodesPerConsenusGroup) return [];
    if (edgeRadius > activeNodes.length) {
      edgeRadius = activeNodes.length;
    }

    for (let i = 0; i < edgeRadius; i++) {
      rightIndex -= 1;
      if (rightIndex < 0) {
        if (activeNodes.length + rightIndex < 0) {
          rightIndex = 0;
        } else {
          rightIndex = activeNodes.length + rightIndex; // rightIndex (on right side of eqn) is a negative value here
        }
      }
      if (this.testInRange(rightIndex, thisNode.consensusPartitions)) {
        break;
      }

      if (startIndex === homePartition && once) {
        return Object.values(results);
      }
      once = true;
      // eslint-disable-next-line security/detect-object-injection
      const node = activeNodes[rightIndex];

      if (!node) {
        throw new Error(`Unable to get node for right index ${rightIndex}`);
      }
      if (node == thisNode.node) continue;
      results.push(node);
    }

    let leftIndex = homePartition + shardGlobals.consensusRadius;
    for (let i = 0; i < edgeRadius; i++) {
      leftIndex += 1;
      if (leftIndex >= activeNodes.length) {
        if (leftIndex - activeNodes.length >= activeNodes.length) {
          leftIndex = activeNodes.length - 1;
        } else {
          leftIndex = leftIndex - activeNodes.length;
        }
      }
      if (this.testInRange(leftIndex, thisNode.consensusPartitions)) {
        break;
      }

      if (startIndex === leftIndex && once) {
        return Object.values(results);
      }
      once = true;
      // eslint-disable-next-line security/detect-object-injection
      const node = activeNodes[leftIndex];

      if (!node) {
        throw new Error(`Unable to get node for left leftIndex ${leftIndex}`);
      }

      if (node == thisNode.node) continue;

      results.push(node);
    }
    return results;
  }

  /**
   * getNeigborNodesInRange
   * get nodes in count range to either side of our node
   * position should be the position of the home node
   * @param {number} position
   * @param {number} radius
   * @param {string[]} exclude
   * @param {P2P.NodeListTypes.Node[]} allNodes
   */
  static getNeigborNodesInRange(
    position: number,
    radius: number,
    exclude: string[],
    allNodes: P2P.NodeListTypes.Node[]
  ): Shardus.Node[] {
    // let allNodes = this.p2p.state.getNodesOrdered() // possibly faster version that does not need a copy
    const results = [] as Shardus.Node[];
    let scanStart = position - radius; // have to pick floor or ceiling and be consistent.
    if (scanStart < 0) {
      scanStart = allNodes.length + scanStart;

      // make sure the index is 0 or above
      if (scanStart < 0) {
        scanStart = 0;
      }
    }

    const scanAmount = radius * 2 + 1;
    let scanCount = 0;
    const expectedNodes = Math.min(allNodes.length - exclude.length, scanAmount - exclude.length);

    // if we need to scan all the nodes, just do that here in a simple way
    if (scanAmount >= allNodes.length) {
      for (let i = 0; i < allNodes.length; i++) {
        // eslint-disable-next-line security/detect-object-injection
        const node = allNodes[i];
        if (exclude.includes(node.id)) {
          continue;
        }
        if (node.status === 'active') {
          results.push(node);
        }
      }
      return results;
    }

    //TODO found a bug here. the consensus radius needs to hold one more node!!! (update: it appears this bug has been fixed when
    //     scanAmount became radius*2 + 1 instead of radius*2 in older commented out calculations)
    //     could write test code to validate this is fixed for 0-n active nodes.

    let scanIndex = scanStart;
    for (let i = 0; i < scanAmount; i++) {
      scanCount++;
      if (scanCount >= allNodes.length) {
        break;
      }
      if (scanIndex >= allNodes.length) {
        scanIndex = 0;
      }
      // eslint-disable-next-line security/detect-object-injection
      const node = allNodes[scanIndex];
      if (exclude.includes(node.id)) {
        scanIndex++;
        continue;
      }
      if (node.status === 'active') {
        results.push(node);
      }
      scanIndex++;
      // This does not work if we skip over it due to exclude
      if (scanIndex === scanStart) {
        break; // we looped
      }
      if (results.length >= expectedNodes) {
        break;
      }
    }
    return results;
  }

  // todo count should be based off of something in shard globals.  this will matter for large networks. (update:
  //      I don't think this is an urgent issue, but should be considered when we think about millions of nodes)
  //      It is possible that code that uses this may end up getting nodes returned that wouldn't cover the data.
  //      Perhaps a different approch would be better where we just get nodes that are consensus or store the data

  /**
   * getNodesByProximity This builds a sorted list of nodes based on how close they are to a given address
   * @param {ShardGlobals} shardGlobals
   * @param {Shardus.Node[]} activeNodes
   * @param {number} position
   * @param {string} excludeID
   * @param {number} [count]
   * @param {boolean} [centeredScan]
   */
  static getNodesByProximity(
    shardGlobals: ShardGlobals,
    activeNodes: Shardus.Node[],
    position: number,
    excludeID: string,
    count = 10,
    centeredScan = false
  ): Shardus.Node[] {
    const allNodes = activeNodes;
    const results = [] as Shardus.Node[];
    let leftScanIndex = position;
    let rightScanIndex = position - 1;
    let maxIterations = Math.ceil(count / 2);
    if (centeredScan) {
      maxIterations++;
    }
    for (let i = 0; i < maxIterations; i++) {
      leftScanIndex--;
      rightScanIndex++;
      if (rightScanIndex >= allNodes.length) {
        rightScanIndex = 0;
      }
      if (leftScanIndex < 0) {
        leftScanIndex = allNodes.length - 1;
      }
      // eslint-disable-next-line security/detect-object-injection
      let node = allNodes[rightScanIndex];
      if (node != null && node.id !== excludeID) {
        if (node.status === 'active') {
          results.push(node);
          if (results.length === count) {
            return results;
          }
        }
      }

      if (centeredScan && i === maxIterations - 1) {
        break; // done, because we don't need the left index.
      }

      // eslint-disable-next-line security/detect-object-injection
      node = allNodes[leftScanIndex];
      if (node != null && node.id !== excludeID) {
        if (node.status === 'active') {
          results.push(node);
          if (results.length === count) {
            return results;
          }
        }
      }

      if (rightScanIndex === leftScanIndex) {
        break; // we looped
      }
      // check if our pointers have looped around
      if ((rightScanIndex - leftScanIndex) * (rightScanIndex - leftScanIndex) === 1) {
        // but only if we are past the first step. (since on the first step we are 1 apart.)
        // but if maxIterations is really low can bail early, not sure that would matte anyways.
        if (i > 0 || maxIterations <= 1) {
          break; // we almost looped
        }
      }
    }
    return results;
  }

  /**
   * findCenterAddressPair
   * @param {string} lowAddress
   * @param {string} highAddress
   * TSConversion  fix up any[] with a wrapped object.
   */
  static findCenterAddressPair(lowAddress: string, highAddress: string): string[] {
    const leftAddressNum = parseInt(lowAddress.slice(0, 8), 16);
    const nodeAddressNum = parseInt(highAddress.slice(0, 8), 16);

    const centerNum = Math.round((leftAddressNum + nodeAddressNum) * 0.5);

    const addressPrefixHex = ShardFunctions.leadZeros8(centerNum.toString(16));
    const addressPrefixHex2 = ShardFunctions.leadZeros8((centerNum + 1).toString(16));

    const centerAddr = addressPrefixHex + 'f'.repeat(56);
    const centerAddrPlusOne = addressPrefixHex2 + '0'.repeat(56);
    return [centerAddr, centerAddrPlusOne];
  }

  /**
   * This will find two address that are close to what we want
   * @param {string} address
   * @returns {{address1:string; address2:string}}
   * WARNING this only works input ends in all Fs after first byte.
   *
   */
  static getNextAdjacentAddresses(address: string): { address1: string; address2: string } {
    const addressNum = parseInt(address.slice(0, 8), 16);

    const addressPrefixHex = ShardFunctions.leadZeros8(addressNum.toString(16));
    const addressPrefixHex2 = ShardFunctions.leadZeros8((addressNum + 1).toString(16));

    const address1 = addressPrefixHex + 'f'.repeat(56);
    const address2 = addressPrefixHex2 + '0'.repeat(56);
    return { address1, address2 }; // is this valid: as {address1:string; address2:string}
  }

  static getCenterHomeNode(
    shardGlobals: ShardGlobals,
    partitionShardDataMap: PartitionShardDataMap,
    lowAddress: string,
    highAddress: string
  ): NodeShardData | null {
    const [centerAddr] = ShardFunctions.findCenterAddressPair(lowAddress, highAddress);

    return ShardFunctions.findHomeNode(shardGlobals, centerAddr, partitionShardDataMap);
  }

  /**
   * debug wrapper with exception handling for fastStableCorrespondingIndicies:
   * @param {number} fromListSize
   * @param {number} toListSize
   * @param {number} fromListIndex
   */
  static debugFastStableCorrespondingIndicies(
    fromListSize: number,
    toListSize: number,
    fromListIndex: number
  ): number[] {
    let results = [] as number[];
    try {
      results = ShardFunctions.fastStableCorrespondingIndicies(fromListSize, toListSize, fromListIndex);
    } catch (ex) {
      throw new Error(
        `stack overflow fastStableCorrespondingIndicies( ${fromListSize},  ${toListSize}, ${fromListIndex} )`
      );
    }

    return results;
  }

  /**
   * Takes a list size of a from array and a list size of a to array.
   * uses the passed in index into list one to determine a list of indicies
   * that the from node would need to send a corresponding message to.
   * @param {number} fromListSize
   * @param {number} toListSize
   * @param {number} fromListIndex
   */
  static fastStableCorrespondingIndicies(
    fromListSize: number,
    toListSize: number,
    fromListIndex: number
  ): number[] {
    const results = [] as number[];
    if (fromListSize >= toListSize) {
      let value = Math.round((fromListIndex / fromListSize) * toListSize);
      if (value === 0) {
        value = 1;
      }
      results.push(value);
    } else {
      const targetIndex = Math.round(fromListIndex * (toListSize / fromListSize));
      const range = Math.round(toListSize / fromListSize);
      const start = Math.max(1, targetIndex - range);
      const stop = Math.min(toListSize, targetIndex + range);
      for (let i = start; i <= stop; i++) {
        const res = ShardFunctions.fastStableCorrespondingIndicies(toListSize, fromListSize, i);
        if (res[0] === fromListIndex) {
          results.push(i);
        }
      }
    }
    return results;
  }

  /**
   * partitionInWrappingRange
   * test if partition i is in the range of min and max P
   * This function understands wrapping, so that the min boundary can be
   * a higher number than the max boundary that wraps around back to 0
   * @param {number} i
   * @param {number} minP
   * @param {number} maxP
   */
  static partitionInWrappingRange(i: number, minP: number, maxP: number): boolean {
    const key = i;
    if (minP === maxP) {
      if (i !== minP) {
        return false;
      }
    } else if (maxP > minP) {
      // are we outside the min to max range
      if (key < minP || key > maxP) {
        return false;
      }
    } else {
      // are we inside the min to max range (since the covered rage is inverted)
      if (key > maxP && key < minP) {
        return false;
      }
    }
    return true;
  }

  private static modulo(number: number, base: number): number {
    return ((number % base) + base) % base;
  }
}

//module.exports = ShardFunctions

export default ShardFunctions;

export function addressToPartition(
  shardGlobals: ShardGlobals,
  address: string
): { homePartition: number; addressNum: number } {
  return ShardFunctions.addressToPartition(shardGlobals, address);
}

export function partitionInWrappingRange(i: number, minP: number, maxP: number): boolean {
  return ShardFunctions.partitionInWrappingRange(i, minP, maxP);
}

export function findHomeNode(
  shardGlobals: ShardGlobals,
  address: string,
  partitionShardDataMap: Map<number, ShardInfo>
): NodeShardData | null {
  return ShardFunctions.findHomeNode(shardGlobals, address, partitionShardDataMap);
}
