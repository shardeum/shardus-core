// @ts-nocheck
/*eslint-disable*/
// const StateManager = require('../../../src/state-manager')
//const ShardFunctions2 = require('../../../src/state-manager/shardFunctions.js')
const ShardFunctions2 = require('../../../build/src/state-manager/shardFunctions2.js').default
// import {ShardGlobals,ShardInfo,StoredPartition,NodeShardData,AddressRange, HomeNodeSummary,ParititionShardDataMap,NodeShardDataMap,MergeResults,BasicAddressRange} from  './shardFunctionTypes'
// import ShardFunctions2 from './shardFunctions.js'

const crypto = require('shardus-crypto-utils')
const utils = require('../../../build/src/utils')
crypto('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')

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

// function findBnotInA (listA, listB) {
//   let mapA = {}
//   let results = []
//   for (let node of listA) {
//     mapA[node.id] = true
//   }

//   for (let node of listB) {
//     if (mapA[node.id] !== true) {
//       results.push(node)
//     }
//   }
//   return results
// }

function getClosestNodes (shardGlobals, parititionShardDataMap, activeNodes, hash, count = 1) {
  // if (this.currentCycleShardData == null) {
  //   throw new Error('getClosestNodes: network not ready')
  // }
  // let cycleShardData = this.currentCycleShardData
  let homeNode = ShardFunctions2.findHomeNode(shardGlobals, hash, parititionShardDataMap)
  let homeNodeIndex = homeNode.ourNodeIndex
  let idToExclude = ''
  let results = ShardFunctions2.getNodesByProximity(shardGlobals, activeNodes, homeNodeIndex, idToExclude, count, true)

  return results
}

function isNodeInDistancePartition (shardGlobals, hash, nodeId, distance) {
  // if (this.currentCycleShardData == null) {
  //   throw new Error('isNodeInDistance: network not ready')
  // }
  // let cycleShardData = this.currentCycleShardData
  let { homePartition } = ShardFunctions2.addressToPartition(shardGlobals, nodeId)
  let { homePartition: homePartition2 } = ShardFunctions2.addressToPartition(shardGlobals, hash)
  let partitionDistance = Math.abs(homePartition2 - homePartition)
  if (partitionDistance <= distance) {
    return true
  }
  return false
}

function isNodeInDistance (shardGlobals, parititionShardDataMap, hash, nodeId, distance) {
  let someNode = ShardFunctions2.findHomeNode(shardGlobals, nodeId, parititionShardDataMap)
  let someNodeIndex = someNode.ourNodeIndex

  let homeNode = ShardFunctions2.findHomeNode(shardGlobals, hash, parititionShardDataMap)
  let homeNodeIndex = homeNode.ourNodeIndex

  let partitionDistance = Math.abs(someNodeIndex - homeNodeIndex)
  if (partitionDistance <= distance) {
    return true
  }
  return false
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

//t19
//let hardcodeNodes = ["4423x0ab77","4a45x22d27","55bax46bbb","5d01x39d48","63eexfbe34","7ddcxb6586","9b8exa1c15","b520x4eef8","cab2x831cb","e029x146ea","f00bx0522f"]
//c25
//let hardcodeNodes = ["0ac8x88ef1","21f7x6483c","6f96xae48b","796fxf7e39","8134x3d98c","833ax8a51b","851cxab703","9d26x9011c","c4c2x62e22","d085xb50f6","d49ax34fec","e172xb3af1","ed8fx77d71","fc4bx4d28e"]
let hardcodeNodes = ["0ac8x88ef1","21f7x6483c"]

let hardcodeNodes2 = null

if (useHardcodenodes) {
  numNodes = hardcodeNodes.length
}
if (hardcodeNodes2) {
  numNodes2 = hardcodeNodes2.length
}
let debugStartsWith = '0ac8' // 21f7 851c '8bc4' // '33d7' //'0692' // '23d5' // 'f211' //'147d' // '2054' // '2512'  // '7459' // '5c42' // '37ae' // '37ae' '6eb5' // 97da 5d07 'dc16'  '0683'  'ed93' ac3c 3d28
let debugID = debugStartsWith.slice(0, 4) + '7'.repeat(64 - 4)
let debugAccount = '44dc' + '3'.repeat(60) // 5c43 386e 60b1  60b1 c173
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

  let shardGlobals = ShardFunctions2.calculateShardGlobals(numNodes, nodesPerConsenusGroup)

  let totalPartitions = numNodes

  // calculate data for all partitions
  let parititionShardDataMap = new Map()
  ShardFunctions2.computePartitionShardDataMap(shardGlobals, parititionShardDataMap, 0, totalPartitions)
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

  if (debugStartsWith != null && ourNode == null) {
    // debugID
    ourNode = { status: 'syncing', id: debugID }
    debugNode = ourNode
  }

  if (debugStartsWith != null) {
    // this was the earlier simple way
    // ShardFunctions2.computeNodePartitionDataMap(shardGlobals, nodeShardDataMap, activeNodes, parititionShardDataMap, activeNodes, false)
    // for (let node of activeNodes) {
    //   if (node.id.indexOf(debugStartsWith) >= 0) {
    //     ShardFunctions2.computeNodePartitionDataMap(shardGlobals, nodeShardDataMap, [node], parititionShardDataMap, activeNodes, true)
    //     debugNode = node
    //   }
    // }

    // this is an exact match for the calculations done in the shardus server:
    // generate limited data for all nodes data for all nodes.
    ShardFunctions2.computeNodePartitionDataMap(shardGlobals, nodeShardDataMap, activeNodes, parititionShardDataMap, activeNodes, false)
    // get extended data for our node
    nodeShardData = ShardFunctions2.computeNodePartitionData(shardGlobals, ourNode, nodeShardDataMap, parititionShardDataMap, activeNodes, true)
    // generate full data for nodes that store our home partition
    ShardFunctions2.computeNodePartitionDataMap(shardGlobals, nodeShardDataMap, nodeShardData.nodeThatStoreOurParitionFull, parititionShardDataMap, activeNodes, true)
    // cycleShardData.nodeShardData = cycleShardData.nodeShardDataMap.get(cycleShardData.ourNode.id)

    // generate lightweight data for all active nodes  (note that last parameter is false to specify the lightweight data)
    let fullDataForDebug = true // Set this to false for performance reasons!!! setting it to true saves us from having to recalculate stuff when we dump logs.
    ShardFunctions2.computeNodePartitionDataMap(shardGlobals, nodeShardDataMap, activeNodes, parititionShardDataMap, activeNodes, fullDataForDebug)

    // this is the function that messes up out calculations
    ShardFunctions2.computeNodePartitionDataMapExt(shardGlobals, nodeShardDataMap, activeNodes, parititionShardDataMap, activeNodes)

    console.log('storedPartitions' + utils.stringifyReduce(nodeShardData.storedPartitions))

    // calc consensus partitions
    let ourConsensusPartitions = ShardFunctions2.getConsenusPartitionList(shardGlobals, nodeShardData)
    console.log('ourConsensusPartitions ' + utils.stringifyReduce(ourConsensusPartitions) + `  consensusEndPartition: ${nodeShardData.consensusEndPartition} consensusStartPartition ${nodeShardData.consensusStartPartition}`)

    let hash = debugAccount // '0'.repeat(64) // debugAccount

    let closestNodes = getClosestNodes(shardGlobals, parititionShardDataMap, activeNodes, hash, 1)

    // @ts-ignore
    let closestNodes2 = getClosestNodes(shardGlobals, parititionShardDataMap, activeNodes, hash, 2)

    let closestNodes3 = getClosestNodes(shardGlobals, parititionShardDataMap, activeNodes, hash, 300)

    let inDist = isNodeInDistancePartition(shardGlobals, hash, debugID, 2)

    console.log(`getClosestNodes  ${closestNodes.length}    inDist:${inDist}  nodes:${closestNodes.map((node) => utils.stringifyReduce(node.id)).join(',')}`)
    for (let node of activeNodes) {
      if (node.id.slice(0, 4) === '653d') {
        let a = true //  653d  911b
      }
      let inDist2 = isNodeInDistancePartition(shardGlobals, hash, node.id, 2)
      let inDist3 = isNodeInDistance(shardGlobals, parititionShardDataMap, hash, node.id, 2)

      console.log(`isNodeInDistance  ${node.id}    inDist:${inDist2}  inDist3:${inDist3}`)
    }

    let foo = nodeShardDataMap.keys()
    for (let key of nodeShardDataMap.keys()) {
      if (key === 'bf7c777777777777777777777777777777777777777777777777777777777777') {
        let a = 1
      }
      let nodeData = nodeShardDataMap.get(key)
      let partitions2 = ShardFunctions2.getStoredPartitionList(shardGlobals, nodeData)

      console.log(`node stored: ${utils.stringifyReduce(partitions2)} ${key}`)
    }
  }

  ShardFunctions2.computeNodePartitionDataMap(shardGlobals, nodeShardDataMap, activeNodes, parititionShardDataMap, activeNodes, true)
  ShardFunctions2.computeNodePartitionDataMapExt(shardGlobals, nodeShardDataMap, activeNodes, parititionShardDataMap, activeNodes)

  if (hardcodeNodes2 != null) {
    let totalPartitions2 = numNodes2
    let shardGlobals2 = ShardFunctions2.calculateShardGlobals(numNodes2, nodesPerConsenusGroup)
    ShardFunctions2.computePartitionShardDataMap(shardGlobals2, parititionShardDataMap2, 0, totalPartitions2)
    ShardFunctions2.computeNodePartitionDataMap(shardGlobals2, nodeShardDataMap2, activeNodes2, parititionShardDataMap2, activeNodes2, false)
    ShardFunctions2.computeNodePartitionDataMap(shardGlobals2, nodeShardDataMap2, activeNodes2, parititionShardDataMap2, activeNodes2, true)
    ShardFunctions2.computeNodePartitionDataMapExt(shardGlobals2, nodeShardDataMap2, activeNodes2, parititionShardDataMap2, activeNodes2)

    let ourNodeData = nodeShardDataMap.get(debugNode.id)
    let ourNodeData2 = nodeShardDataMap2.get(debugNode.id)

    let coverageChanges = ShardFunctions2.computeCoverageChanges(ourNodeData, ourNodeData2)

    for (let change of coverageChanges) {
      // log info about the change.
      // ${utils.stringifyReduce(change)}
      console.log(` ${ShardFunctions2.leadZeros8((change.start).toString(16))}->${ShardFunctions2.leadZeros8((change.end).toString(16))} `)

      // create a range object from our coverage change.
      let range = {}
      range.startAddr = change.start
      range.endAddr = change.end
      range.low = ShardFunctions2.leadZeros8((range.startAddr).toString(16)) + '0'.repeat(56)
      range.high = ShardFunctions2.leadZeros8((range.endAddr).toString(16)) + 'f'.repeat(56)
      // create sync trackers
      // this.createSyncTrackerByRange(range, cycle)
    }
  }

  if (debugAccount != null) {
    let homeNode = ShardFunctions2.findHomeNode(shardGlobals, debugAccount, parititionShardDataMap)
    // let shardParition = parititionShardDataMap.get(5)
    let {homePartition, addressNum} = ShardFunctions2.addressToPartition(shardGlobals, debugAccount)
    //ShardFunctions2.
    let summaryObject = ShardFunctions2.getHomeNodeSummaryObject(homeNode)
    let relationString = ShardFunctions2.getNodeRelation(homeNode, debugID)

    let weStoreThisParition = ShardFunctions2.testInRange(homePartition, nodeShardData.storedPartitions)

    console.log(` summary:${utils.stringifyReduce(summaryObject)}`)
    console.log(` relationString:${relationString}`)
    console.log('Home node for debug acc:' + utils.stringifyReduce(homeNode))
    console.log('nodeThatStoreOurParitionFull:' + utils.stringifyReduce(homeNode.nodeThatStoreOurParitionFull))
    let { homePartition: partition } = ShardFunctions2.addressToPartition(shardGlobals, debugAccount)

    let ourNodeData = nodeShardDataMap.get(debugNode.id)

    let inRange = ShardFunctions2.testInRange(partition, ourNodeData.storedPartitions)

    // homeNode.nodeThatStoreOurParitionFull
    // let homeNode = ShardFunctions2.findHomeNode(shardGlobals, debugAccount, parititionShardDataMap)
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

    totalPartitionsCovered += ShardFunctions2.getPartitionsCovered(nodeShardData2.storedPartitions)
  }

  console.log(`test number ${i} partitions covered by a node avg: ${totalPartitionsCovered / innerLoopCount}`)

  // test home node search
  for (let j = 0; j < homeNodeQueryTests; ++j) {
    let address = crypto.randomBytes() // '160a' + '7'.repeat(60) //crypto.randomBytes()
    let homeNode = ShardFunctions2.findHomeNode(shardGlobals, address, parititionShardDataMap)
    if (homeNode == null) {
      homeNode = ShardFunctions2.findHomeNode(shardGlobals, address, parititionShardDataMap)
      throw new Error('home node not found')
    }
    let inRange = ShardFunctions2.testAddressInRange(address, homeNode.storedPartitions)
    if (inRange === false) {
      homeNode = ShardFunctions2.findHomeNode(shardGlobals, address, parititionShardDataMap)
      inRange = ShardFunctions2.testAddressInRange(address, homeNode.storedPartitions)
      throw new Error('home node not in range 1')
    }
    let { homePartition, addressNum } = ShardFunctions2.addressToPartition(shardGlobals, address)
    let inRange2 = ShardFunctions2.testInRange(homePartition, homeNode.storedPartitions)
    if (inRange2 === false) {
      homeNode = ShardFunctions2.findHomeNode(shardGlobals, address, parititionShardDataMap)
      inRange2 = ShardFunctions2.testInRange(homePartition, homeNode.storedPartitions)
      throw new Error('home node not in range 2')
    }

    for (let node of homeNode.consensusNodeForOurNode) {
      let inRange3 = ShardFunctions2.testAddressInRange(node.id, homeNode.storedPartitions)
      if (inRange3 === false) {
        throw new Error('node not in range 1')
      }
    }

    // not sure this has to be true:  fails when we use getNodesThatCoverParitionRaw for nodes that store our partition!
    // for (let node of homeNode.nodeThatStoreOurParitionFull) {
    //   let inRange3 = ShardFunctions2.testAddressInRange(node.id, homeNode.storedPartitions)
    //   if (inRange3 === false) {
    //     throw new Error('node not in range 2')
    //   }
    // }

    // this is a strange test since some of the nodes in the nodeThatStoreOurParitionFull might cover the home node partiiton but not the test message partition
    for (let node of homeNode.nodeThatStoreOurParitionFull) {
      let nodeData = nodeShardDataMap.get(node.id)
      let partitionInRange = ShardFunctions2.testInRange(homePartition, nodeData.storedPartitions)
      let inRange4 = ShardFunctions2.testAddressInRange(address, nodeData.storedPartitions)
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
  let res = ShardFunctions2.fastStableCorrespondingIndicies(size1, size2, i)

  console.log(` index: ${i}  res: ${JSON.stringify(res)}`)
}

/* eslint-enable */

// keep this
