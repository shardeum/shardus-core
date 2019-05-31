const StateManager = require('../../../src/state-manager')
const ShardFunctions = require('../../../src/state-manager/shardFunctions.js')

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
let homeNodeQueryTests = 100

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

  let shardGlobals = ShardFunctions.calculateShardGlobals(numNodes, nodesPerConsenusGroup)

  let totalPartitions = numNodes
  // calculate data for all partitions
  let parititionShardDataMap = new Map()
  ShardFunctions.computePartitionShardDataMap(shardGlobals, parititionShardDataMap, 0, totalPartitions)
  // calculate data for all nodeds
  let nodeShardDataMap = new Map()
  ShardFunctions.computeNodePartitionDataMap(shardGlobals, nodeShardDataMap, activeNodes, parititionShardDataMap, activeNodes, true)

  let totalPartitionsCovered = 0
  for (var nodeShardData of nodeShardDataMap.values()) {
    extraNodesTotal += nodeShardData.outOfDefaultRangeNodes.length

    totalPartitionsCovered += ShardFunctions.getPartitionsCovered(nodeShardData.storedPartitions)
  }

  console.log(`test number ${i} partitions covered by a node avg: ${totalPartitionsCovered / innerLoopCount}`)

  // test home node search
  for (let j = 0; j < homeNodeQueryTests; ++j) {
    let address = crypto.randomBytes()
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
  }
}

console.log(`Extra nodes total: ${extraNodesTotal} avg: ${extraNodesTotal / testCounter}  avg per node: ${extraNodesTotal / (testCounter * numNodes)}`)
