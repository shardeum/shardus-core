const StateManager = require('../../../src/state-manager')
const crypto = require('shardus-crypto-utils')
const utils = require('../../../src/utils')

// generate a sorted list of nodes
function generateNodes (count) {
  let nodeList = []
  for (let i = 0; i < count; ++i) {
    let newNode = { status: 'active' }
    newNode.id = crypto.randomBytes()
    nodeList.push(newNode)
  }
  nodeList.sort(function (a, b) { return a.id === b.id ? 0 : a.id < b.id ? -1 : 1 }) // a[propName] == b[propName] ? 0 : a[propName] < b[propName] ? -1 : 1
  return nodeList
}

function findBnotInA (listA, listB) {
  let mapA = {}
  let results = []
  for (let node of listA) {
    mapA[node.id] = true
  }

  for (let node of listB) {
    if (mapA[node.id] !== true) {
      results.push(node)
    }
  }
  return results
}

let extraNodesTotal = 0
let testCounter = 0
// test 1
let testIterations = 10

let testAllNodesInList = true
let numNodes = 1000
for (let i = 0; i < testIterations; i++) {
  testCounter++

  let nodesPerConsenusGroup = 10
  let activeNodes = generateNodes(numNodes - 1)
  let ourId = 'deadbeef' + '3'.repeat(56)
  let ourNode = { id: ourId, status: 'active' }
  activeNodes.push(ourNode)
  activeNodes.sort(function (a, b) { return a.id === b.id ? 0 : a.id < b.id ? -1 : 1 })
  let nodeToObserve = ourNode

  let innerLoopCount = 1
  if (testAllNodesInList) {
    innerLoopCount = numNodes
  }

  let shardGlobals = StateManager.calculateShardGlobals(numNodes, nodesPerConsenusGroup)

  let totalPartitions = numNodes
  // calculate data for all partitions
  let parititionShardDataMap = new Map()
  StateManager.computePartitionShardDataMap(shardGlobals, parititionShardDataMap, 0, totalPartitions)
  // calculate data for all nodeds
  let nodeShardDataMap = new Map()
  StateManager.computeNodePartitionDataMap(shardGlobals, nodeShardDataMap, activeNodes, parititionShardDataMap, activeNodes, true)

  let totalPartitionsObserved = 0
  let totalPartitionsCovered = 0
  for (var nodeShardData of nodeShardDataMap.values()) {
    extraNodesTotal += nodeShardData.outOfDefaultRangeNodes.length

    totalPartitionsCovered += StateManager.getPartitionsCovered(nodeShardData.storedPartitions)
  }
  //   for (let j = 0; j < innerLoopCount; j++) {
  //     if (testAllNodesInList === true) {
  //       nodeToObserve = activeNodes[j]
  //     }

  //     // let address = nodeToObserve.id
  //     let shardInfo = StateManager.calculateShardValues(shardGlobals, nodeToObserve.id)
  //     let exclude = [] // [ourNode.id]
  //     let nodeInRange = StateManager.getNodesThatCoverRange(shardInfo.homeRange.low, shardInfo.homeRange.high, exclude, activeNodes, shardInfo.lookRange, shardInfo.numPartitions)
  //     let ourNodeIndex = activeNodes.findIndex(function (node) { return node.id === nodeToObserve.id })
  //     let nodeInRange2 = StateManager.getNeigborNodesInRange(ourNodeIndex, nodesPerConsenusGroup, exclude, activeNodes)
  //     //   if (nodeInRange2.length !== 10) {
  //     //     StateManager.getNeigborNodesInRange(shardInfo.homePartition, nodesInConsensusGroup, [ourNode.id], activeNodes)
  //     //   }
  //     // console.log(`our index in the node list: ${ourNodeIndex}  test number ${i}`)
  //     //   console.log(` shardInfo: ${JSON.stringify(shardInfo)}`)
  //     //
  //     //     // console.log(` all nodes. len: ${activeNodes.length}  nodes: ${utils.stringifyReduce(activeNodes)}`)
  //     //     console.log(` nodes that see our home partition len: ${nodeInRange.length}  nodes: ${utils.stringifyReduce(nodeInRange)}`)
  //     //     console.log(` nodes in our consensus:  ${nodeInRange2.length}  nodes: ${utils.stringifyReduce(nodeInRange2)}`)
  //     let [results, extras] = StateManager.mergeNodeLists(nodeInRange, nodeInRange2)
  //     let partitionList = results

  //     let addedNodes = partitionList.length - nodeInRange.length
  //     extraNodesTotal += addedNodes

  //     totalPartitionsObserved += partitionList.length

  //     // shardInfo
  //     for (let node in partitionList) {
  //       let value = partitionsSeenByNodeId[node.id]
  //       if (value == null) {
  //         value = 0
  //       }
  //       value++
  //       partitionsSeenByNodeId[node.id] = value
  //     }

  //     let nodesOutOfCoverage = findBnotInA(partitionList, nodeInRange2)

  //     if (nodesOutOfCoverage.length > 0) {
  //       console.log(` shardInfo: ${JSON.stringify(shardInfo)}`)
  //       // console.log(` all nodes. len: ${activeNodes.length}  nodes: ${utils.stringifyReduce(activeNodes)}`)
  //       console.log(` nodes that see our home partition len: ${nodeInRange.length}  nodes: ${utils.stringifyReduce(nodeInRange)}`)
  //       console.log(` nodes in our consensus:  ${nodeInRange2.length}  nodes: ${utils.stringifyReduce(nodeInRange2)}`)
  //       console.log(` ERROR some nodes in consensus not covered by partition:  ${nodesOutOfCoverage.length}  nodes: ${utils.stringifyReduce(nodesOutOfCoverage)}`)
  //       break
  //     }
  //   }

  //   let totalPartitionsCovered = 0
  //   for (let node in activeNodes) {
  //     let value = partitionsSeenByNodeId[node.id]
  //     totalPartitionsCovered += value
  //   }

  // console.log(`test number ${i} nodes observing a parition avg: ${totalPartitionsObserved / innerLoopCount}`)

  // console.log(`test number ${i} partitions covered by a node avg: ${totalPartitionsCovered / (innerLoopCount * activeNodes.length)}`)
  console.log(`test number ${i} partitions covered by a node avg: ${totalPartitionsCovered / innerLoopCount}`)
}

console.log(`Extra nodes total: ${extraNodesTotal} avg: ${extraNodesTotal / testCounter}  avg per node: ${extraNodesTotal / (testCounter * numNodes)}`)

// StateManager.calculateShardValues(20, 30, 'd011ffff' + '3'.repeat(52))
