const StateManager = require('../../../src/state-manager')
const ShardFunctions = require('../../../src/state-manager/shardFunctions.js')

const crypto = require('shardus-crypto-utils')
const utils = require('../../../src/utils')

// generate a sorted list of nodes
function generateNodes (count, predefinedList = null) {
  let nodeList = []
  for (let i = 0; i < count; ++i) {
    let newNode = { status: 'active' }
    if (predefinedList == null) {
      newNode.id = crypto.randomBytes()
    } else {
      newNode.id = predefinedList[i]
      newNode.id = newNode.id.slice(0, 4) + '7'.repeat(64 - 4)
    }

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
let testCounter = 1
// test 1
let testIterations = 0
let homeNodeQueryTests = 100

let testAllNodesInList = true
let numNodes = 6

let useHardcodenodes = true
let hardcodeNodes = ['068ex9699a', '3e7fx601a4', '4222xc48ab', '4d05xb7aaf', '5aacx228d3', '5b61xf5dca', '86b0x899cb', 'a4bdx83351', 'aa5ax8c81c', 'b432x1ecdc', 'dc16x79767', 'e0c3x00452', 'e8aexf9d78', 'e9f1xfc329', 'ff7fxcb7ef']

if (useHardcodenodes) {
  numNodes = hardcodeNodes.length
}

let debugStartsWith = '0683' // 'dc16'  '0683'

for (let i = 0; i < testIterations; i++) {
  testCounter++

  let nodesPerConsenusGroup = 3
  let activeNodes

  if (useHardcodenodes === false) {
    activeNodes = generateNodes(numNodes - 1)
    let ourId = 'deadbeef' + '3'.repeat(56)
    let ourNode = { id: ourId, status: 'active' }
    activeNodes.push(ourNode)
  } else {
    activeNodes = generateNodes(numNodes, hardcodeNodes)
  }
  activeNodes.sort(function (a, b) { return a.id === b.id ? 0 : a.id < b.id ? -1 : 1 })
  // let nodeToObserve = ourNode

  let innerLoopCount = 1
  if (testAllNodesInList) {
    innerLoopCount = numNodes
  }

  let shardGlobals = ShardFunctions.calculateShardGlobals(numNodes, nodesPerConsenusGroup)

  let totalPartitions = numNodes
  // calculate data for all partitions
  let parititionShardDataMap = new Map()
  ShardFunctions.computePartitionShardDataMap(shardGlobals, parititionShardDataMap, 0, totalPartitions)
  // calculate data for all nodeds
  let nodeShardDataMap = new Map()

  if (debugStartsWith != null) {
    ShardFunctions.computeNodePartitionDataMap(shardGlobals, nodeShardDataMap, activeNodes, parititionShardDataMap, activeNodes, false)

    for (let node of activeNodes) {
      if (node.id.indexOf(debugStartsWith) >= 0) {
        ShardFunctions.computeNodePartitionDataMap(shardGlobals, nodeShardDataMap, [node], parititionShardDataMap, activeNodes, true)
      }
    }
  }

  ShardFunctions.computeNodePartitionDataMap(shardGlobals, nodeShardDataMap, activeNodes, parititionShardDataMap, activeNodes, true)

  let totalPartitionsCovered = 0
  for (var nodeShardData of nodeShardDataMap.values()) {
    extraNodesTotal += nodeShardData.outOfDefaultRangeNodes.length

    totalPartitionsCovered += ShardFunctions.getPartitionsCovered(nodeShardData.storedPartitions)
  }

  console.log(`test number ${i} partitions covered by a node avg: ${totalPartitionsCovered / innerLoopCount}`)

  // test home node search
  for (let j = 0; j < homeNodeQueryTests; ++j) {
    let address = crypto.randomBytes() // '160a' + '7'.repeat(60) //crypto.randomBytes()
    let homeNode = ShardFunctions.findHomeNode(shardGlobals, address, parititionShardDataMap)
    if (homeNode == null) {
      homeNode = ShardFunctions.findHomeNode(shardGlobals, address, parititionShardDataMap)
      throw new Error('home node not found')
    }
    let inRange = ShardFunctions.testAddressInRange(address, homeNode.storedPartitions)
    if (inRange === false) {
      homeNode = ShardFunctions.findHomeNode(shardGlobals, address, parititionShardDataMap)
      inRange = ShardFunctions.testAddressInRange(address, homeNode.storedPartitions)
      throw new Error('home node not in range 1')
    }
    let [homePartition, addressNum] = ShardFunctions.addressToPartition(shardGlobals, address)
    let inRange2 = ShardFunctions.testInRange(homePartition, homeNode.storedPartitions)
    if (inRange2 === false) {
      homeNode = ShardFunctions.findHomeNode(shardGlobals, address, parititionShardDataMap)
      inRange2 = ShardFunctions.testInRange(homePartition, homeNode.storedPartitions)
      throw new Error('home node not in range 2')
    }

    for (let node of homeNode.consensusNodeForOurNode) {
      let inRange3 = ShardFunctions.testAddressInRange(node.id, homeNode.storedPartitions)
      if (inRange3 === false) {
        throw new Error('node not in range 1')
      }
    }
    for (let node of homeNode.nodeThatStoreOurParitionFull) {
      let inRange3 = ShardFunctions.testAddressInRange(node.id, homeNode.storedPartitions)
      if (inRange3 === false) {
        throw new Error('node not in range 2')
      }
    }

    for (let node of homeNode.nodeThatStoreOurParitionFull) {
      let nodeData = nodeShardDataMap.get(node.id)
      let inRange4 = ShardFunctions.testAddressInRange(address, nodeData.storedPartitions)
      if (inRange4 === false) {
        throw new Error('node not in range 2')
      }
    }

  }
}

if (testIterations > 0) {
  console.log(`Extra nodes total: ${extraNodesTotal} avg: ${extraNodesTotal / testCounter}  avg per node: ${extraNodesTotal / (testCounter * numNodes)}`)
}

let size1 = 3
let size2 = 4
console.log(` size1: ${size1}  size2: ${size2}`)
for (let i = 1; i <= size1; i++) {
  let res = ShardFunctions.fastStableCorrespondingIndicies(size1, size2, i)

  console.log(` index: ${i}  res: ${JSON.stringify(res)}`)
}
