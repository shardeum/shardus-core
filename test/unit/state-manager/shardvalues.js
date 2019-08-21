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
let testIterations = 1
let homeNodeQueryTests = 100

let testAllNodesInList = true
let numNodes = 6

let useHardcodenodes = true
// let hardcodeNodes = ['068ex9699a', '3e7fx601a4', '4222xc48ab', '4d05xb7aaf', '5aacx228d3', '5b61xf5dca', '86b0x899cb', 'a4bdx83351', 'aa5ax8c81c', 'b432x1ecdc', 'dc16x79767', 'e0c3x00452', 'e8aexf9d78', 'e9f1xfc329', 'ff7fxcb7ef']
// let hardcodeNodes = ['16d0x3f6b2', '29d2x27971', '3b7ex5a91f', '4f57x3315c', '5d07x8bd45', '601dx69c34', '65c2xfc59d', '97dax03078', '9a01xa8f84', 'b050x62c87', 'b120x366ef', 'b48cxcf41f', 'd65fxae412', 'd875x49a69', 'e6d6x24afc']
let hardcodeNodes = ['1181x916b1', '1f40x556d2', '2837x2e9da', '2c6bx1c5b3', '3cacx91e08', '4124x4a6c7', '66ebx6e880', '6759xe4f9e', '73cbxaffd8', '76eax30249', '97efxf9461', 'a0c6x751bd', 'b1c3x8d872', 'c778x9b37e', 'd1e9xfe682', 'ed93x9ac1b']

if (useHardcodenodes) {
  numNodes = hardcodeNodes.length
}

let debugStartsWith = 'ed93' // 97da 5d07 'dc16'  '0683'
let debugAccount = 'ffaa' + '3'.repeat(60) // 5c43
let debugNode = null
// 5c43xba41c account test.. need to expand it.

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
        debugNode = node
      }
    }
  }

  ShardFunctions.computeNodePartitionDataMap(shardGlobals, nodeShardDataMap, activeNodes, parititionShardDataMap, activeNodes, true)

  ShardFunctions.computeNodePartitionDataMapExt(shardGlobals, nodeShardDataMap, activeNodes, parititionShardDataMap, activeNodes)

  let homeNode = ShardFunctions.findHomeNode(shardGlobals, debugAccount, parititionShardDataMap)
  // let shardParition = parititionShardDataMap.get(5)

  let summaryObject = ShardFunctions.getHomeNodeSummaryObject(homeNode)

  if (debugAccount != null) {
    let [partition, addrNum] = ShardFunctions.addressToPartition(shardGlobals, debugAccount)

    let ourNodeData = nodeShardDataMap.get(debugNode.id)

    let inRange = ShardFunctions.testInRange(partition, ourNodeData.storedPartitions)
    let homeNode = ShardFunctions.findHomeNode(shardGlobals, debugAccount, parititionShardDataMap)
    let hasKey = false
    if (homeNode.node.id === ourNodeData.node.id) {
      hasKey = true
    } else {
      for (let node of homeNode.nodeThatStoreOurParitionFull) {
        if (node.id === ourNodeData.node.id) {
          hasKey = true
          break
        }
      }
    }
    // nodeShardDataMap[]

    let end = 'now'
  }

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
