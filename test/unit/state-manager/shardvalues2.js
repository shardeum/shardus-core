// @ts-nocheck
/*eslint-disable*/
// const StateManager = require('../../../src/state-manager')
//const ShardFunctions = require('../../../src/state-manager/shardFunctions.js')
const ShardFunctions = require('../../../build/src/state-manager/shardFunctions.js').default
// import {ShardGlobals,ShardInfo,StoredPartition,NodeShardData,AddressRange, HomeNodeSummary,ParititionShardDataMap,NodeShardDataMap,MergeResults,BasicAddressRange} from  './shardFunctionTypes'
// import ShardFunctions from './shardFunctions.js'

const crypto = require('shardus-crypto-utils')
const utils = require('../../../build/src/utils')
crypto.init('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')

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
  let homeNode = ShardFunctions.findHomeNode(shardGlobals, hash, parititionShardDataMap)
  let homeNodeIndex = homeNode.ourNodeIndex
  let idToExclude = ''
  let results = ShardFunctions.getNodesByProximity(shardGlobals, activeNodes, homeNodeIndex, idToExclude, count, true)

  return results
}

function isNodeInDistancePartition (shardGlobals, hash, nodeId, distance) {
  // if (this.currentCycleShardData == null) {
  //   throw new Error('isNodeInDistance: network not ready')
  // }
  // let cycleShardData = this.currentCycleShardData
  let { homePartition } = ShardFunctions.addressToPartition(shardGlobals, nodeId)
  let { homePartition: homePartition2 } = ShardFunctions.addressToPartition(shardGlobals, hash)
  let partitionDistance = Math.abs(homePartition2 - homePartition)
  if (partitionDistance <= distance) {
    return true
  }
  return false
}

function isNodeInDistance (shardGlobals, parititionShardDataMap, hash, nodeId, distance) {
  let someNode = ShardFunctions.findHomeNode(shardGlobals, nodeId, parititionShardDataMap)

  if(someNode == null){
    ShardFunctions.findHomeNode(shardGlobals, nodeId, parititionShardDataMap)
    return false
  }
  let someNodeIndex = someNode.ourNodeIndex

  let homeNode = ShardFunctions.findHomeNode(shardGlobals, hash, parititionShardDataMap)
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
//let hardcodeNodes = ["008cx3f9d4","2f28x55213","3c3ax5395e","4480x93b0c","5d98xe3f67","a314x7b0ba","d5d7x603d3","e23cx83629","eb91x7dfc6","f06axd2445"] 
//let hardcodeNodes = ["0333x810a9","0c45xf6a10","0ddcxa2cd1","0fa2x6aef8","15bcx5d8d0","1da7xe7373","1fd1xdd531","2212x13a78","23a4xbb504","2cd0xf0f78","2d05x3d7a5","2ebex22298","3bc6xd57e8","47f9xd7b50","4959xa9b86","5200xcd9d3","538ex9220d","5576x3a33f","5cfex543b5","5d89x635d6","608fxb4b8d","63d4x33ed1","64d1x405c6","67e7xb66c1","7397x5a48c","7cdax3c139","8a64x6e1ad","8ddaxcdd49","94eexc5b1f","95f1x59c6a","9ab9x2c3a7","9df4xd5527","ad2bx2111a","b19cxb3c37","b567xbf269","b617xdb5a7","c31exac883","c964x0edbd","cb64xdad36","cbefx47c54","dda6x4bd87","e0d3x2bae0","e2a7xded5f","e823x637da","ecc3x27529","eeeax0c639","ef75xd7e39","f38cx02feb","f71exe6bb6","fd79x2f90d"]
//let hardcodeNodes = ["0333x810a9","0779x61773","0842xf6bd1","0973xdcad3","0e99x8fb06","151ex4bf57","16f8xb349c","16f8xb349c","1a4bx38be7","1bc2x33a63","1bc4x34bf5","21c2x81536","2eb4x8ddfa","3140xcf9a7","31ebxf318e","32a1x6dc2d","3638x689f7","36b4x7cee0","37ebx7fac5","42bax847b7","47e0x616c1","4c33x5592f","5128x4ecd9","5198xda9be","5659x93c69","6bf3x0a3c6","6dbax7b9a2","6f6ax2de94","6ffdx17a1a","7367xa22ab","7794xaf572","7acax8ab94","7b39x61040","7feax34716","80cfx0738b","9536x00378","9578x2babb","95c3x639f3","9c78x27f5f","9e6cxe7e5a","a23ax921af","a562xff144","a5dbx407e8","a605x919f4","a94dxac1fe","ad19x5b0a5","ad3cx92a40","add2xf9dcc","b0f3xd0f95","b94ex10864","be0ex5d6e2","bf79x36378","c20bx07dde","d0e6x22bc1","d7a5xaed8d","dddfxc5f35","dfb5x56e42","e2c2x57f69","e471x5b4d1","ed63x693e5","f203x6274e","f6bdx8b9f4","fb5bx2b81d","fd7dx25192","ffa0x89659"]
//let hardcodeNodes = ["0330xf2ac9","0492x0706c","15a4x326bb","1ceex2c48c","1d18x3f597","2628x75899","2a03xc663d","32e3x7b545","3856x1fda0","50f1xc65ba","5ad7xa47f8","5bb8x94d0e","5cbfx87149","67eaxf347d","7022xab7ae","765fx27d81","7ffcx03660","808axc9e17","8ab0x74e5c","8b39x3f077","92a9x25208","a5ccx48267","c8f7x1c83e","d7f4xf885f","d96cx48916","e66cx8f00b","ea5fx09f98","edbax5c26f","f4e0xedff4","f621x04f4c"] 

let hardcodeNodes =["1653x16ec1","19f0xd5472","1cf4xde0eb","2a19x5e3b1","32bexf57c0","4995xf8b99","4ecexd6312","5a7fx44c45","68cbx40e22","70b5x9e9ee","726cx7382c","759axd5017","a2a8x6c883","a61ex8efbf","d7ddx789eb","fd6cxea9a4"] 

let hardcodeNodes2 = ["1653x16ec1","19f0xd5472","1cf4xde0eb","2a19x5e3b1","32bexf57c0","4995xf8b99","4ecexd6312","5a7fx44c45","68cbx40e22","70b5x9e9ee","726cx7382c","759axd5017","792exda25a","a2a8x6c883","a61ex8efbf","d7ddx789eb","f0ddx1549b","f937x3e4ce","fd6cxea9a4"] 

if (useHardcodenodes) {
  numNodes = hardcodeNodes.length
}
if (hardcodeNodes2) {
  numNodes2 = hardcodeNodes2.length
}

// Set debugStartsWith to specify what node will be "our node" in the following calculations
let debugStartsWith = 'de71' // 21f7 851c '8bc4' // '33d7' //'0692' // '23d5' // 'f211' //'147d' // '2054' // '2512'  // '7459' // '5c42' // '37ae' // '37ae' '6eb5' // 97da 5d07 'dc16'  '0683'  'ed93' ac3c 3d28
let debugID = debugStartsWith.slice(0, 4) + '7'.repeat(64 - 4)

// set debugAccount to specify and example address that will get calculations made to it
let debugAccount = '78b3' + '3'.repeat(60) // 5c43 386e 60b1  60b1 c173
let debugNode = null
// 5c43xba41c account test.. need to expand it.

for (let i = 0; i < testIterations; i++) {
  testCounter++

  let nodesPerConsenusGroup = 5
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


  ShardFunctions.partitionToAddressRange2(shardGlobals, 5, 17)


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

  if (debugStartsWith != null && ourNode == null) {
    // debugID
    ourNode = { status: 'syncing', id: debugID }
    debugNode = ourNode
  }

  if (debugStartsWith != null) {
    // this was the earlier simple way
    // ShardFunctions.computeNodePartitionDataMap(shardGlobals, nodeShardDataMap, activeNodes, parititionShardDataMap, activeNodes, false)
    // for (let node of activeNodes) {
    //   if (node.id.indexOf(debugStartsWith) >= 0) {
    //     ShardFunctions.computeNodePartitionDataMap(shardGlobals, nodeShardDataMap, [node], parititionShardDataMap, activeNodes, true)
    //     debugNode = node
    //   }
    // }

    // this is an exact match for the calculations done in the shardus server:
    // generate limited data for all nodes data for all nodes.
    ShardFunctions.computeNodePartitionDataMap(shardGlobals, nodeShardDataMap, activeNodes, parititionShardDataMap, activeNodes, false)
    // get extended data for our node
    nodeShardData = ShardFunctions.computeNodePartitionData(shardGlobals, ourNode, nodeShardDataMap, parititionShardDataMap, activeNodes, true)
    // generate full data for nodes that store our home partition
    ShardFunctions.computeNodePartitionDataMap(shardGlobals, nodeShardDataMap, nodeShardData.nodeThatStoreOurParitionFull, parititionShardDataMap, activeNodes, true)
    // cycleShardData.nodeShardData = cycleShardData.nodeShardDataMap.get(cycleShardData.ourNode.id)

    // generate lightweight data for all active nodes  (note that last parameter is false to specify the lightweight data)
    let fullDataForDebug = true // Set this to false for performance reasons!!! setting it to true saves us from having to recalculate stuff when we dump logs.
    ShardFunctions.computeNodePartitionDataMap(shardGlobals, nodeShardDataMap, activeNodes, parititionShardDataMap, activeNodes, fullDataForDebug)

    // this is the function that messes up out calculations
    ShardFunctions.computeNodePartitionDataMapExt(shardGlobals, nodeShardDataMap, activeNodes, parititionShardDataMap, activeNodes)

    console.log('storedPartitions' + utils.stringifyReduce(nodeShardData.storedPartitions))

    // calc consensus partitions
    let ourConsensusPartitions = ShardFunctions.getConsenusPartitionList(shardGlobals, nodeShardData)
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
      let partitions2 = ShardFunctions.getStoredPartitionList(shardGlobals, nodeData)

      console.log(`node stored: ${utils.stringifyReduce(partitions2)} ${key}`)
    }
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

    //hack
    let nodeShardData2 = ShardFunctions.computeNodePartitionData(shardGlobals2, ourNode, nodeShardDataMap2, parititionShardDataMap2, activeNodes2, true)


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
    let {homePartition, addressNum} = ShardFunctions.addressToPartition(shardGlobals, debugAccount)
    //ShardFunctions.
    let summaryObject = ShardFunctions.getHomeNodeSummaryObject(homeNode)
    let relationString = ShardFunctions.getNodeRelation(homeNode, debugID)

    let weStoreThisParition = ShardFunctions.testInRange(homePartition, nodeShardData.storedPartitions)

    console.log(` summary:${utils.stringifyReduce(summaryObject)}`)
    console.log(` relationString:${relationString}`)
    console.log('Home node for debug acc:' + utils.stringifyReduce(homeNode))
    console.log('nodeThatStoreOurParitionFull:' + utils.stringifyReduce(homeNode.nodeThatStoreOurParitionFull))
    let { homePartition: partition } = ShardFunctions.addressToPartition(shardGlobals, debugAccount)

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
    let { homePartition, addressNum } = ShardFunctions.addressToPartition(shardGlobals, address)
    let addressRangeHome = ShardFunctions.partitionToAddressRange2(shardGlobals, homePartition)
    
    if(addressRangeHome.low > address){
      let {homePartition2, addressNum2} = ShardFunctions.addressToPartition(shardGlobals, address)
      ShardFunctions.addressToPartition(shardGlobals, address)
      let fail = true
      let asdf = homePartition2
    }
    if(addressRangeHome.high < address){
      let {homePartition3, addressNum3} = ShardFunctions.addressToPartition(shardGlobals, address)
      ShardFunctions.addressToPartition(shardGlobals, address)
      let asdf = homePartition3
      let fail = true
    }


    let inRange2 = ShardFunctions.testInRange(homePartition, homeNode.storedPartitions)
    if (inRange2 === false) {
      homeNode = ShardFunctions.findHomeNode(shardGlobals, address, parititionShardDataMap)
      inRange2 = ShardFunctions.testInRange(homePartition, homeNode.storedPartitions)
      throw new Error('home node not in range 2')
    }

    // not sure this test is valid anymore. a node's address does not define its exact location anymore. (a sorted by address list does, that is counted)
    // for (let node of homeNode.consensusNodeForOurNode) {
    //   let inRange3 = ShardFunctions.testAddressInRange(node.id, homeNode.storedPartitions)
    //   if (inRange3 === false) {
    //     throw new Error('node not in range 1')
    //   }
    // }

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
        partitionInRange = ShardFunctions.testInRange(homePartition, nodeData.storedPartitions)
        inRange4 = ShardFunctions.testAddressInRange(address, nodeData.storedPartitions)

        if(nodeData.storedPartitions.rangeIsSplit === true){
          let addressRange1 = ShardFunctions.partitionToAddressRange2(shardGlobals, nodeData.storedPartitions.partitionStart1)
          let addressRange2 = ShardFunctions.partitionToAddressRange2(shardGlobals, nodeData.storedPartitions.partitionEnd1)

          if(addressRange1.low > address){
            let fail = true
          }
          if(addressRange2.high < address){
            let fail = true
          }

          let addressRange1b = ShardFunctions.partitionToAddressRange2(shardGlobals, nodeData.storedPartitions.partitionStart2)
          let addressRange2b = ShardFunctions.partitionToAddressRange2(shardGlobals, nodeData.storedPartitions.partitionEnd2)

          if(addressRange1b.low > address){
            let fail = true
          }
          if(addressRange2b.high < address){
            let fail = true
          }
        } else {
          let addressRange1 = ShardFunctions.partitionToAddressRange2(shardGlobals, nodeData.storedPartitions.partitionStart1)
          let addressRange2 = ShardFunctions.partitionToAddressRange2(shardGlobals, nodeData.storedPartitions.partitionEnd1)

          if(addressRange1.low > address){
            let fail = true
          }
          if(addressRange2.high < address){
            let fail = true
          }
        }
        //let addressRange = ShardFunctions.partitionToAddressRange2(shardGlobals, partitionStart)

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

/* eslint-enable */

// keep this
