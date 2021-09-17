// @ts-nocheck
/*eslint-disable*/
// const StateManager = require('../../../src/state-manager')
//const ShardFunctions = require('../../../src/state-manager/shardFunctions.js')
const ShardFunctions = require('../../../build/src/state-manager/shardFunctions.js').default
// import {ShardGlobals,ShardInfo,WrappableParitionRange,NodeShardData,AddressRange, HomeNodeSummary,ParititionShardDataMap,NodeShardDataMap,MergeResults,BasicAddressRange} from  './shardFunctionTypes'
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

function getDataSourceNode(currentCycleShardData, lowAddress, highAddress) {

  let dataSourceNode 
  let queryLow
  let queryHigh

  queryLow = lowAddress
  queryHigh = highAddress

  let centerNode = ShardFunctions.getCenterHomeNode(currentCycleShardData.shardGlobals, currentCycleShardData.parititionShardDataMap, lowAddress, highAddress)
  if (centerNode == null) {
    //if (logFlags.debug) this.mainLogger.debug(`centerNode not found`)
    return
  }

  let nodes = ShardFunctions.getNodesByProximity(
    currentCycleShardData.shardGlobals,
    currentCycleShardData.activeNodes,
    centerNode.ourNodeIndex,
    currentCycleShardData.ourNode.id,
    40
  )

  //add back in maybe?
  //nodes = nodes.filter(this.removePotentiallyRemovedNodes)

  let filteredNodes = []
  for(let node of nodes){

    let nodeShardData = currentCycleShardData.nodeShardDataMap.get(node.id)
    if(nodeShardData != null){

      if(ShardFunctions.testAddressInRange(queryLow, nodeShardData.consensusPartitions) === false){
        continue
      }
      if(ShardFunctions.testAddressInRange(queryHigh, nodeShardData.consensusPartitions) === false){
        continue
      }
      filteredNodes.push(node)
    }
  }
  nodes = filteredNodes
  if(nodes.length > 0){
    dataSourceNode = nodes[Math.floor(Math.random() * nodes.length)]
  }

  return {dataSourceNode, dataSourceNodes: nodes}
}

//9555x00000
function upscaleAddr(addr, repeatChar){
  let up = addr.slice(0, 4) + repeatChar.repeat(64 - 4)
  return up
}

function syncRangeCalculations(currentCycleShardData){
  let chunksGuide = 4
  let syncRangeGoal = Math.max(1, Math.min(chunksGuide, Math.floor(currentCycleShardData.shardGlobals.numPartitions / chunksGuide)))
  let partitionsCovered = 0
  let partitionsPerRange = 1


  let nodeShardData = currentCycleShardData.nodeShardData

  let rangesToSync = []
  if (nodeShardData.storedPartitions.rangeIsSplit === true) {
    partitionsCovered = nodeShardData.storedPartitions.partitionEnd1 - nodeShardData.storedPartitions.partitionStart1
    partitionsCovered += nodeShardData.storedPartitions.partitionEnd2 - nodeShardData.storedPartitions.partitionStart2
    partitionsPerRange = Math.max(Math.floor(partitionsCovered / syncRangeGoal), 1)
    if (logFlags.console)
      console.log(
        `syncRangeGoal ${syncRangeGoal}  chunksGuide:${chunksGuide} numPartitions:${currentCycleShardData.shardGlobals.numPartitions} partitionsPerRange:${partitionsPerRange}`
      )

    let start = nodeShardData.storedPartitions.partitionStart1
    let end = nodeShardData.storedPartitions.partitionEnd1
    let currentStart = start
    let currentEnd = 0
    let nextLowAddress = null
    let i = 0
    while (currentEnd < end) {
      currentEnd = Math.min(currentStart + partitionsPerRange, end)
      let range = ShardFunctions.partitionToAddressRange2(currentCycleShardData.shardGlobals, currentStart, currentEnd)

      let { address1, address2 } = ShardFunctions.getNextAdjacentAddresses(range.high)
      range.high = address1

      if (nextLowAddress != null) {
        range.low = nextLowAddress
      }
      if (logFlags.console) console.log(`range ${i}  s:${currentStart} e:${currentEnd} h: ${homePartition}  a1: ${range.low} a2: ${range.high}`)
      nextLowAddress = address2
      currentStart = currentEnd
      i++
      rangesToSync.push(range)
    }

    start = nodeShardData.storedPartitions.partitionStart2
    end = nodeShardData.storedPartitions.partitionEnd2
    currentStart = start
    currentEnd = 0
    nextLowAddress = null

    while (currentEnd < end) {
      currentEnd = Math.min(currentStart + partitionsPerRange, end)
      let range = ShardFunctions.partitionToAddressRange2(currentCycleShardData.shardGlobals, currentStart, currentEnd)

      let { address1, address2 } = ShardFunctions.getNextAdjacentAddresses(range.high)
      range.high = address1

      if (nextLowAddress != null) {
        range.low = nextLowAddress
      }
      // if (logFlags.console) console.log(`range ${i}  s:${currentStart} e:${currentEnd} h: ${homePartition} a1: ${range.low} a2: ${range.high}`)

      nextLowAddress = address2
      currentStart = currentEnd
      i++
      rangesToSync.push(range)
    }
  } else {
    partitionsCovered = nodeShardData.storedPartitions.partitionEnd - nodeShardData.storedPartitions.partitionStart
    partitionsPerRange = Math.max(Math.floor(partitionsCovered / syncRangeGoal), 1)
    // if (logFlags.console)
      // console.log(
      //   `syncRangeGoal ${syncRangeGoal}  chunksGuide:${chunksGuide} numPartitions:${currentCycleShardData.shardGlobals.numPartitions} partitionsPerRange:${partitionsPerRange}`
      // )

    let start = nodeShardData.storedPartitions.partitionStart
    let end = nodeShardData.storedPartitions.partitionEnd

    let currentStart = start
    let currentEnd = 0
    let nextLowAddress = null
    let i = 0
    while (currentEnd < end) {
      currentEnd = Math.min(currentStart + partitionsPerRange, end)
      let range = ShardFunctions.partitionToAddressRange2(currentCycleShardData.shardGlobals, currentStart, currentEnd)

      let { address1, address2 } = ShardFunctions.getNextAdjacentAddresses(range.high)
      range.high = address1

      if (nextLowAddress != null) {
        range.low = nextLowAddress
      }
      // if (logFlags.console) console.log(`range ${i}  s:${currentStart} e:${currentEnd} h: ${homePartition}  a1: ${range.low} a2: ${range.high}`)
      nextLowAddress = address2
      currentStart = currentEnd
      i++
      rangesToSync.push(range)
    }
  }

  return rangesToSync

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

//let hardcodeNodes = ["1068xba311","1cf5x7853f","3342x2ad01","34e4xe74ad","37a5x0f51f","686ex5eeab","7f49x835c9","d3c0x17f2e","e3bfx0dd65","f844xdf6d3"]
let hardcodeNodes = ["00a0xc75ae","0156xd55bd","0204x94ebb","0262xcceee","0319x991f1","03aax3f8ee","03b9xd7940","03d4x1150e","050ex62a01","05dfxde34c","0658x668bb","0669x10d7b","068cx6bcbb","06f9x46002","07b6x55775","0857xf83b3","08bfx71087","08ffx4becc","0917xb40aa","09b9x9685f","0a02x1dfda","0a09x40d77","0b17x4a3c8","0c6fx3e2f2","0d1cx0fb61","0e8cx95f61","0efbx0da39","10a4xd40b0","10e7xfeb98","10edx0956f","11c4xba8e0","1233xf8391","123cxc110a","1272x3cc94","12f4xd5d3c","14e1x1a95b","1506x6a39c","15f0x284b0","1739x981b7","1814x249b3","1955xfd34f","1986x4e9d3","19c1x5b38a","1b78x948df","1b91x44567","1b92x22da2","1be8xefff5","2066x98c1b","20efx30f2d","21e1x1842f","221cx473fb","2307x32a2c","2310x1444d","23e7x7673a","2457xfff51","247dxbf1c1","24a9x5b4bd","26ecx2065f","2803x0e19b","28a4x05ace","28b0x124b9","2a3ex8a57f","2b20xf6647","2ba2xcdb5a","2bb3x460c4","2be8x40562","2c84x84690","2cf0x11fb3","2d99x2fa15","2e72x460aa","303excdd31","3058xde2b1","30ecxc09d3","3184xf3563","326ex1d531","33d8xc83a7","3482xf3b2c","3515x005f8","3568x4bc0d","3603xb5f36","3613xefae0","36f7x517a1","3786xbee7e","381ex66615","3854x9d77a","38b5x045db","38dfx2f498","38e1x185b7","3929xfe674","3974x85b6c","39c9xc8d62","3a53xba5d3","3b30x36486","3b41x2a0a7","3bebx24940","3c47xfc805","3ee9xaa87e","3f3exb6153","3f61x5e991","3f65x1f424","407dxba06b","4098x4205a","40d3xe6d52","412cxf78ff","4136x8b5d8","41e4x5c666","41eax58058","4214xcf387","423ax788c9","42c6x933f3","44e4x89431","45a5x71105","4678x16f8b","4684x2bf36","47bfx9d2ee","491exe1cec","496dx92399","49adx5d835","4a6bx5645f","4a96x753a8","4aedx507d5","4b6ax0df46","4c06xb9769","4cdax0f9ef","4d1dxf68b7","4d3ex98458","4dd9xb53d7","4f58x96324","4fd4xd087c","50c4x2bb1c","50dcx02e56","50e5x12905","50fax98b61","514axbdb67","5274xb9300","5285x2325e","532fxfa288","5345xcaef7","539bxb0dc0","5424x83cb6","5507x4ae7f","55b6xabe27","5616x67297","57e0x4daa1","57efx79bc7","57f3x68119","5840xe6f33","59e3xecf6c","5a9fx7da1f","5b35xacdbf","5b9fx71932","5bc3x92ef9","5c21x3cb7f","5cafxc5ac0","5ccex3c94e","5e62x5f9b5","5e7dx571a7","5e84xf39e6","5ea2x1dbb8","5f4cxddb17","5f99x950e7","6090x5f466","61a9x9e108","6226x3be7e","62d4x12ec7","6313x52aa7","6349x38f59","6521x4775b","6707x9294a","67a4x4c9e4","67b5x62cd6","6828x1d6a6","69d0x3713f","69e5x9d1cf","6a4bx80dce","6b02xc7b47","6b12x741a7","6b85x6d8bc","6d97x7a2d8","6e33x16c23","6e66xfede3","6f44xbb61c","6fc3x73f4a","7059x2f5c7","706bx62870","722bx4fbb3","7242x596d2","72c8x21cc9","738dxd66a0","73ccx0e7dd","7512x97d68","75a6x7b58f","763cxce011","76eex7ca7e","786cx1b180","7a1cx76946","7a89xd9bba","7aa0x51819","7ae4x37412","7b1bxa901a","7d0dxbe27e","7e3ax0b9fe","7ed5x55627","7ed8x11bed","8142xbf8d7","820ax50c93","821fxc2084","82d0xf2cd1","8335xebe3c","859bx7660e","85aexa87be","8723x7851b","8784xd37ab","87c2xbd210","8910x8d2b2","891ax640d2","8aebx2ed40","8ba9x4b774","8c1cx5a3cc","8c3dx0f0b3","8cc5xb668e","8d15xdf9f2","8d59x4e9cb","8dccx7272b","8dcex9f112","8e2fx1f385","8eafxd228f","8f21xab1a5","8f3fxc4c41","8fa2x8b6d8","8ffbx01e2f","901fx1c5d0","91c1x5a724","92cbxccfe0","92e6x9a86c","9376xcc0bf","9393x932e9","93bbx799dd","9413x3fd5b","94e3xbde34","965fx4fcd4","9687xc03cf","9772xbab3a","98ccxb8354","98e1xee8d8","98ffx9b9c5","997cxea6e4","9a74x6b25f","9a9dxe4d22","9bcdx30443","9c24x20ef2","9d12x20a78","9d2cx91a09","9db2xd97d7","9f7dx4042a","9fbfx4e9b6","a089x92645","a0dbxe53ec","a11dx9a8c8","a146x1d6e8","a153x5aa4d","a1fbxd8283","a623x6c520","a752x746d7","a7a5xc483e","a7c1xf0637","a7c9x3c0a1","a84ex3e918","a87bx89e7f","a93dx9be53","a9ffx88fcf","aa27x15450","aaa0x1c386","aaa3xf3452","aabdx3002d","ab48x50235","ab63xf6271","ab7bxad141","aca2xcd5c3","acc9x65da1","adf9x00ce9","ae06x1b7d7","ae8cx2d4d9","af9bx6fd00","afb5x857b4","b117xec63f","b21ex00d01","b381x9f826","b44bxbe7f0","b541xc1563","b59ex20501","b5a9x406ab","b6d8x2e8de","b7a4x7f563","b7b7x4d8e9","b917x1afa8","ba8axc0ed5","ba8axabc22","ba8ex67ac2","bc8dxbf361","bd90x267fe","be80xa8351","bf45x1d116","bf69x2a415","bff3x8f0d0","c1edx586c2","c219xbf811","c3a7x25a79","c4acxbecba","c5c4x7a95b","c60bx80abc","c675x722bc","c707x48b34","c746x45be5","c77bxf5d28","c77fx4a86e","c88fx7dd8e","cb28x23170","cc03xf35d6","cce4x4dcc5","cea7x689a2","cecfx1d9a5","d115xf567b","d1eex2f46f","d20cxe6a01","d2e1x8924d","d347x5ec15","d3efx69a67","d5b2xb5d03","d640x02393","d656x0e01f","d6edx4a097","d6eex74b18","d73dxb6aed","d744xbf2f4","d8d0x83f35","d8efx407bd","d8f9xda407","d996x32dd6","d9d7xcfdc0","da53x93c52","da88x9e838","db8cx2c735","dc2cx3c385","dd3fxb968d","dd5dx2670e","dd82x97960","ddcex72985","dddbxe1215","de51xcce40","de57x7eef5","df9dxfe613","dfcbxe1805","dfe0xca208","e160x6d59a","e17cxc8c46","e320xc0379","e33ax7711e","e44ex19760","e5fcx58f51","e633xbf1d4","e70dx9e1c1","e717x117f3","e9fbxdbc3f","eab0xe16ab","eabex557ac","eb5ex767de","eb8cx5fd8a","ecbax767a4","ed23x9335d","ed2bx55c9f","ed3ax97843","ee28x53355","ee85x13ccf","ef9fxc76ba","f15fxa613e","f232x10a47","f258xe78f4","f35cxecd41","f37dx59633","f433x6b877","f497x52004","f4b4x67c2a","f4b8x054ba","f51axe1e8a","f5d4xd9408","f5d5xf6c22","f6cbxd3e2d","f742x7bd11","f7eax8da14","f9fcx78250","fc79xfcc08","fc9cx018a9","fca7xcfef6","fd3dx76eef","fd96x9e78b","fe3axb5ea7","fef1x7ef12","ffc4x984ad","fff2x9527e"]

let hardcodeNodes2 = null//["1653x16ec1","19f0xd5472","1cf4xde0eb","2a19x5e3b1","32bexf57c0","4995xf8b99","4ecexd6312","5a7fx44c45","68cbx40e22","70b5x9e9ee","726cx7382c","759axd5017","792exda25a","a2a8x6c883","a61ex8efbf","d7ddx789eb","f0ddx1549b","f937x3e4ce","fd6cxea9a4"] 

if (useHardcodenodes) {
  numNodes = hardcodeNodes.length
}
if (hardcodeNodes2) {
  numNodes2 = hardcodeNodes2.length
}

// Set debugStartsWith to specify what node will be "our node" in the following calculations
let debugStartsWith = '9a9d' // 21f7 851c '8bc4' // '33d7' //'0692' // '23d5' // 'f211' //'147d' // '2054' // '2512'  // '7459' // '5c42' // '37ae' // '37ae' '6eb5' // 97da 5d07 'dc16'  '0683'  'ed93' ac3c 3d28
let debugID = debugStartsWith.slice(0, 4) + '7'.repeat(64 - 4)

// set debugAccount to specify and example address that will get calculations made to it
let debugAccount = 'c69e' + '3'.repeat(60) // 5c43 386e 60b1  60b1 c173
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

  let currentCycleShardDataFake = {}
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

 
    currentCycleShardDataFake.nodeShardData = nodeShardData
    currentCycleShardDataFake.activeNodes = activeNodes
    currentCycleShardDataFake.ourNode = ourNode
    currentCycleShardDataFake.parititionShardDataMap = parititionShardDataMap
    currentCycleShardDataFake.shardGlobals = shardGlobals
    currentCycleShardDataFake.nodeShardDataMap = nodeShardDataMap
    currentCycleShardDataFake.consensusPartitions = nodeShardData.consensusPartitions

    // generate full data for nodes that store our home partition
    ShardFunctions.computeNodePartitionDataMap(shardGlobals, nodeShardDataMap, nodeShardData.nodeThatStoreOurParitionFull, parititionShardDataMap, activeNodes, true)
    // cycleShardData.nodeShardData = cycleShardData.nodeShardDataMap.get(cycleShardData.ourNode.id)

    // generate lightweight data for all active nodes  (note that last parameter is false to specify the lightweight data)
    let fullDataForDebug = true // Set this to false for performance reasons!!! setting it to true saves us from having to recalculate stuff when we dump logs.
    ShardFunctions.computeNodePartitionDataMap(shardGlobals, nodeShardDataMap, activeNodes, parititionShardDataMap, activeNodes, fullDataForDebug)

    // this is the function that messes up out calculations
    //ShardFunctions.computeNodePartitionDataMapExt(shardGlobals, nodeShardDataMap, activeNodes, parititionShardDataMap, activeNodes)
    
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

    //////////////////////////////////////////////////
    //DATA sync ranges investigation...
    let lowAddressSearch = upscaleAddr("9555x00000",'0' )
    let highAddressSearch = upscaleAddr("9d2axfffff",'f')

    let {dataSourceNode, dataSourceNodes} = getDataSourceNode(currentCycleShardDataFake,lowAddressSearch, highAddressSearch )


    //generte sync ranges
    let rangesToSync = syncRangeCalculations(currentCycleShardDataFake)

    //test if sync ranges can find valid nodes!
    for(let range of rangesToSync){

      let {dataSourceNode, dataSourceNodes} = getDataSourceNode(currentCycleShardDataFake,range.low, range.high )
      console.log(`dataSorurces  ${dataSourceNodes.length}  `)
      if(dataSourceNodes.length === 0){
        console.log(`error dataSorurces  ${dataSourceNodes.length}  `)
        dataSorurce = getDataSourceNode(currentCycleShardDataFake,range.low, range.high )
      }
    }
    //////////////////////////////////////////////////
    //////////////////////////////////////////////////
    //////////////////////////////////////////////////

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
  //ShardFunctions.computeNodePartitionDataMapExt(shardGlobals, nodeShardDataMap, activeNodes, parititionShardDataMap, activeNodes)

  if (hardcodeNodes2 != null) {
    let totalPartitions2 = numNodes2
    let shardGlobals2 = ShardFunctions.calculateShardGlobals(numNodes2, nodesPerConsenusGroup)
    ShardFunctions.computePartitionShardDataMap(shardGlobals2, parititionShardDataMap2, 0, totalPartitions2)
    ShardFunctions.computeNodePartitionDataMap(shardGlobals2, nodeShardDataMap2, activeNodes2, parititionShardDataMap2, activeNodes2, false)
    ShardFunctions.computeNodePartitionDataMap(shardGlobals2, nodeShardDataMap2, activeNodes2, parititionShardDataMap2, activeNodes2, true)
    //ShardFunctions.computeNodePartitionDataMapExt(shardGlobals2, nodeShardDataMap2, activeNodes2, parititionShardDataMap2, activeNodes2)

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
