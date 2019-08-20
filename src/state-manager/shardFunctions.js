
// const utils = require('../utils')
const stringify = require('fast-stable-stringify')

class ShardFunctions {
  static calculateShardGlobals (numNodes, nodesPerConsenusGroup) {
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

  static calculateInitialSyncData (shardGlobals, address) {
    let shardInfo = ShardFunctions.calculateShardValues(shardGlobals, address)
    let storedPartitions = ShardFunctions.calculateStoredPartitions2(shardGlobals, shardInfo.homePartition)

    // storedPartitions.partitionRange = ShardFunctions.partitionToAddressRange2(shardGlobals, storedPartitions.partitionStart1, storedPartitions.partitionEnd1)
    // storedPartitions.partitionRange2 = ShardFunctions.partitionToAddressRange2(shardGlobals, storedPartitions.partitionStart2, storedPartitions.partitionEnd2)

    // storedPartitions.partitionRange = ShardFunctions.partitionToAddressRange2(shardGlobals, storedPartitions.partitionStart, storedPartitions.partitionEnd)

    // storedPartitions.rangeIsSplit
    return storedPartitions
  }

  static calculateShardValues (shardGlobals, address) {
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

  static calculateStoredPartitions2 (shardGlobals, homePartition) {
    let storedPartitions = []

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
        nodeShardData = ShardFunctions.computeNodePartitionData(shardGlobals, node, nodeShardDataMap, parititionShardDataMap, activeNodes, extendedData)
      }
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

  static computeNodePartitionData (shardGlobals, node, nodeShardDataMap, parititionShardDataMap, activeNodes, extendedData) {
    let numPartitions = shardGlobals.numPartitions

    let nodeShardData = {}
    let nodeAddressNum = parseInt(node.id.slice(0, 8), 16)
    let homePartition = Math.floor(numPartitions * (nodeAddressNum / 0xffffffff))
    let centeredAddress = Math.floor(((homePartition + 0.5) * 0xffffffff) / numPartitions)

    nodeShardData.node = node
    nodeShardData.nodeAddressNum = nodeAddressNum
    nodeShardData.homePartition = homePartition
    nodeShardData.centeredAddress = centeredAddress
    nodeShardData.extraWatchedPartitions = 0

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
    let [results, extras] = ShardFunctions.mergeNodeLists(nodeShardData.nodeThatStoreOurParition, nodeShardData.consensusNodeForOurNodeFull)

    nodeShardData.nodeThatStoreOurParitionFull = results
  }

  static computeExtendedNodePartitionData (shardGlobals, nodeShardDataMap, parititionShardDataMap, nodeShardData, activeNodes) {
    if (nodeShardData.extendedData) {
      return
    }

    nodeShardData.extendedData = true
    nodeShardData.storedPartitions = ShardFunctions.calculateStoredPartitions2(shardGlobals, nodeShardData.homePartition)

    let exclude = [nodeShardData.node.id]

    nodeShardData.nodeThatStoreOurParition = ShardFunctions.getNodesThatCoverRange(shardGlobals, nodeShardData.storedPartitions.homeRange.low, nodeShardData.storedPartitions.homeRange.high, exclude, activeNodes)
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

    for (let i = nodeShardData.consensusStartPartition; i <= nodeShardData.consensusEndPartition; i++) {
      let shardPartitionData = parititionShardDataMap.get(i)

      shardPartitionData.coveredBy[nodeShardData.node.id] = nodeShardData.node // { idx: nodeShardData.ourNodeIndex }
    }

    // this list is a temporary list that counts as 2c range.  Stored nodes are the merged max of 2c range (2r on each side) and node in the 2c partition range
    nodeShardData.c2NodeForOurNode = ShardFunctions.getNeigborNodesInRange(nodeShardData.ourNodeIndex, 2 * shardGlobals.consensusRadius, exclude, activeNodes)

    let [results, extras] = ShardFunctions.mergeNodeLists(nodeShardData.nodeThatStoreOurParition, nodeShardData.c2NodeForOurNode)

    nodeShardData.nodeThatStoreOurParitionFull = results
    nodeShardData.outOfDefaultRangeNodes = extras

    nodeShardData.edgeNodes = ShardFunctions.subtractNodeLists(nodeShardData.nodeThatStoreOurParitionFull, nodeShardData.consensusNodeForOurNode)
    nodeShardData.edgeNodes = ShardFunctions.subtractNodeLists(nodeShardData.edgeNodes, exclude) // remove ourself!

    if (extras.length > 0) {
      ShardFunctions.dilateNeighborCoverage(shardGlobals, nodeShardDataMap, parititionShardDataMap, activeNodes, nodeShardData, extras)
    }
    nodeShardData.edgeNodes.sort(ShardFunctions.nodeSort)
    nodeShardData.consensusNodeForOurNodeFull.sort(ShardFunctions.nodeSort)
  }

  static nodeSort (a, b) {
    return a.id === b.id ? 0 : a.id < b.id ? -1 : 1
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
      if (a < b) {
        wrapDist = Math.abs(a + (max - b))
      } else if (b < a) {
        wrapDist = Math.abs(b + (max - a))
      }

      return Math.min(directDist, wrapDist)
    }

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
        ShardFunctions.calculateStoredPartitions2Ranges(shardGlobals, nodeShardDataToModify.storedPartitions)
      } else {
        nodeShardDataToModify.storedPartitions.partitionEnd = partition
        ShardFunctions.calculateStoredPartitions2Ranges(shardGlobals, nodeShardDataToModify.storedPartitions)
      }
    }
  }

  // could make a faster version for sorted lists.. but not worth the complexity unless it shows up on a benchmark
  // A + B
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

  // todo memoize this per cycle!!!
  static partitionToAddressRange2 (shardGlobals, partition, paritionMax = null) {
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

    result.low = ('00000000' + (+startAddr).toString(16)).slice(-8) + '0'.repeat(56)
    result.high = ('00000000' + (+endAddr).toString(16)).slice(-8) + 'f'.repeat(56)

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
      if (a < b) {
        wrapDist = Math.abs(a + (max - b))
      } else if (b < a) {
        wrapDist = Math.abs(b + (max - a))
      }

      return Math.min(directDist, wrapDist)
    }

    let numPartitions = shardGlobals.numPartitions
    let nodeLookRange = shardGlobals.nodeLookRange

    let range = []

    let lowAddressNum = parseInt(lowAddress.slice(0, 8), 16) // assume trailing 0s
    let highAddressNum = parseInt(highAddress.slice(0, 8), 16) + 1 // assume trailng fffs

    // todo start and end loop at smarter areas for efficieny reasones!
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

      if (circularDistance(centeredAddress, lowAddressNum, 0xffffffff) > nodeLookRange) {
        continue
      }
      if (circularDistance(centeredAddress, highAddressNum, 0xffffffff) > nodeLookRange) {
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

  // get nodes in count range to either side of our node
  // position should be the position of the home node
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
    let [centerAddr, centerAddrPlusOne] = ShardFunctions.findCenterAddressPair(lowAddress, highAddress)

    return ShardFunctions.findHomeNode(shardGlobals, centerAddr, parititionShardDataMap)
  }

  static debugFastStableCorrespondingIndicies (size1, size2, index1) {
    let results = []
    try {
      results = ShardFunctions.fastStableCorrespondingIndicies(size1, size2, index1)
    } catch (ex) {
      throw new Error(`stack overflow fastStableCorrespondingIndicies( ${size1},  ${size2}, ${index1} )`)
    }

    return results
  }

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
