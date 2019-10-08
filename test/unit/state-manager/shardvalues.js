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
let numNodes2 = 0

/** @type {boolean} */
let useHardcodenodes = true
// let hardcodeNodes = ['068ex9699a', '3e7fx601a4', '4222xc48ab', '4d05xb7aaf', '5aacx228d3', '5b61xf5dca', '86b0x899cb', 'a4bdx83351', 'aa5ax8c81c', 'b432x1ecdc', 'dc16x79767', 'e0c3x00452', 'e8aexf9d78', 'e9f1xfc329', 'ff7fxcb7ef']
// let hardcodeNodes = ['16d0x3f6b2', '29d2x27971', '3b7ex5a91f', '4f57x3315c', '5d07x8bd45', '601dx69c34', '65c2xfc59d', '97dax03078', '9a01xa8f84', 'b050x62c87', 'b120x366ef', 'b48cxcf41f', 'd65fxae412', 'd875x49a69', 'e6d6x24afc']
// let hardcodeNodes = ['1181x916b1', '1f40x556d2', '2837x2e9da', '2c6bx1c5b3', '3cacx91e08', '4124x4a6c7', '66ebx6e880', '6759xe4f9e', '73cbxaffd8', '76eax30249', '97efxf9461', 'a0c6x751bd', 'b1c3x8d872', 'c778x9b37e', 'd1e9xfe682', 'ed93x9ac1b']
// let hardcodeNodes2 = ['0ac0xf9a47', '19e0x84509', '1e83xbf3d2', '30cax3bafc', '450bx96e7d', '4dc0x48b55', '4e6fx6d689', '5429x91097', '61c6x3ffa5', '7a52x3e35d', '8a54xad1db', 'ac3cx755d8', 'dcf5x9ba90', 'ddb8xab70e', 'e55ex33985', 'ece5x609fb', 'fe95x65248']
// let hardcodeNodes = ['0ac0xf9a47', '1e83xbf3d2', '30cax3bafc', '450bx96e7d', '4dc0x48b55', '4e6fx6d689', '5429x91097', '61c6x3ffa5', '7a52x3e35d', '8a54xad1db', 'ac3cx755d8', 'dcf5x9ba90', 'ddb8xab70e', 'e55ex33985', 'ece5x609fb', 'fe95x65248']

// let hardcodeNodes2 = ['0861xe349b', '13b5x72241', '22e3x54e31', '2301x41f85', '3d28xd21aa', '78b1x23027', '7d43xb8b78', '843bx3f78d', '902dx9bf68', '9c99x9469d', 'be14x1ce18', 'dd2fx5419e', 'e2b1x19f9a', 'e9a9xbb0c4', 'fd7fx6ffa1']
// let hardcodeNodes = ['0861xe349b', '13b5x72241', '22e3x54e31', '2301x41f85', '3d28xd21aa', '78b1x23027', '7d43xb8b78', '843bx3f78d', '902dx9bf68', '9c99x9469d', 'be14x1ce18', 'dd2fx5419e', 'e2b1x19f9a', 'e9a9xbb0c4']

// let hardcodeNodes = ['05a6xa2f35', '06e3x5a6b6', '0b63x1bfab', '16c6xffeb6', '1788x01997', '2926x7106a', '6eb5xd541f', '9296x4ee2e', 'ae7fx325be', 'e2edx6a490', 'fed0x5de0b']
let hardcodeNodes = ['0325xa8adb', '05a6xa2f35', '06e3x5a6b6', '0b63x1bfab', '16c6xffeb6', '1788x01997', '2926x7106a', '2fb3xc044f', '37aex2b600', '3e76x08324', '6eb5xd541f', '87aaxcc9fb', '9296x4ee2e', 'ae7fx325be', 'c7d2xb1a40', 'e0bcxbd49c', 'e2edx6a490', 'fed0x5de0b']

let hardcodeNodes2 = ['0325xa8adb', '05a6xa2f35', '06e3x5a6b6', '0b63x1bfab', '16c6xffeb6', '1788x01997', '2926x7106a', '2fb3xc044f', '37aex2b600', '3e76x08324', '6eb5xd541f', '87aaxcc9fb', '9296x4ee2e', '9c39x1ff15', 'ae7fx325be', 'b29exe5d79', 'c7d2xb1a40', 'e0bcxbd49c', 'e2edx6a490', 'fed0x5de0b']

// let hardcodeNodes2 = null

if (useHardcodenodes) {
  numNodes = hardcodeNodes.length
}
if (hardcodeNodes2) {
  numNodes2 = hardcodeNodes2.length
}
let debugStartsWith = '37ae' // '37ae' '6eb5' // 97da 5d07 'dc16'  '0683'  'ed93' ac3c 3d28
let debugID = debugStartsWith.slice(0, 4) + '7'.repeat(64 - 4)
let debugAccount = '386e' + '3'.repeat(60) // 5c43
let debugNode = null
// 5c43xba41c account test.. need to expand it.

for (let i = 0; i < testIterations; i++) {
  testCounter++

  let nodesPerConsenusGroup = 3
  let activeNodes
  let activeNodes2
  // @ts-ignore the error below make no sense!
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

  if (hardcodeNodes2 != null) {
    activeNodes2 = generateNodes(numNodes2, hardcodeNodes2)
    activeNodes2.sort(function (a, b) { return a.id === b.id ? 0 : a.id < b.id ? -1 : 1 })
  }

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

  let parititionShardDataMap2 = new Map()
  let nodeShardDataMap2 = new Map()

  let nodeShardData = null
  let ourNode = null
  for (let node of activeNodes) {
    if (node.id === debugID) {
      ourNode = node
      debugNode = node
    }
  }
  if (debugStartsWith != null) {
    // this was the earlier simple way
    ShardFunctions.computeNodePartitionDataMap(shardGlobals, nodeShardDataMap, activeNodes, parititionShardDataMap, activeNodes, false)
    for (let node of activeNodes) {
      if (node.id.indexOf(debugStartsWith) >= 0) {
        ShardFunctions.computeNodePartitionDataMap(shardGlobals, nodeShardDataMap, [node], parititionShardDataMap, activeNodes, true)
        debugNode = node
      }
    }

    // // this is an exact match for the calculations done in the shardus server:
    // // generate limited data for all nodes data for all nodes.
    // ShardFunctions.computeNodePartitionDataMap(shardGlobals, nodeShardDataMap, activeNodes, parititionShardDataMap, activeNodes, false)
    // // get extended data for our node
    // nodeShardData = ShardFunctions.computeNodePartitionData(shardGlobals, ourNode, nodeShardDataMap, parititionShardDataMap, activeNodes, true)
    // // generate full data for nodes that store our home partition
    // ShardFunctions.computeNodePartitionDataMap(shardGlobals, nodeShardDataMap, nodeShardData.nodeThatStoreOurParitionFull, parititionShardDataMap, activeNodes, true)
    // // cycleShardData.nodeShardData = cycleShardData.nodeShardDataMap.get(cycleShardData.ourNode.id)

    // // generate lightweight data for all active nodes  (note that last parameter is false to specify the lightweight data)
    // let fullDataForDebug = true // Set this to false for performance reasons!!! setting it to true saves us from having to recalculate stuff when we dump logs.
    // ShardFunctions.computeNodePartitionDataMap(shardGlobals, nodeShardDataMap, activeNodes, parititionShardDataMap, activeNodes, fullDataForDebug)

    // // this is the function that messes up out calculations
    // ShardFunctions.computeNodePartitionDataMapExt(shardGlobals, nodeShardDataMap, activeNodes, parititionShardDataMap, activeNodes)
  }

  ShardFunctions.computeNodePartitionDataMap(shardGlobals, nodeShardDataMap, activeNodes, parititionShardDataMap, activeNodes, true)
  ShardFunctions.computeNodePartitionDataMapExt(shardGlobals, nodeShardDataMap, activeNodes, parititionShardDataMap, activeNodes)

  if (hardcodeNodes2 != null) {
    let totalPartitions2 = numNodes2
    let shardGlobals2 = ShardFunctions.calculateShardGlobals(numNodes2, nodesPerConsenusGroup)
    ShardFunctions.computePartitionShardDataMap(shardGlobals2, parititionShardDataMap2, 0, totalPartitions2)
    ShardFunctions.computeNodePartitionDataMap(shardGlobals2, nodeShardDataMap2, activeNodes2, parititionShardDataMap2, activeNodes2, false)
    ShardFunctions.computeNodePartitionDataMap(shardGlobals2, nodeShardDataMap2, activeNodes2, parititionShardDataMap2, activeNodes2, true)
    ShardFunctions.computeNodePartitionDataMapExt(shardGlobals2, nodeShardDataMap2, activeNodes2, parititionShardDataMap2, activeNodes2)

    let ourNodeData = nodeShardDataMap.get(debugNode.id)
    let ourNodeData2 = nodeShardDataMap2.get(debugNode.id)

    let coverageChanges = ShardFunctions.computeCoverageChanges(ourNodeData, ourNodeData2)

    for (let change of coverageChanges) {
      // log info about the change.
      // ${utils.stringifyReduce(change)}
      console.log(` ${ShardFunctions.leadZeros8((change.start).toString(16))}->${ShardFunctions.leadZeros8((change.end).toString(16))} `)

      // create a range object from our coverage change.
      let range = {}
      range.startAddr = change.start
      range.endAddr = change.end
      range.low = ShardFunctions.leadZeros8((range.startAddr).toString(16)) + '0'.repeat(56)
      range.high = ShardFunctions.leadZeros8((range.endAddr).toString(16)) + 'f'.repeat(56)
      // create sync trackers
      // this.createSyncTrackerByRange(range, cycle)
    }
  }

  if (debugAccount != null) {
    let homeNode = ShardFunctions.findHomeNode(shardGlobals, debugAccount, parititionShardDataMap)
    // let shardParition = parititionShardDataMap.get(5)

    let summaryObject = ShardFunctions.getHomeNodeSummaryObject(homeNode)

    console.log(` summary:${utils.stringifyReduce(summaryObject)}`)

    let [partition, addrNum] = ShardFunctions.addressToPartition(shardGlobals, debugAccount)

    let ourNodeData = nodeShardDataMap.get(debugNode.id)

    let inRange = ShardFunctions.testInRange(partition, ourNodeData.storedPartitions)

    // homeNode.nodeThatStoreOurParitionFull
    // let homeNode = ShardFunctions.findHomeNode(shardGlobals, debugAccount, parititionShardDataMap)
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
  for (var nodeShardData2 of nodeShardDataMap.values()) {
    extraNodesTotal += nodeShardData2.outOfDefaultRangeNodes.length

    totalPartitionsCovered += ShardFunctions.getPartitionsCovered(nodeShardData2.storedPartitions)
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

    // not sure this has to be true:  fails when we use getNodesThatCoverParitionRaw for nodes that store our partition!
    // for (let node of homeNode.nodeThatStoreOurParitionFull) {
    //   let inRange3 = ShardFunctions.testAddressInRange(node.id, homeNode.storedPartitions)
    //   if (inRange3 === false) {
    //     throw new Error('node not in range 2')
    //   }
    // }

    // this is a strange test since some of the nodes in the nodeThatStoreOurParitionFull might cover the home node partiiton but not the test message partition
    for (let node of homeNode.nodeThatStoreOurParitionFull) {
      let nodeData = nodeShardDataMap.get(node.id)
      let partitionInRange = ShardFunctions.testInRange(homePartition, nodeData.storedPartitions)
      let inRange4 = ShardFunctions.testAddressInRange(address, nodeData.storedPartitions)
      if (partitionInRange && inRange4 === false) {
        throw new Error(`address not in range 2. node: ${utils.makeShortHash(node.id)} addr: ${utils.makeShortHash(address)} home: ${utils.makeShortHash(homeNode.node.id)} p:${partitionInRange}`)
      }
      // if (inRange4 === true && partitionInRange === false) {
      //   console.log('error')
      // }
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
