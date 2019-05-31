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
let homeNodeQueryTests = 100

let testAllNodesInList = true
let numNodes = 100
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

  let totalPartitionsCovered = 0
  for (var nodeShardData of nodeShardDataMap.values()) {
    extraNodesTotal += nodeShardData.outOfDefaultRangeNodes.length

    totalPartitionsCovered += StateManager.getPartitionsCovered(nodeShardData.storedPartitions)
  }

  console.log(`test number ${i} partitions covered by a node avg: ${totalPartitionsCovered / innerLoopCount}`)

  // test home node search
  for (let j = 0; j < homeNodeQueryTests; ++j) {
    let address = crypto.randomBytes()
    let homeNode = StateManager.findHomeNode(shardGlobals, address, parititionShardDataMap)
    if (homeNode == null) {
      homeNode = StateManager.findHomeNode(shardGlobals, address, parititionShardDataMap)
      throw new Error('home node not found')
    }
    let inRange = StateManager.testAddressInRange(address, homeNode.storedPartitions)
    if (inRange === false) {
      homeNode = StateManager.findHomeNode(shardGlobals, address, parititionShardDataMap)
      inRange = StateManager.testAddressInRange(address, homeNode.storedPartitions)
      throw new Error('home node not in range')
    }
    let [homePartition, addressNum] = StateManager.addressToPartition(shardGlobals, address)
    let inRange2 = StateManager.testInRange(homePartition, homeNode.storedPartitions)
    if (inRange2 === false) {
      homeNode = StateManager.findHomeNode(shardGlobals, address, parititionShardDataMap)
      inRange2 = StateManager.testInRange(homePartition, homeNode.storedPartitions)
      throw new Error('home node not in range')
    }
  }
}

console.log(`Extra nodes total: ${extraNodesTotal} avg: ${extraNodesTotal / testCounter}  avg per node: ${extraNodesTotal / (testCounter * numNodes)}`)
