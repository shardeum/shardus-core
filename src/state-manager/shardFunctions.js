
// const utils = require('../utils')
const stringify = require('fast-stable-stringify')

// const cSetNoOverlapIfGTE = 16
// const cSetSuperIfGTE = 4
// const cSetEqualIfEQ = 0
// const cSetSuperLeftMask = 8
// const cSetSuperRightMask = 4

/**
 * @typedef {import('../shardus/index').Node} Node
 */

class ShardFunctions {
  /**
   * @typedef {Object} ShardGlobals global shard values
   * @property {number} numActiveNodes number of active nodes
   * @property {number} nodesPerConsenusGroup number of nodes per consesus group
   * @property {number} numPartitions number of partitions
   * @property {number} numVisiblePartitions default number of partitions that are visible to a node (ege or consensus)
   * @property {number} consensusRadius consenus radius (number of nodes to each side of us that hold consensus data)
   * @property {number} nodeLookRange Address range to look left and right (4 byte numeric)
   * @property {number} endAddr End address in numeric form (4 bytes)
   */

  /**
   * calculateShardGlobals
   * @param {number} numNodes
   * @param {number} nodesPerConsenusGroup
   */
  static calculateShardGlobals (numNodes, nodesPerConsenusGroup) {
    /**
     * @type {ShardGlobals}
     */
    let shardGlobals = {}

    if (nodesPerConsenusGroup % 2 === 0) {
      nodesPerConsenusGroup++
      console.log('upgrading consensus size to odd number: ' + nodesPerConsenusGroup)
    }

    shardGlobals.numActiveNodes = numNodes
    shardGlobals.nodesPerConsenusGroup = nodesPerConsenusGroup
    shardGlobals.numPartitions = shardGlobals.numActiveNodes
    shardGlobals.numVisiblePartitions = 2 * shardGlobals.nodesPerConsenusGroup
    shardGlobals.consensusRadius = Math.floor((nodesPerConsenusGroup - 1) / 2)
    let partitionStoreRadius = (((shardGlobals.numVisiblePartitions) / 2) + 0) // removed the +1.0 that was getting added before we divded by two.  also the .5
    shardGlobals.nodeLookRange = Math.floor((partitionStoreRadius / shardGlobals.numPartitions) * 0xffffffff) // 0.5 added since our search will look from the center of a partition

    return shardGlobals
  }

  static leadZeros8 (input) {
    return ('00000000' + input).slice(-8)
  }

  /**
   * @typedef {Object} ShardInfo global shard values
   * @property {string} address address used in calculation
   * @property {Node[]} homeNodes number of active nodes    todo get p2p node info
   * @property {number} addressPrefix numeric address prefix
   * @property {string} addressPrefixHex number of partitions
   * @property {number} homePartition the home partition
   * @property {AddressRange} homeRange consenus radius (number of nodes to each side of us that hold consensus data)
   * @property {any} coveredBy the nodes that cover us for consenus.  todo make this a object of string->node
   */

  static calculateShardValues (shardGlobals, address) {
    /**
     * @type {ShardInfo}
     */
    let shardinfo = {}
    shardinfo.address = address
    shardinfo.homeNodes = []
    shardinfo.addressPrefix = parseInt(address.slice(0, 8), 16)
    shardinfo.addressPrefixHex = ShardFunctions.leadZeros8((shardinfo.addressPrefix).toString(16))
    shardinfo.homePartition = Math.floor(shardGlobals.numPartitions * (shardinfo.addressPrefix / 0xffffffff))
    shardinfo.homeRange = ShardFunctions.partitionToAddressRange2(shardGlobals, shardinfo.homePartition)
    shardinfo.coveredBy = {} // consensus nodes that cover us.
    return shardinfo
  }

  /**
   * @typedef {Object} StoredPartition Data for a StoredPartition
   * @property {AddressRange} homeRange range for the home partition
   * @property {boolean} rangeIsSplit is the range split
   * @property {number} partitionStart Starting index
   * @property {number} partitionEnd End index
   * @property {number} [partitionStart1] The user's age.
   * @property {number} [partitionEnd1] End index
   * @property {number} [partitionStart2] The user's age.
   * @property {number} [partitionEnd2] End index
   * @property {{ start: number; dist: number; end: number; }} [partitionRangeVector]
   * @property {number} [x] For debug: shardGlobals.nodesPerConsenusGroup
   * @property {number} [n] For debug: homePartition
   * @property {AddressRange} [partitionRange]
   * @property {AddressRange} [partitionRange2]
   */

  static calculateStoredPartitions2 (shardGlobals, homePartition) {
  /**
   * @type {StoredPartition}
   */
    let storedPartitions = {}

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

    storedPartitions.partitionStart = (n - x)
    storedPartitions.partitionEnd = (n + x)

    ShardFunctions.calculateStoredPartitions2Ranges(shardGlobals, storedPartitions)

    return storedPartitions
  }

  /**
   * @param {ShardGlobals} shardGlobals
   * @param {StoredPartition} storedPartitions
   */
  static calculateStoredPartitions2Ranges (shardGlobals, storedPartitions) {
    storedPartitions.partitionRangeVector = { start: storedPartitions.partitionStart, dist: 2 * shardGlobals.nodesPerConsenusGroup, end: storedPartitions.partitionEnd }
    storedPartitions.rangeIsSplit = false

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

    // did we wrap to cover the entire range, that should have early outed at the top of the function
    if (storedPartitions.rangeIsSplit === true && (storedPartitions.partitionStart1 === storedPartitions.partitionEnd2 || storedPartitions.partitionStart2 === storedPartitions.partitionEnd1)) {
      throw new Error('this should never happen: ' + stringify(storedPartitions) + 'globals: ' + stringify(shardGlobals))
    }
    if (storedPartitions.rangeIsSplit) {
      storedPartitions.partitionRange = ShardFunctions.partitionToAddressRange2(shardGlobals, storedPartitions.partitionStart1, storedPartitions.partitionEnd1)
      storedPartitions.partitionRange2 = ShardFunctions.partitionToAddressRange2(shardGlobals, storedPartitions.partitionStart2, storedPartitions.partitionEnd2)
    } else {
      storedPartitions.partitionRange = ShardFunctions.partitionToAddressRange2(shardGlobals, storedPartitions.partitionStart, storedPartitions.partitionEnd)
    }
  }

  static testAddressInRange (address, storedPartitions) {
    if (storedPartitions.rangeIsSplit) {
      if ((address >= storedPartitions.partitionRange.low && address <= storedPartitions.partitionRange.high) ||
      (address >= storedPartitions.partitionRange2.low && address <= storedPartitions.partitionRange2.high)) {
        return true
      }
    } else {
      if (address >= storedPartitions.partitionRange.low && address <= storedPartitions.partitionRange.high) {
        return true
      }
    }
    return false
  }

  static testInRange (partition, storedPartitions) {
    if (storedPartitions.rangeIsSplit) {
      if ((partition >= storedPartitions.partitionStart1 && partition <= storedPartitions.partitionEnd1) ||
      (partition >= storedPartitions.partitionStart2 && partition <= storedPartitions.partitionEnd2)) {
        return true
      }
    } else {
      if (partition >= storedPartitions.partitionStart && partition <= storedPartitions.partitionEnd) {
        return true
      }
    }
    return false
  }

  static getPartitionsCovered (storedPartitions) {
    let covered
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

  static computePartitionShardDataMap (shardGlobals, parititionShardDataMap, partitionStart, partitionsToScan) {
    let partitionIndex = partitionStart

    let numPartitions = shardGlobals.numPartitions

    for (let i = 0; i < partitionsToScan; ++i) {
      if (partitionIndex >= numPartitions) {
        partitionIndex = 0
      }
      let fpAdressCenter = ((i + 0.5) / numPartitions)
      let addressPrefix = Math.floor(fpAdressCenter * 0xffffffff)

      let addressPrefixHex = ShardFunctions.leadZeros8((addressPrefix).toString(16))
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

  static computeNodePartitionDataMap (shardGlobals, nodeShardDataMap, nodesToGenerate, parititionShardDataMap, activeNodes, extendedData) {
    for (let node of nodesToGenerate) {
      let nodeShardData = nodeShardDataMap.get(node.id)
      if (!nodeShardData) {
        nodeShardData = ShardFunctions.computeNodePartitionData(shardGlobals, node, nodeShardDataMap, parititionShardDataMap, activeNodes, false)
      }
      // if (extendedData) {
      //   ShardFunctions.computeExtendedNodePartitionData(shardGlobals, nodeShardDataMap, parititionShardDataMap, nodeShardData, activeNodes)
      // }
    }
    // second pass for extended data
    for (let node of nodesToGenerate) {
      let nodeShardData = nodeShardDataMap.get(node.id)
      // if (!nodeShardData) {
      //   nodeShardData = ShardFunctions.computeNodePartitionData(shardGlobals, node, nodeShardDataMap, parititionShardDataMap, activeNodes, extendedData)
      // }
      if (extendedData) {
        ShardFunctions.computeExtendedNodePartitionData(shardGlobals, nodeShardDataMap, parititionShardDataMap, nodeShardData, activeNodes)
      }
    }
    // need some post update step.

    // if (extendedData) {
    // for( let node of nodesToGenerate ){

    //   ShardFunctions.updateFullConsensusGroup(shardGlobals, nodeShardDataMap, nodesToGenerate, parititionShardDataMap, activeNodes, extendedData)
    // }
    // }
  }

  static computeNodePartitionDataMapExt (shardGlobals, nodeShardDataMap, nodesToGenerate, parititionShardDataMap, activeNodes) {
    for (let node of nodesToGenerate) {
      let nodeShardData = nodeShardDataMap.get(node.id)
      if (!nodeShardData) {
        nodeShardData = ShardFunctions.computeNodePartitionData(shardGlobals, node, nodeShardDataMap, parititionShardDataMap, activeNodes)
      }
      // ShardFunctions.computeExtendedNodePartitionData(shardGlobals, nodeShardDataMap, parititionShardDataMap, nodeShardData, activeNodes)
      //
      // this wont be able to extend things though.
      ShardFunctions.updateFullConsensusGroup(shardGlobals, nodeShardDataMap, parititionShardDataMap, nodeShardData, activeNodes)
    }
  }

  /**
   * @typedef {Object} NodeShardData shard data for a node
   * @property {Node} node our node
   * @property {number} nodeAddressNum numeric address prefix
   * @property {number} homePartition number of partitions
   * @property {number} centeredAddress the home partition
   * @property {number} ourNodeIndex the home partition
   * @property {number} consensusStartPartition
   * @property {number} consensusEndPartition
   * @property {boolean} extendedData have we calculated extended data yet
   * @property {boolean} needsUpdateToFullConsensusGroup
   * extended data below here
   * @property {StoredPartition} storedPartitions consenus radius (number of nodes to each side of us that hold consensus data)
   * @property {Map<string,Node>} coveredBy the nodes that cover us for consenus
   * @property {Node[]} nodeThatStoreOurParition
   * @property {Node[]} nodeThatStoreOurParitionFull
   * @property {Node[]} consensusNodeForOurNode
   * @property {Node[]} consensusNodeForOurNodeFull
   * @property {Node[]} edgeNodes
   * @property {Node[]} c2NodeForOurNode
   * @property {Node[]} outOfDefaultRangeNodes
   */

  static computeNodePartitionData (shardGlobals, node, nodeShardDataMap, parititionShardDataMap, activeNodes, extendedData) {
    let numPartitions = shardGlobals.numPartitions

    /**
     * @type {NodeShardData}
     */
    let nodeShardData = {}
    let nodeAddressNum = parseInt(node.id.slice(0, 8), 16)
    let homePartition = Math.floor(numPartitions * (nodeAddressNum / 0xffffffff))
    let centeredAddress = Math.floor(((homePartition + 0.5) * 0xffffffff) / numPartitions)

    nodeShardData.node = node
    nodeShardData.nodeAddressNum = nodeAddressNum
    nodeShardData.homePartition = homePartition
    nodeShardData.centeredAddress = centeredAddress
    // nodeShardData.extraWatchedPartitions = 0 // unused

    nodeShardData.ourNodeIndex = activeNodes.findIndex(function (_node) { return _node.id === node.id })

    nodeShardData.consensusStartPartition = homePartition
    nodeShardData.consensusEndPartition = homePartition

    // push the data in to the correct homenode list for the home partition
    let partitionShard = parititionShardDataMap.get(homePartition)
    if (partitionShard == null) {
      partitionShard = parititionShardDataMap.get(homePartition)
    }

    if (nodeShardData.ourNodeIndex !== -1) {
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

  static updateFullConsensusGroup (shardGlobals, nodeShardDataMap, parititionShardDataMap, nodeShardData, activeNodes) {
    let homePartition = nodeShardData.homePartition
    let shardPartitionData = parititionShardDataMap.get(homePartition)

    // let changes = false
    // for(let node of nodeShardData.consensusNodeForOurNodeFull){
    //   if(shardPartitionData.coveredBy.has(node.id) === false){

    //     nodeShardData.consensusNodeForOurNodeFull.push(shardPartitionData.coveredBy.get(node.id))
    //     changes = true
    //   }

    // }

    // if we dont have full data then we need to walk left and right of our minand max consensus nodes untill we find one that does not track our home partition
    //  any new ones we encouter should be added to our full range.

    // if we calculate full data this version is good enough:

    nodeShardData.consensusNodeForOurNodeFull = Object.values(shardPartitionData.coveredBy)
    nodeShardData.needsUpdateToFullConsensusGroup = false
    nodeShardData.consensusNodeForOurNodeFull.sort(ShardFunctions.nodeSort)

    // merge into our full list for sake of TX calcs.  todo could try to be smart an only do this in some cases.
    let [results] = ShardFunctions.mergeNodeLists(nodeShardData.nodeThatStoreOurParition, nodeShardData.consensusNodeForOurNodeFull)

    // not sure if we need to do this
    // if (extras.length > 0) {
    //   ShardFunctions.dilateNeighborCoverage(shardGlobals, nodeShardDataMap, parititionShardDataMap, activeNodes, nodeShardData, extras)
    // }

    nodeShardData.nodeThatStoreOurParitionFull = results
  }

  /**
   * @param {ShardGlobals} shardGlobals
   * @param {Map<string, NodeShardData>} nodeShardDataMap
   * @param {Map<number, ShardInfo>} parititionShardDataMap
   * @param {NodeShardData} nodeShardData
   * @param {Node[]} activeNodes
   */
  static computeExtendedNodePartitionData (shardGlobals, nodeShardDataMap, parititionShardDataMap, nodeShardData, activeNodes) {
    if (nodeShardData.extendedData) {
      return
    }

    nodeShardData.extendedData = true
    if (nodeShardData.storedPartitions == null) {
      nodeShardData.storedPartitions = ShardFunctions.calculateStoredPartitions2(shardGlobals, nodeShardData.homePartition)
    }

    let exclude = [nodeShardData.node.id]
    let excludeNodeArray = [nodeShardData.node]

    // tried a better way but it dies of needing data we dont have yet..
    nodeShardData.nodeThatStoreOurParition = ShardFunctions.getNodesThatCoverParitionRaw(shardGlobals, nodeShardDataMap, nodeShardData.homePartition, exclude, activeNodes)
    // nodeShardData.nodeThatStoreOurParition = ShardFunctions.getNodesThatCoverRange(shardGlobals, nodeShardData.storedPartitions.homeRange.low, nodeShardData.storedPartitions.homeRange.high, exclude, activeNodes)
    nodeShardData.consensusNodeForOurNode = ShardFunctions.getNeigborNodesInRange(nodeShardData.ourNodeIndex, shardGlobals.consensusRadius, exclude, activeNodes)
    nodeShardData.consensusNodeForOurNodeFull = ShardFunctions.getNeigborNodesInRange(nodeShardData.ourNodeIndex, shardGlobals.consensusRadius, [], activeNodes)

    // calcuate partition range for consensus
    if (nodeShardData.consensusNodeForOurNode.length >= 2) {
      // this logic only works because we know that getNeigborNodesInRange starts at the starting point
      let startNode = nodeShardData.consensusNodeForOurNode[0]
      let endNode = nodeShardData.consensusNodeForOurNode[nodeShardData.consensusNodeForOurNode.length - 1]
      // ugh, not so efficient since we might have this data precalced in a map.. but way may also not have it
      let nodeAddressNum = parseInt(startNode.id.slice(0, 8), 16)
      let startPartition = Math.floor(shardGlobals.numPartitions * (nodeAddressNum / 0xffffffff))
      nodeAddressNum = parseInt(endNode.id.slice(0, 8), 16)
      let endPartition = Math.floor(shardGlobals.numPartitions * (nodeAddressNum / 0xffffffff))
      nodeShardData.consensusStartPartition = startPartition
      nodeShardData.consensusEndPartition = endPartition

      // the jit verison really needs to be a third passs. otherwise we could face recursion problems.
    }

    if (nodeShardData.consensusStartPartition <= nodeShardData.consensusEndPartition) {
      for (let i = nodeShardData.consensusStartPartition; i <= nodeShardData.consensusEndPartition; i++) {
        let shardPartitionData = parititionShardDataMap.get(i)

        shardPartitionData.coveredBy[nodeShardData.node.id] = nodeShardData.node // { idx: nodeShardData.ourNodeIndex }
      }
    } else {
      for (let i = 0; i <= nodeShardData.consensusEndPartition; i++) {
        let shardPartitionData = parititionShardDataMap.get(i)

        shardPartitionData.coveredBy[nodeShardData.node.id] = nodeShardData.node // { idx: nodeShardData.ourNodeIndex }
      }
      for (let i = nodeShardData.consensusStartPartition; i < shardGlobals.numPartitions; i++) {
        let shardPartitionData = parititionShardDataMap.get(i)

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
      ShardFunctions.dilateNeighborCoverage(shardGlobals, nodeShardDataMap, parititionShardDataMap, activeNodes, nodeShardData, extras)
    }
    nodeShardData.edgeNodes.sort(ShardFunctions.nodeSort)
    nodeShardData.consensusNodeForOurNodeFull.sort(ShardFunctions.nodeSort)
    nodeShardData.nodeThatStoreOurParitionFull.sort(ShardFunctions.nodeSort)
  }

  static nodeSort (a, b) {
    return a.id === b.id ? 0 : a.id < b.id ? -1 : 1
  }

  // conditions aStart < aEnd && bStart < bEnd
  // static setBits (aStart, aEnd, bStart, bEnd) {
  //   let value = 0
  //   // no overlap
  //   if (bStart >= aEnd) {
  //     value |= 32
  //   }
  //   if (bEnd <= aStart) {
  //     value |= 16
  //   }
  //   // superset bits
  //   if (bStart < aStart) {
  //     value |= 8
  //   }
  //   if (bEnd > aEnd) {
  //     value |= 4
  //   }
  //   // // subset bits
  //   if (bStart > aStart && bStart < aEnd) {
  //     value |= 2
  //   }
  //   if (bEnd > aStart && bEnd < aEnd) {
  //     value |= 1
  //   }
  //   return value
  // }

  //  a=old, b=new
  static setOverlap (aStart, aEnd, bStart, bEnd) {
    return !((bStart >= aEnd) || (bEnd <= aStart))
  }

  static setEpanded (aStart, aEnd, bStart, bEnd) {
    return (bStart < aStart) || (bEnd > aEnd)
  }

  static setEpandedLeft (aStart, aEnd, bStart, bEnd) {
    return (bStart < aStart)
  }
  static setEpandedRight (aStart, aEnd, bStart, bEnd) {
    return (bEnd > aEnd)
  }
  //  a=old, b=new
  static setShrink (aStart, aEnd, bStart, bEnd) {
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
  static computeCoverageChanges (oldShardDataNodeShardData, newSharddataNodeShardData) {
    let coverageChanges = []

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

    return coverageChanges
    // this needs to understande address ranges.

    // should it also understand changed in what partitions are covered.
    // oldShardData_nodeShardData

    // calculate new and edge partitions?   then calculate change between partitions? --- NO!
  }

  static getHomeNodeSummaryObject (nodeShardData) {
    if (nodeShardData.extendedData === false) {
      return { noExtendedData: true, edge: [], consensus: [], storedFull: [] }
    }
    let result = { edge: [], consensus: [], storedFull: [] }

    for (let node of nodeShardData.edgeNodes) {
      result.edge.push(node.id)
    }
    for (let node of nodeShardData.consensusNodeForOurNodeFull) {
      result.consensus.push(node.id)
    }
    for (let node of nodeShardData.nodeThatStoreOurParitionFull) {
      result.storedFull.push(node.id)
    }

    result.edge.sort(function (a, b) { return a === b ? 0 : a < b ? -1 : 1 })
    result.consensus.sort(function (a, b) { return a === b ? 0 : a < b ? -1 : 1 })
    result.storedFull.sort(function (a, b) { return a === b ? 0 : a < b ? -1 : 1 })
    return result
  }

  static getNodeRelation (nodeShardData, nodeId) {
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

  static addressToPartition (shardGlobals, address) {
    let numPartitions = shardGlobals.numPartitions
    let addressNum = parseInt(address.slice(0, 8), 16)
    let homePartition = Math.floor(numPartitions * (addressNum / 0xffffffff))
    return [homePartition, addressNum]
  }

  static findHomeNode (shardGlobals, address, parititionShardDataMap) {
    let [homePartition, addressNum] = ShardFunctions.addressToPartition(shardGlobals, address)
    let partitionShard = parititionShardDataMap.get(homePartition)

    let wrapIndex = function (shardGlobals, index) {
      if (index < 0) {
        index = index + shardGlobals.numPartitions
      } else if (index >= shardGlobals.numPartitions) {
        index = index - shardGlobals.numPartitions
      }
      return index
    }

    let nodesToSearch = []
    if (partitionShard.homeNodes.length === 0) {
      for (let i = 1; i < shardGlobals.numPartitions; i++) {
        // get partitions to the left or right of us.  once we have home nodes stop computationt
        let leftIndex = partitionShard.homePartition - i
        let rightIndex = partitionShard.homePartition + i
        leftIndex = wrapIndex(shardGlobals, leftIndex)
        rightIndex = wrapIndex(shardGlobals, rightIndex)

        let partitionShardLeft = parititionShardDataMap.get(leftIndex)// activeNodes[leftIndex].id)
        let partitionShardRight = parititionShardDataMap.get(rightIndex)// activeNodes[rightIndex].id)

        if (partitionShardLeft.homeNodes.length > 0) {
          nodesToSearch = nodesToSearch.concat(partitionShardLeft.homeNodes)
        }
        if (partitionShardRight.homeNodes.length > 0) {
          nodesToSearch = nodesToSearch.concat(partitionShardRight.homeNodes)
        }
        if (nodesToSearch.length > 0) {
          break // we got something
        }
      }
    } else {
      nodesToSearch = partitionShard.homeNodes
    }

    let closestDitance = Number.MAX_SAFE_INTEGER
    let homeNode = null
    // find closest in list of home nodes
    for (let nodeShardData of nodesToSearch) {
      let distance = Math.abs(nodeShardData.nodeAddressNum - addressNum)
      if (distance < closestDitance) {
        closestDitance = distance
        homeNode = nodeShardData
      }
    }
    return homeNode
  }

  static dilateNeighborCoverage (shardGlobals, nodeShardDataMap, parititionShardDataMap, activeNodes, nodeShardDataToModify, extras) {
    let circularDistance = function (a, b, max) {
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

    let changed = false
    for (let node of extras) {
      let otherNodeShardData = nodeShardDataMap.get(node.id)

      if (!otherNodeShardData) {
        otherNodeShardData = ShardFunctions.computeNodePartitionData(shardGlobals, node, nodeShardDataMap, parititionShardDataMap, activeNodes, false)
      }

      let partition = otherNodeShardData.homePartition
      // double check that this is not in our range.

      if (ShardFunctions.testInRange(partition, nodeShardDataToModify.storedPartitions)) {
        continue
      }

      let partitionDistanceStart = circularDistance(partition, nodeShardDataToModify.storedPartitions.partitionStart, shardGlobals.numPartitions)
      let partitionDistanceEnd = circularDistance(partition, nodeShardDataToModify.storedPartitions.partitionEnd, shardGlobals.numPartitions)

      if (partitionDistanceStart < partitionDistanceEnd) {
        nodeShardDataToModify.storedPartitions.partitionStart = partition
        changed = true
        // ShardFunctions.calculateStoredPartitions2Ranges(shardGlobals, nodeShardDataToModify.storedPartitions)
      } else {
        nodeShardDataToModify.storedPartitions.partitionEnd = partition
        changed = true
        // ShardFunctions.calculateStoredPartitions2Ranges(shardGlobals, nodeShardDataToModify.storedPartitions)
      }
    }
    if (changed) {
      ShardFunctions.calculateStoredPartitions2Ranges(shardGlobals, nodeShardDataToModify.storedPartitions)
    }
  }

  /**
   * Merges two node lists
   * could make a faster version for sorted lists.. but not worth the complexity unless it shows up on a benchmark
   * @param {import("../shardus").Node[]} listA
   * @param {import("../shardus").Node[]} listB
   * @returns {array} result [results, extras]
   */
  static mergeNodeLists (listA, listB) {
    let results = []
    let extras = []
    let map = {}
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
   * @param {import("../shardus").Node[]} listA
   * @param {import("../shardus").Node[]} listB
   * @returns {import("../shardus").Node[]} results list
   */
  static subtractNodeLists (listA, listB) {
    let results = []
    let map = {}
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

  /**
   * @typedef {Object} AddressRange A range of addresses
   * @property {number} partition the partition
   * @property {number} p_low End index
   * @property {number} p_high The user's age.
   * @property {number} partitionEnd
   * @property {number} startAddr Start address in numeric form (4 bytes)
   * @property {number} endAddr End address in numeric form (4 bytes)
   * @property {string} low End address in 64 char string
   * @property {string} high End address in 64 char string
   */

  // todo memoize this per cycle!!!
  static partitionToAddressRange2 (shardGlobals, partition, paritionMax = null) {
    /**
     * @type {AddressRange}
     */
    let result = {}
    result.partition = partition
    let startAddr = 0xffffffff * (partition / shardGlobals.numPartitions)
    startAddr = Math.floor(startAddr)

    result.p_low = partition
    result.p_high = paritionMax

    let endPartition = partition + 1
    if (paritionMax) {
      endPartition = paritionMax + 1
    }
    result.partitionEnd = endPartition
    let endAddr = 0xffffffff * ((endPartition) / shardGlobals.numPartitions)
    endAddr = Math.floor(endAddr)

    // it seems we dont need/want this code:
    // if (paritionMax === null) {
    //   endAddr-- // - 1 // subtract 1 so we don't go into the nex partition
    // }

    result.startAddr = startAddr
    result.endAddr = endAddr

    result.low = ('00000000' + (startAddr).toString(16)).slice(-8) + '0'.repeat(56)
    result.high = ('00000000' + (endAddr).toString(16)).slice(-8) + 'f'.repeat(56)

    return result
  }

  // todo save off per node calculations?
  // get nodes with coverage of this range (does not support wrapping)
  // todo could make a faster partition based versoin of this!
  static getNodesThatCoverRange (shardGlobals, lowAddress, highAddress, exclude, activeNodes) {
    // calculate each nodes address position.
    // calculate if the nodes reach would cover our full range listed.
    // could we use start + delete to avoid wrapping?

    let circularDistance = function (a, b, max) {
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

    let numPartitions = shardGlobals.numPartitions
    let nodeLookRange = shardGlobals.nodeLookRange

    let range = []

    let lowAddressNum = parseInt(lowAddress.slice(0, 8), 16) // assume trailing 0s
    let highAddressNum = parseInt(highAddress.slice(0, 8), 16) + 1 // assume trailng fffs

    // todo start and end loop at smarter areas for efficieny reasones!
    let distLow = 0
    let distHigh = 0

    // This isn't a great loop to have for effiency reasons.
    for (let i = 0; i < activeNodes.length; i++) {
      let node = activeNodes[i]
      if (exclude.includes(node.id)) {
        continue
      }

      // could look up node by address??

      // calculate node middle address..
      let nodeAddressNum = parseInt(node.id.slice(0, 8), 16)
      // Fix this the center of a partition boundry??
      let homePartition = Math.floor(numPartitions * (nodeAddressNum / 0xffffffff))
      let centeredAddress = Math.floor(((homePartition + 0.5) * 0xffffffff) / numPartitions)

      // Math.min(Math.abs(centeredAddress - lowAddressNum), Math.abs(centeredAddress - lowAddressNum))

      distLow = circularDistance(centeredAddress, lowAddressNum, 0xffffffff) - nodeLookRange
      distHigh = circularDistance(centeredAddress, highAddressNum, 0xffffffff) - nodeLookRange
      // if (circularDistance(centeredAddress, lowAddressNum, 0xffffffff) > nodeLookRange) {
      //   continue
      // }
      // if (circularDistance(centeredAddress, highAddressNum, 0xffffffff) > nodeLookRange) {
      //   continue
      // }

      if (distLow > 0 && distHigh > 0) {
        continue
      }

      // if (Math.abs(centeredAddress - lowAddressNum) > nodeLookRange) {
      //   continue
      // }
      // if (Math.abs(centeredAddress - highAddressNum) > nodeLookRange) {
      //   continue
      // }
      // we are in range!
      range.push(node)
    }
    return range
  }

  /**
   * NOTE this is a raw answer.  edge cases with consensus node coverage can increase the results of our raw answer that is given here
   * @param {ShardGlobals} shardGlobals
   * @param {Map<string, NodeShardData>} nodeShardDataMap
   * @param {any} partition
   * @param {any[]} exclude
   * @param {any[]} activeNodes
   */
  static getNodesThatCoverParitionRaw (shardGlobals, nodeShardDataMap, partition, exclude, activeNodes) {
    let results = []

    // TODO perf.  faster verison that expands from our node index. (needs a sorted list of nodes.)
    for (let i = 0; i < activeNodes.length; i++) {
      let node = activeNodes[i]
      if (exclude.includes(node.id)) {
        continue
      }
      let nodeShardData = nodeShardDataMap.get(node.id)

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
  static getNeigborNodesInRange (position, radius, exclude, allNodes) {
    // let allNodes = this.p2p.state.getNodesOrdered() // possibly faster version that does not need a copy
    let results = []
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

    let scanIndex = scanStart
    for (let i = 0; i < radius * 2 + 1; i++) {
      if (scanIndex >= allNodes.length) {
        scanIndex = 0
      }

      let node = allNodes[scanIndex]
      scanIndex++
      if (exclude.includes(node.id)) {
        continue
      }
      if (node.status === 'active') {
        results.push(node)
      }

      if (scanIndex === scanStart) {
        break // we looped
      }
    }
    return results
  }

  // This builds a sorted list of nodes based on how close they are to a given address
  // todo count should be based off of something in shard globals.  this will matter for large networks.

  /**
   * @param {ShardGlobals} shardGlobals
   * @param {any[]} activeNodes
   * @param {number} position
   * @param {any} excludeID
   * @param {number} [count]
   */
  static getNodesByProximity (shardGlobals, activeNodes, position, excludeID, count = 10) {
    let allNodes = activeNodes
    let results = []
    let leftScanIndex = position
    let rightScanIndex = position - 1
    let maxIterations = Math.ceil(count / 2)
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
        }
      }
      node = allNodes[leftScanIndex]
      if (node.id !== excludeID) {
        if (node.status === 'active') {
          results.push(node)
        }
      }

      if (rightScanIndex === leftScanIndex) {
        break // we looped
      }
      // check if our pointers have looped around
      if (((rightScanIndex - leftScanIndex) * (rightScanIndex - leftScanIndex)) === 1) {
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
   * @param {string} lowAddress
   * @param {string} highAddress
   */
  static findCenterAddressPair (lowAddress, highAddress) {
    let leftAddressNum = parseInt(lowAddress.slice(0, 8), 16)
    let nodeAddressNum = parseInt(highAddress.slice(0, 8), 16)

    let centerNum = Math.round((leftAddressNum + nodeAddressNum) * 0.5)

    let addressPrefixHex = ShardFunctions.leadZeros8((centerNum).toString(16))
    let addressPrefixHex2 = ShardFunctions.leadZeros8((centerNum + 1).toString(16))

    let centerAddr = addressPrefixHex + 'f'.repeat(56)
    let centerAddrPlusOne = addressPrefixHex2 + '0'.repeat(56)
    return [centerAddr, centerAddrPlusOne]
  }

  static getCenterHomeNode (shardGlobals, parititionShardDataMap, lowAddress, highAddress) {
    let [centerAddr] = ShardFunctions.findCenterAddressPair(lowAddress, highAddress)

    return ShardFunctions.findHomeNode(shardGlobals, centerAddr, parititionShardDataMap)
  }

  /**
   * @param {number} size1
   * @param {number} size2
   * @param {number} index1
   */
  static debugFastStableCorrespondingIndicies (size1, size2, index1) {
    let results = []
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
  static fastStableCorrespondingIndicies (size1, size2, index1) {
    let results = []
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
  static partitionInConsensusRange (i, minP, maxP) {
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
module.exports = ShardFunctions
