/* eslint-disable */
// const StateManager = require('../../../src/state-manager')
//const ShardFunctions = require('../../../src/state-manager/shardFunctions.js')
const ShardFunctions = require('../../../build/src/state-manager/shardFunctions.js').default
// import {ShardGlobals,ShardInfo,WrappableParitionRange,NodeShardData,AddressRange, HomeNodeSummary,ParititionShardDataMap,NodeShardDataMap,MergeResults,BasicAddressRange} from  './shardFunctionTypes'
// import ShardFunctions from './shardFunctions.js'

const crypto = require('@shardus/crypto-utils')
const utils = require('../../../build/src/utils')
crypto('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')

// generate a sorted list of nodes
function generateNodes(count, predefinedList = null) {
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
  nodeList.sort(function (a, b) {
    return a.id === b.id ? 0 : a.id < b.id ? -1 : 1
  }) // a[propName] == b[propName] ? 0 : a[propName] < b[propName] ? -1 : 1
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

function getClosestNodes(shardGlobals, parititionShardDataMap, activeNodes, hash, count = 1) {
  // if (this.currentCycleShardData == null) {
  //   throw new Error('getClosestNodes: network not ready')
  // }
  // let cycleShardData = this.currentCycleShardData
  let homeNode = ShardFunctions.findHomeNode(shardGlobals, hash, parititionShardDataMap)
  let homeNodeIndex = homeNode.ourNodeIndex
  let idToExclude = ''
  let results = ShardFunctions.getNodesByProximity(
    shardGlobals,
    activeNodes,
    homeNodeIndex,
    idToExclude,
    count,
    true
  )

  return results
}

function isNodeInDistancePartition(shardGlobals, hash, nodeId, distance) {
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

function isNodeInDistance(shardGlobals, parititionShardDataMap, hash, nodeId, distance) {
  let someNode = ShardFunctions.findHomeNode(shardGlobals, nodeId, parititionShardDataMap)
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
// let hardcodeNodes = ['068ex9699a', '3e7fx601a4', '4222xc48ab', '4d05xb7aaf', '5aacx228d3', '5b61xf5dca', '86b0x899cb', 'a4bdx83351', 'aa5ax8c81c', 'b432x1ecdc', 'dc16x79767', 'e0c3x00452', 'e8aexf9d78', 'e9f1xfc329', 'ff7fxcb7ef']
// let hardcodeNodes = ['16d0x3f6b2', '29d2x27971', '3b7ex5a91f', '4f57x3315c', '5d07x8bd45', '601dx69c34', '65c2xfc59d', '97dax03078', '9a01xa8f84', 'b050x62c87', 'b120x366ef', 'b48cxcf41f', 'd65fxae412', 'd875x49a69', 'e6d6x24afc']
// let hardcodeNodes = ['1181x916b1', '1f40x556d2', '2837x2e9da', '2c6bx1c5b3', '3cacx91e08', '4124x4a6c7', '66ebx6e880', '6759xe4f9e', '73cbxaffd8', '76eax30249', '97efxf9461', 'a0c6x751bd', 'b1c3x8d872', 'c778x9b37e', 'd1e9xfe682', 'ed93x9ac1b']
// let hardcodeNodes2 = ['0ac0xf9a47', '19e0x84509', '1e83xbf3d2', '30cax3bafc', '450bx96e7d', '4dc0x48b55', '4e6fx6d689', '5429x91097', '61c6x3ffa5', '7a52x3e35d', '8a54xad1db', 'ac3cx755d8', 'dcf5x9ba90', 'ddb8xab70e', 'e55ex33985', 'ece5x609fb', 'fe95x65248']
// let hardcodeNodes = ['0ac0xf9a47', '1e83xbf3d2', '30cax3bafc', '450bx96e7d', '4dc0x48b55', '4e6fx6d689', '5429x91097', '61c6x3ffa5', '7a52x3e35d', '8a54xad1db', 'ac3cx755d8', 'dcf5x9ba90', 'ddb8xab70e', 'e55ex33985', 'ece5x609fb', 'fe95x65248']

// let hardcodeNodes2 = ['0861xe349b', '13b5x72241', '22e3x54e31', '2301x41f85', '3d28xd21aa', '78b1x23027', '7d43xb8b78', '843bx3f78d', '902dx9bf68', '9c99x9469d', 'be14x1ce18', 'dd2fx5419e', 'e2b1x19f9a', 'e9a9xbb0c4', 'fd7fx6ffa1']
// let hardcodeNodes = ['0861xe349b', '13b5x72241', '22e3x54e31', '2301x41f85', '3d28xd21aa', '78b1x23027', '7d43xb8b78', '843bx3f78d', '902dx9bf68', '9c99x9469d', 'be14x1ce18', 'dd2fx5419e', 'e2b1x19f9a', 'e9a9xbb0c4']

// let hardcodeNodes = ['05a6xa2f35', '06e3x5a6b6', '0b63x1bfab', '16c6xffeb6', '1788x01997', '2926x7106a', '6eb5xd541f', '9296x4ee2e', 'ae7fx325be', 'e2edx6a490', 'fed0x5de0b']
// let hardcodeNodes = ['0325xa8adb', '05a6xa2f35', '06e3x5a6b6', '0b63x1bfab', '16c6xffeb6', '1788x01997', '2926x7106a', '2fb3xc044f', '37aex2b600', '3e76x08324', '6eb5xd541f', '87aaxcc9fb', '9296x4ee2e', 'ae7fx325be', 'c7d2xb1a40', 'e0bcxbd49c', 'e2edx6a490', 'fed0x5de0b']

// let hardcodeNodes2 = ['0325xa8adb', '05a6xa2f35', '06e3x5a6b6', '0b63x1bfab', '16c6xffeb6', '1788x01997', '2926x7106a', '2fb3xc044f', '37aex2b600', '3e76x08324', '6eb5xd541f', '87aaxcc9fb', '9296x4ee2e', '9c39x1ff15', 'ae7fx325be', 'b29exe5d79', 'c7d2xb1a40', 'e0bcxbd49c', 'e2edx6a490', 'fed0x5de0b']

// let hardcodeNodes = ['5a37x87a3d', '5c42x61036', '84ebx211db']
// let hardcodeNodes2 = ['5a37x87a3d', '5c42x61036', '84ebx211db']

// let hardcodeNodes = ['0e6dx4047f', '1a02x90b21', '2479xba65c', '2512xbae99', '25e8xd16e3', '25f9x78474', '2e7fx69a34', '3395x341b0', '4403x0eaf9', '508fxcaa6e', '6ac4xec02d', '7238xc8cce', '72dax72106', '73eexdf738', '781cxaaae3', '7852x9ea56', '81e2x6bac8', '83cdxf22bc', '8675xc4b3b', '8af7x952e1', 'a1f2x02066', 'b002x24eb1', 'b68ex952c5', 'b6eexf00d4', 'c51bx318ed', 'c7cbx74fed', 'c9d0x44e0b', 'ce46xb48f9', 'd1d0xb78eb', 'd47cx41d3b', 'dac0x4999b', 'ddfex2f319', 'e598xe41ac', 'ec85xccb47', 'f391x66f35']
// let hardcodeNodes2 = null // ['0e6dx4047f', '1a02x90b21', '2479xba65c', '2512xbae99', '25e8xd16e3', '25f9x78474', '2e7fx69a34', '3395x341b0', '4403x0eaf9', '508fxcaa6e', '6ac4xec02d', '7238xc8cce', '72dax72106', '73eexdf738', '781cxaaae3', '7852x9ea56', '81e2x6bac8', '83cdxf22bc', '8675xc4b3b', '8af7x952e1', 'a1f2x02066', 'b002x24eb1', 'b68ex952c5', 'b6eexf00d4', 'c51bx318ed', 'c7cbx74fed', 'c9d0x44e0b', 'ce46xb48f9', 'd1d0xb78eb', 'd47cx41d3b', 'dac0x4999b', 'ddfex2f319', 'e598xe41ac', 'ec85xccb47', 'f391x66f35']
// let hardcodeNodes2 = null

// let hardcodeNodes = ['2054x6b984', '42b5x19622', '4efbx6ce6c', '55e5xaf076', '7a5ax9365e', '7f3exb4a97', '8d7dxfd5f5', 'b0a6x24dfa', 'c04exda76e', 'ed19xfd9ba']
// let hardcodeNodes2 = null

// let hardcodeNodes = ['147dxa6d28', '181bxf0697', '248ax315a9', '3068x6e56b', '33ebx5e423', '5f0fx95c7a', '9962xbf55f', 'd117xa3a73', 'e3d3xe4a5c', 'e6a2x24703']
// let hardcodeNodes2 = null

// let hardcodeNodes = ['02f2x50374', '1021xc4369', '1799xd547f', '242ex4bfbd', '30f0xea8a3', '3272x2a306', '4c96x8d210', '584dxd832a', '5c7fx2facc', '5c93x0f2a7', '7180xec580', '736cx7fa64', '750fx967f0', '7899x94a79', '89c9x85be0', '8c8bx815ad', '9adcx77753', 'a15fxd63a0', 'abc6xaa20f', 'd32ax93c1c', 'dc40x2b6ff', 'dd43xf3b5d', 'e986x67b4e', 'f0c4xea4f5', 'f211xb2904']
// let hardcodeNodes2 = null

// let hardcodeNodes = ['0692x2deec', '09afxee4b7', '0f3dxa312c', '18ecx3e3a1', '19c7x99e80', '19dfxcf9c7', '23d5xad4c5', '243dx817b9', '255fxd9030', '2642x4e37c', '3650x09963', '3f22x7a3ac', '42caxd50c0', '5307x662e7', '5e38xcc93f', '62c6xeee41', '653dx9f470', '677bx704a7', '7405xab8a5', '7b92x57e84', '911bx2a167', 'ac56x69db7', 'ae13xaa045', 'af8dxc0da5', 'b234x4ae35', 'c972x70e00', 'd6b5x79ed1', 'd8adxe7bd2', 'dcd7xdd2e1', 'e622xfadab']
// let hardcodeNodes2 = null

//
// let hardcodeNodes = ['11e8xddd45', '12c8xa6128', '1cb5x276fc', '2556x0d3cc', '3636xb84b3', '36f3x39cc0', '3b3dxe390d', '3ca6x4570b', '3eb3x6a829', '462fx9f1ea', '58c8x1d30f', '5e98xb924f', '621fxcdebc', '773fx3f03c', '8226x56b59', '9008x1db00', '98aax3d65a', '9cf3x5a8d6', '9f9dx52237', 'a795xbecb0', 'bf7cx31bf8', 'd69exef4b6', 'f44dxfff17', 'fb18x295a2', 'fcbbx3f509']
// let hardcodeNodes2 = null

//let hardcodeNodes = ["02b1x3c2d3","5a1bx18ebb","ef1dxfcd62"]
//let hardcodeNodes = ["11b1x3c2d3","881bx18ebb","cc1dxfcd62"]
// let hardcodeNodes = ["2114xd7ce1","6232xb72a9","9089x67082","b72dx4eecc","d371x2351d"]
// let hardcodeNodes2 = null

//t2x
// let hardcodeNodes = ["0b44x2d442","1f68xc5bd9","203axb60a6","3b50x94bd9","4d62x2fbb0","55b8x75d37","6065xe2415","6299x6fd31","767bxe33e6","7dfcx22d6c","9f5dxe964b","b092xe588c","f1b7xa2357"]
// let hardcodeNodes2 = null

//t20
// let hardcodeNodes = ["0b44x2d442","1f68xc5bd9","203axb60a6","3b50x94bd9","55b8x75d37","6065xe2415","6299x6fd31","767bxe33e6","7dfcx22d6c","9f5dxe964b","b092xe588c","f1b7xa2357"]
// let hardcodeNodes2 = null

//t19
//let hardcodeNodes = ["4423x0ab77","4a45x22d27","55bax46bbb","5d01x39d48","63eexfbe34","7ddcxb6586","9b8exa1c15","b520x4eef8","cab2x831cb","e029x146ea","f00bx0522f"]
//c25
let hardcodeNodes = [
  '0ac8x88ef1',
  '21f7x6483c',
  '6f96xae48b',
  '796fxf7e39',
  '8134x3d98c',
  '833ax8a51b',
  '851cxab703',
  '9d26x9011c',
  'c4c2x62e22',
  'd085xb50f6',
  'd49ax34fec',
  'e172xb3af1',
  'ed8fx77d71',
  'fc4bx4d28e',
]
let hardcodeNodes2 = null

// let hardcodeNodes = ['01cex1bed2', '0793xc7aee', '180bx3a172', '24afxce02d', '2d2ax053f6', '30aex6b5ca', '33d7x0a28e', '42bbx0242f', '43cax9b811', '5c70xdee7d', '5fcfx2f32d', '7303xfd71e', '7354xcedbc', '7b78xf936e', '7eabx5deea', '8609xcccf4', '88ecx4c9ab', '8c5axb8364', '93e3x87831', '9a91xb2cd3', '9d1dx51f4a', '9facx0e61c', 'a452x1f73d', 'a8e6xdd19c', 'bef0x7edf8', 'bfa5x12bbf', 'e116x7c34b', 'e89bxde077', 'eae4xeefb1', 'ffc1x1151f']
// let hardcodeNodes2 = null

// let hardcodeNodes = ["026bxf7f00","0fc2xbacb7","28eax6717f","2eedx05dcb","2f61x7203b","4796x1567b","5b52xf1dcb","5f20x3ef8b","600exc4756","63f1xc1c27","6cedx984cc","7fcbx33304","8bc4x50269","9626x288b0","97e8x87793","9f9ax480fd","a025x12af2","a305x7ad5c","ad6cx46a0d","ae04xd207d","b9f6x5fbbe","be73xff460","c356xdf16c","df3cx4ce46","e125x67ab3","e7e9x509e7","efcdx3c1cf","f84cx19324","f982x85d31","ff98x91e85"]
// let hardcodeNodes2 = null
// let hardcodeNodes = ['4ca7xe03b8', '5d85x8ca39', '9c66x6b491', 'c21ax78bee', 'ed57xe1d15']
// let hardcodeNodes2 = null

if (useHardcodenodes) {
  numNodes = hardcodeNodes.length
}
if (hardcodeNodes2) {
  numNodes2 = hardcodeNodes2.length
}
let debugStartsWith = '851c' // 21f7 851c '8bc4' // '33d7' //'0692' // '23d5' // 'f211' //'147d' // '2054' // '2512'  // '7459' // '5c42' // '37ae' // '37ae' '6eb5' // 97da 5d07 'dc16'  '0683'  'ed93' ac3c 3d28
let debugID = debugStartsWith.slice(0, 4) + '7'.repeat(64 - 4)
let debugAccount = '44dc' + '3'.repeat(60) // 5c43 386e 60b1  60b1 c173
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
  activeNodes.sort(function (a, b) {
    return a.id === b.id ? 0 : a.id < b.id ? -1 : 1
  })
  // let nodeToObserve = ourNode

  if (hardcodeNodes2 != null) {
    activeNodes2 = generateNodes(numNodes2, hardcodeNodes2)
    activeNodes2.sort(function (a, b) {
      return a.id === b.id ? 0 : a.id < b.id ? -1 : 1
    })
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
    ShardFunctions.computeNodePartitionDataMap(
      shardGlobals,
      nodeShardDataMap,
      activeNodes,
      parititionShardDataMap,
      activeNodes,
      false
    )
    // get extended data for our node
    nodeShardData = ShardFunctions.computeNodePartitionData(
      shardGlobals,
      ourNode,
      nodeShardDataMap,
      parititionShardDataMap,
      activeNodes,
      true
    )
    // generate full data for nodes that store our home partition
    ShardFunctions.computeNodePartitionDataMap(
      shardGlobals,
      nodeShardDataMap,
      nodeShardData.nodeThatStoreOurParitionFull,
      parititionShardDataMap,
      activeNodes,
      true
    )
    // cycleShardData.nodeShardData = cycleShardData.nodeShardDataMap.get(cycleShardData.ourNode.id)

    // generate lightweight data for all active nodes  (note that last parameter is false to specify the lightweight data)
    let fullDataForDebug = true // Set this to false for performance reasons!!! setting it to true saves us from having to recalculate stuff when we dump logs.
    ShardFunctions.computeNodePartitionDataMap(
      shardGlobals,
      nodeShardDataMap,
      activeNodes,
      parititionShardDataMap,
      activeNodes,
      fullDataForDebug
    )

    // this is the function that messes up out calculations
    ShardFunctions.computeNodePartitionDataMapExt(
      shardGlobals,
      nodeShardDataMap,
      activeNodes,
      parititionShardDataMap,
      activeNodes
    )

    console.log('storedPartitions' + utils.stringifyReduce(nodeShardData.storedPartitions))

    // calc consensus partitions
    let ourConsensusPartitions = ShardFunctions.getConsenusPartitionList(shardGlobals, nodeShardData)
    console.log(
      'ourConsensusPartitions ' +
        utils.stringifyReduce(ourConsensusPartitions) +
        `  consensusEndPartition: ${nodeShardData.consensusEndPartition} consensusStartPartition ${nodeShardData.consensusStartPartition}`
    )

    let hash = debugAccount // '0'.repeat(64) // debugAccount

    let closestNodes = getClosestNodes(shardGlobals, parititionShardDataMap, activeNodes, hash, 1)

    // @ts-ignore
    let closestNodes2 = getClosestNodes(shardGlobals, parititionShardDataMap, activeNodes, hash, 2)

    let closestNodes3 = getClosestNodes(shardGlobals, parititionShardDataMap, activeNodes, hash, 300)

    let inDist = isNodeInDistancePartition(shardGlobals, hash, debugID, 2)

    console.log(
      `getClosestNodes  ${closestNodes.length}    inDist:${inDist}  nodes:${closestNodes
        .map((node) => utils.stringifyReduce(node.id))
        .join(',')}`
    )
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

  ShardFunctions.computeNodePartitionDataMap(
    shardGlobals,
    nodeShardDataMap,
    activeNodes,
    parititionShardDataMap,
    activeNodes,
    true
  )
  ShardFunctions.computeNodePartitionDataMapExt(
    shardGlobals,
    nodeShardDataMap,
    activeNodes,
    parititionShardDataMap,
    activeNodes
  )

  if (hardcodeNodes2 != null) {
    let totalPartitions2 = numNodes2
    let shardGlobals2 = ShardFunctions.calculateShardGlobals(numNodes2, nodesPerConsenusGroup)
    ShardFunctions.computePartitionShardDataMap(shardGlobals2, parititionShardDataMap2, 0, totalPartitions2)
    ShardFunctions.computeNodePartitionDataMap(
      shardGlobals2,
      nodeShardDataMap2,
      activeNodes2,
      parititionShardDataMap2,
      activeNodes2,
      false
    )
    ShardFunctions.computeNodePartitionDataMap(
      shardGlobals2,
      nodeShardDataMap2,
      activeNodes2,
      parititionShardDataMap2,
      activeNodes2,
      true
    )
    ShardFunctions.computeNodePartitionDataMapExt(
      shardGlobals2,
      nodeShardDataMap2,
      activeNodes2,
      parititionShardDataMap2,
      activeNodes2
    )

    let ourNodeData = nodeShardDataMap.get(debugNode.id)
    let ourNodeData2 = nodeShardDataMap2.get(debugNode.id)

    let coverageChanges = ShardFunctions.computeCoverageChanges(ourNodeData, ourNodeData2)

    for (let change of coverageChanges) {
      // log info about the change.
      // ${utils.stringifyReduce(change)}
      console.log(
        ` ${ShardFunctions.leadZeros8(change.start.toString(16))}->${ShardFunctions.leadZeros8(
          change.end.toString(16)
        )} `
      )

      // create a range object from our coverage change.
      let range = {}
      range.startAddr = change.start
      range.endAddr = change.end
      range.low = ShardFunctions.leadZeros8(range.startAddr.toString(16)) + '0'.repeat(56)
      range.high = ShardFunctions.leadZeros8(range.endAddr.toString(16)) + 'f'.repeat(56)
      // create sync trackers
      // this.createSyncTrackerByRange(range, cycle)
    }
  }

  if (debugAccount != null) {
    let homeNode = ShardFunctions.findHomeNode(shardGlobals, debugAccount, parititionShardDataMap)
    // let shardParition = parititionShardDataMap.get(5)
    let { homePartition, addressNum } = ShardFunctions.addressToPartition(shardGlobals, debugAccount)
    //ShardFunctions.
    let summaryObject = ShardFunctions.getHomeNodeSummaryObject(homeNode)
    let relationString = ShardFunctions.getNodeRelation(homeNode, debugID)

    let weStoreThisParition = ShardFunctions.testInRange(homePartition, nodeShardData.storedPartitions)

    console.log(` summary:${utils.stringifyReduce(summaryObject)}`)
    console.log(` relationString:${relationString}`)
    console.log('Home node for debug acc:' + utils.stringifyReduce(homeNode))
    console.log(
      'nodeThatStoreOurParitionFull:' + utils.stringifyReduce(homeNode.nodeThatStoreOurParitionFull)
    )
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
        throw new Error(
          `address not in range 2. node: ${utils.makeShortHash(node.id)} addr: ${utils.makeShortHash(
            address
          )} home: ${utils.makeShortHash(homeNode.node.id)} p:${partitionInRange}`
        )
      }
      // if (inRange4 === true && partitionInRange === false) {
      //   console.log('error')
      // }
    }
  }
}

if (testIterations > 0) {
  console.log(
    `Extra nodes total: ${extraNodesTotal} avg: ${extraNodesTotal / testCounter}  avg per node: ${
      extraNodesTotal / (testCounter * numNodes)
    }`
  )
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
