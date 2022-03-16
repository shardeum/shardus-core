// @ts-nocheck
/*eslint-disable*/
// const StateManager = require('../../../src/state-manager')
//const ShardFunctions = require('../../../src/state-manager/shardFunctions.js')
const ShardFunctions = require('../../../dist/state-manager/shardFunctions').default
// import {ShardGlobals,ShardInfo,WrappableParitionRange,NodeShardData,AddressRange, HomeNodeSummary,ParititionShardDataMap,NodeShardDataMap,MergeResults,BasicAddressRange} from  './shardFunctionTypes'
// import ShardFunctions from './shardFunctions.js'

const crypto = require('@shardus/crypto-utils')
const utils = require('../../../dist/utils')
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
let numNodes = 10000
let numNodes2 = 0

/** @type {boolean} */
let useHardcodenodes = false

let hardcodeNodes = ["0029x41959","0096x7fba4","00b1x2fc2b","0104x34569","0109x3332b","013axfa572","0189xd3313","0196xcfcae","01c5x3a487","0218x1c996","0288xa0269","0289x27d30","0290x43cb9","0298xffeb2","029bx258dc","02f1xb9567","02ffx358ad","0324xb481c","032exa8c44","0335x641e1","0363xf5e2f","036bx8cb4e","03a0xc8669","03bbx0f60f","0403x71a23","040cx2ef88","041cx2181b","0445x7bc71","0457x66454","0488xa76e7","0494x73c45","04ecx49ff4","0533x30712","0548xba7e1","05b4xc43d5","05d2x88b6e","0613xa1ea1","0644x31282","0647xbda3d","066dx2810d","0692xfda3d","06bdxd87e8","06d3xd2147","0710xf90c0","071ax247a5","0736xadc87","0832x19b07","086cx55b55","08a5x2048d","08acx11616","0907x35cc4","0929x873c9","0958xf6d86","099cx32d2d","09bexfa66a","09f1x71067","09faxe44bb","0a26xa13c7","0a2fx69d5a","0a42xc6cd6","0a59xb8ed0","0b5dx24710","0b93x019e6","0bb1x52207","0beexa9467","0c04xfec7a","0c44x410cd","0ca4xfc483","0cb0xee223","0cfaxe43d5","0d04xc006f","0d45x35d52","0d52x95752","0d79x6ade2","0db1x9c1c4","0e6dxfbd59","0e7ex09a8a","0edfxeeb58","0f63x0d829","0fabx8ffd1","100dx4c30c","1012x68d9a","1031x048a3","11a5x5c7c9","11d1x0c2c5","11e6xb8cd2","1240x2bf93","1275x89d9b","135bx2aeb3","1366x6d0c9","139bx004fe","14c4xd3fdb","1580xcfa3f","15b5xd5788","1619xf7ed3","16d3x06bf0","16dcx7cbac","16f1xe7c1a","16fdxe2050","172bx64ed5","176fxcfa9b","1842xe6040","1849xa0483","1894xfd62c","18edx5dac7","18fbxa0c17","18ffxf2c37","19efx1e39b","1a1dxd6c14","1a50x2543e","1aa1x002fb","1b53x15f76","1b8exdd726","1bc1x8efe7","1bedxdffc5","1c3fxbf781","1c4fx785ac","1cd9x8058b","1cebx8922d","1cefx7d0e9","1cfcx00504","1d65xa1984","1d9cx21c8e","1ddax0cd42","1e26x8e216","1e39xda521","1ea1x79932","1f1fx96e0c","1f44xc9673","1f4cx7a971","1febx1037c","2056x781b9","2093xa1b7a","20a1xfdc3b","20bdx99d29","20f7xb62aa","2100xee6b5","2105x7e9bc","2149x155e8","216axad901","217bx3b73f","217dxa8de6","21b7x08517","21b8x78d02","21d3x062fe","2208x2095d","2216xd356c","2294x5d7f0","22b3xcc4e0","22b7x4934d","22cax8832f","235dx85f7a","23d4xa573f","23e8x5da16","2404x961fa","2469x2a257","2469x4cac2","252dxf60fe","2592x2f5ac","25e0xed401","25f5x0c543","262cxb09dd","263fx88ff0","2654xb6ff0","2663xfbee4","2684xfdf7e","2687x87e9a","26dcxb35e3","273dxf6642","2745x22dd7","2748x3d47b","274ex82a8e","278cx97d7b","27b4x513ed","27cbx5eaa3","2853xbf6b4","286bx66e56","2875xca8ac","28b4xc645e","28bex90aeb","28f6xa441b","2906xce0c3","290dx51ad6","290ex17e38","2938x06771","2957xaa8e7","29b8xd8afe","2a0fx13ed0","2a23xa06d5","2a99x519c1","2a9dxae152","2b05x868a5","2b4cx61ea4","2bb7xf4867","2bd2xbbe11","2bd6x24c5c","2bdfx21e8c","2c04xdb768","2c0ax7dcd2","2c0dxd159f","2c1dx409f5","2c21xa794a","2c50x09d51","2c5dxdc1ab","2c72x7bbba","2d1fxf4e01","2d81xae62e","2d9dx94034","2dbfx85780","2dcfx18fde","2e1bxb3547","2e30xe20b6","2e9dx52b3a","2eabx59ecb","2f3cx6ef84","2fc2x7a009","2fd2x2beb6","30b7x73b78","30d1x66ef4","30d4x2141c","30dfx3cc37","30e1x5f3c0","3138x4677d","3143x09fd2","3160xa9b95","3230x14a3e","323dxb68da","32bbx8ac26","32eaxb5a7e","3308x4ec9d","335fxd5859","3411x44387","3418x1df6b","345fx15227","3463xdd806","3466xf4436","346fx73b4e","347ex2b086","3493x04f8b","3497x3cb0c","3566xbbc28","3570xcc1d7","35b9x130cc","3613xb959c","369ex53678","3701xb845b","3734x8b222","374ax0af06","37ffxb895f","3829x89f4b","386cxfbfc2","38ecx183f3","3923xe81cd","3948xf4faa","39edxe9fc4","39fcxb57a2","3a07xe6d4b","3a68xae09e","3a6bx15c40","3a74x0e7d9","3ae3x89d39","3b03x95fc3","3b10xd9ff2","3b8ax935d7","3b8bx92f3b","3c27xff08e","3c3bxf4360","3c5ex599e8","3c7exb0c46","3cebx95558","3d3ax0fe54","3d94xadbf1","3de2xbb79c","3e3axbea8b","3e56x67494","3ee9xa5c22","3f05xb97ec","3f51xd6f40","3f97x71580","3ff0xc31b0","4022xf38ac","4047x6ab24","407fxabacc","40b9x6b7d4","4101x3bb42","418ax7f79b","41bax54311","41bcx044fe","41d9x3fc36","420exc00d3","422exaf12f","4317xf6458","4344xed453","4354x8243f","443dxd2c01","4464xabd41","4473x0630b","44ecx7b500","4545xdd7ef","45e0xfd80d","45fdx11260","45ffx4fd76","46b3x965d3","4721x49845","4750xe3ca5","481ax1b89e","4878x5e54e","4884xb0a3b","4907xe1fd0","49b3x96e7d","4a0cxea2fa","4a1fx07ade","4a68x0243f","4aefx70a73","4b18x55522","4b32x7afeb","4b4exca515","4b50x208bf","4b70x29d7d","4c3exe2d43","4ce6x8c905","4cedxbb993","4d20x93ec4","4d3cxbaf97","4d41x277c4","4d80x4db44","4dd3x28f77","4dd4xa889c","4df6x59677","4e2bxbf82c","4e85x8a7ae","4e8fx980c9","4e9bxc3e5d","4ec6xaa0c9","4eccxf22fb","4f60x48676","4fa3x67e56","5023x431ac","5030x44dd4","5057xf9ce4","5061x05cd8","5075x75d14","5098x2238e","5099x2d88a","50b2xb83b5","51b4xd9d49","522dx4e953","529bx3ba59","52b4xb61bd","5300x01998","5315x7dd7d","5318x63784","53aax1eacc","54c4xa1c26","54d1x542c2","54eaxc7e34","550fx19651","5633x77057","564bx5dbbe","56eex73ecc","56fcx320f1","5749xaa8c1","577bx15fa2","57bcxb96b3","57f9xd4416","580exca18a","5827x7d30b","586dxb2fc9","589bx45fc3","58cfxbc91a","5927x24837","59ccx9a55f","59e0x253f4","5a21xa3255","5a2dx4338f","5a6dxa5479","5a93x1e37e","5ad0xf06d1","5b34x997d0","5be0x66582","5c50x8fef6","5c58x77847","5c88x25d67","5cd4x84d3a","5d2dxa5619","5d32xa4dc2","5df8x4fc11","5e20x51ce6","5e83x0ea11","5ec5xa2c8d","5f56x5ac2b","5f62xf5dd2","5f98xeaef8","6003x7801c","6012xf8e4e","601cxf5347","602fx39691","60bcx729fa","60f3xdda61","60f5xaf886","60f8xd9351","612fx00e73","616bx4dab5","6199xf33a9","61b5x734b6","61bax5226d","61e0xd7949","6255x49cf1","6261xb23f0","6298x7d138","62c7x4a11c","6303x7b43a","6334x0872b","6344xcbc35","6353xfe40b","641ex403eb","646fxb5e89","6476x8e6f8","64a2x96728","64aex0844a","64b9x6def0","6546xb3161","6552x51a75","65eexe0c27","6603x13748","662dx35857","6639xdce29","6695xe42b3","679dx5c27f","67b6x6c48e","67bdx8a0b6","68d8x8fde2","6913x399c5","693fx4f382","6966xf721c","69fexcdcaf","6a03xfa7e0","6a0ex83880","6a59x3734d","6a5bx1a965","6adex1f221","6b27x29f91","6b2ex38bbf","6bdcxd27eb","6c91x26a03","6cf4x17e6b","6d54xb8f01","6d5ax5bef9","6d65x06d5a","6d68xda2f4","6da2x161df","6dbfx58bb3","6dcdxeb1ab","6de0x0d627","6de1x5ee2f","6deexdb22c","6dfexe8042","6e5axb0c5d","6e5cx82a80","6ea6x214e6","6eb1xa986b","6ec0x4b7c0","6ed5xdffa4","6ed5x58c51","6ef2x949b3","6ef7x565a7","6f63xc3815","6ff2x5bdad","7038x66f99","7163xdcbc5","71b9x4872d","71bfx26c1f","71eaxa467d","7208x10566","7224x61e6b","726fx3211d","7289x8501e","72a6x9deed","72a8xa7fe1","72e3x8ceed","7337xd8367","739bx0ec8b","739dx588a5","73d0x0a652","7420xf769e","742ax16264","743ax44510","7453xac8df","745ex441e8","7475x52031","7490xa52cd","74a9xf04a6","74dax7c44f","7503xb1b63","753cx1a5d7","7544x88786","7547x8b532","764bx1790f","764fxed873","76a7x7a3c3","76f2x966fb","7727x1e3dd","7730xdeff2","7775xfd1e4","7786x08df9","77ffxff9c7","7821x9ac2a","784ax2cfb0","7851xece60","7856x7a1f6","787bxeacb7","78a9xba133","7982x755e9","79c1xdfe49","7a97xd489d","7b0fxf54fb","7b13xf39de","7b4exe88a0","7b96x6c0d3","7bb2x8662e","7c8cxed734","7cc7x71616","7d52xc82ae","7d77x275f6","7e9bxe762b","7ee8x2826f","7efcx1ac56","7f5bxa0831","7f5ex66583","7facx1f65b","7fd9x17aa9","7fedx14fe7","8021xc5b70","8074x5d551","80a7xabf2e","8179xa5842","8185x61b24","81f1x52139","826axf3b86","827exf6ce3","8280x85d55","82aex8f2dd","82d4x44cc2","82eax50fe3","8317x35f0f","83c1x1c03e","83d5x82ac4","8451xc786f","8493x7baea","84f2x9b430","853fx9a2e8","8631x93050","871ax18d34","87ccx6e41e","87ccx8fee8","87fex73d87","8868xab40b","8888x82257","88c6xdb3cd","8984x9c189","898bx9fcb2","89ccx73575","8a02x7105b","8a2bx7bbec","8a5dx63952","8ad2x0abfb","8af3x220dd","8affx3fb76","8b54xc7071","8c0axb021e","8ccdx8ee85","8ccdxa8b8c","8ceax75064","8d6exff3e4","8d9dx5b44f","8e63xd72f9","8e78x95f56","8f22x62b2d","8f38x021f3","8fbbxdcdc4","8fc3x6a904","903bx4090a","908cx76540","90c3x698b7","90c8xdab2e","90ebx5dacb","90f6x528b7","9105xa0fd5","9170x778b5","91a8x33144","9317x55e67","9353x6c408","93a0x00190","93b4x2feb9","93bex0fa01","946dxda891","9470x75efd","947dxa1de3","94d1x476e7","95e5x420b7","960ax1a073","9671xfb028","9702x6b277","971ax60f23","9726x12e3d","9769xfc096","97b1xd809f","97e5xd8d4f","9847xdb3ed","98d3xcc726","9906x9ec51","990ax2fcc0","994dxd01e0","997ax42b57","997bx4f5b8","99dcx7c25d","9a0dx7f870","9a2dxbd439","9a58xdd7d5","9b8bx6ebc7","9bbdxb5a32","9bc5xdc2ed","9becx0bdba","9c02xb5b10","9c90x9b486","9c91x45421","9cb7x901ff","9d2ex18693","9da0xd66ca","9df8x849ea","9e03x0d38e","9e13x19979","9e2ax78c2a","9e3ax1e92d","9e6fx7d579","9e7cxc6395","9e9dx4d617","9f37x43076","9f6fx4cd20","9ffdx1546a","a003x1eea9","a027xe0bff","a064xe5ba7","a074x63040","a0a4xeec97","a0c5xf597a","a133x4cbc8","a153x22e87","a25ax128a1","a26cxb65d4","a2e4x5237b","a2f1xdc4e3","a341x66a09","a359xa6f60","a3aaxfaeca","a3dfx7457f","a495xe0087","a4e2x0fa6c","a4edx1e08b","a4f0xa6ba9","a50ax860d8","a51fx139bf","a56exbb9b5","a56ex29015","a571x475af","a5a2xe0259","a5a5x873ee","a5c3xfd7c7","a627x060df","a629x4f3a7","a631xee92f","a74bx567f9","a769x6c32a","a7c8x1e4a5","a7f2x2b919","a801x8f236","a83bxbb179","a871xe97be","a877xf8341","a8a6x87e73","a946x61eeb","a979x5526a","a9a2x81900","a9f4xacd48","ab05xb16e1","ab1exc12c7","ab4cxf9910","ab72xe48c2","ab7dx65cf2","abb0xcb3e8","abc5x9c7f3","ac00x40e9e","ac1ax64534","ac5dxfddc8","acaax24e5f","ad25x06b52","ade9x787c8","ae42x67cd7","aea7x14a73","af01xe7068","af3ex44c0a","af59xcc664","af5ax2b88c","afa7x65a75","afbdxd39bb","b018xcce66","b048x11260","b05cx39329","b0dax401ec","b160x83e0f","b188x5292b","b1ccxc2505","b226x1b629","b25axcb0b8","b27ex20716","b302x609ce","b30ex92a91","b326x8a1b9","b32cxe789f","b339xc3990","b344x2b978","b401xf6222","b43cx5dd07","b44axe7712","b44ax9354d","b44fx4aff9","b53dxb6daa","b582x25b17","b584xab386","b5e9xa6865","b611xda5b2","b61cx0febe","b6ebx03fd4","b700x658a3","b705x23ea1","b7a5x19e68","b7c7xf5a68","b7f5x62157","b828x8cf34","b8cfx4210e","b917xe4ecb","b9d8x77a0f","ba1fx3251d","ba54xfa92a","ba56x64371","ba61xaa6cd","bab4xe2283","bad8xbfc51","bb12xede6d","bb86xfe4da","bba8xb4048","bbb1xe36f2","bbbfxdab45","bc18x02350","bc55x88eb9","bc77xe837c","bc7cx08abb","bca2xa6398","bd25x866ea","bd28x56bef","bd92x72b28","bdd9x33f6a","be46x1ed25","be5fx506f9","be6cxd27e7","bf42x71b75","bf57x999b0","bfc0xbf194","bfd1xe4f42","bfd9x23a5e","c071x0d9c4","c077xae5f5","c0cfx8a0bd","c113xc8491","c1ecxb357c","c20fxaf949","c23ex669b7","c244x1210b","c2a0x5a46c","c327xae073","c3abxd3a25","c3b5x76a10","c3bbxdc1a7","c3d6xe0132","c3fbx41899","c433xfe132","c47bx74aaa","c47fxf5b4b","c488x856db","c4a4x5122b","c500x8a8c7","c542xf0d12","c576x0a0a7","c5bdxdf69b","c5c6x28822","c5f1x928de","c65dxd5cea","c692xe17b9","c71ax394bc","c75cx6aa3d","c75ex83434","c792xf0933","c79ax5043d","c7b5x2f682","c7f3x5f03d","c7f7xbf4d5","c80dxf5e6a","c812xc63db","c831xaecc9","c83ex70b86","c85bx2fd8f","c946x8f3a4","c9ffxfb3ed","cb04x15122","cb60x19541","cb64x14e08","cb69xd5783","cc96xae63c","ccf4xc62be","cd1axc775c","cd4ax7f5c8","ce06xa7332","ce1bxb8ae2","ce43x57f6d","cf04xa2bde","cf6exe9557","cf80xba047","cf92x56af6","cfa7x59ccd","cff0x2a754","d074x90c6f","d091x0ae33","d0a9x8aa71","d0b0xe37dd","d12axc2439","d310x6afb9","d367x6c2e7","d417x495f0","d482x49f09","d491x7c632","d49ax9a57f","d4b4xa4e73","d4c4xabf03","d4f6xec623","d558x8de04","d643xd3bdc","d66dxea8ea","d680xd5549","d682x06933","d6b0xb4ce7","d6e2x7e25b","d72ex75c6b","d75cx2d040","d7a3x0e442","d812xe4b8b","d819x7c02b","d866xe535f","d8b6xd20bb","d923x26832","d950x36fd8","d982x8e79b","d9a8x8bbe0","d9f4xb2945","db22xd9da3","dc3bxbc8a1","dc3cxc5b0d","dc8bx3abd3","dc9dx79ab3","dcabxd1aa7","dd2cx95944","ddadxf990e","ddd9x449ff","ddf3x18dce","de0bx8ff83","de1fx384f8","de81xe6258","dea0xcdfa7","df11x628f0","df2dx28ac4","df36x97f59","df57x1fd2e","df80x84bb6","e093xe1f3a","e0c8x1b01a","e0dbx85689","e0e6x70295","e100xeba0d","e1d3x26485","e21ax04bf6","e254x881d9","e26fx2d1da","e282x29416","e2bfx86324","e2c8x1d80c","e326x3000b","e334x3a258","e389xa0917","e3c8xe7a63","e3d3xd54f3","e3f8xc5bee","e49fxc880a","e4b3x72602","e4c8x3a909","e575xbcb11","e579x2b5bf","e57ax84ec9","e5b5x549d2","e638x2c596","e659xd02bd","e6d7x88e1a","e770xc8636","e79bxfc8e4","e7aex0be7c","e7f9x1848b","e809x47d40","e811x2f632","e878xf8c34","e8a4xdd6aa","e8bdx90219","e8dcx40b28","e8ebx4d9cd","e929x773f3","e98cx3cd70","ea26x2843f","ea35xc7ce8","ea35x61263","ea83xc4f9e","ea9cx39f1a","eaa7xcec74","eae2xf3f23","eb75x9dd72","eb7ax2a4d5","eb9bxddb0e","ecc0xfd317","ece6x991d4","ed0bxc28dd","ed57x6e63a","edfax63a87","ee4axa7e43","eecex912c7","eee0xc78ad","eee9xfe8d6","ef07xac0fe","ef54x7ad47","ef75xa27e8","ef79x9b971","efeax67311","f039x18425","f04axadcf8","f181x38e41","f188x015c0","f1a9xdb63c","f1d0x19bd2","f201x5b8ab","f22bx3a442","f291xe3dad","f2adxeec0c","f34cx5ae8b","f3b7x2b337","f41fxc4cf5","f476x399a4","f537x679a0","f569xc907b","f56exe7670","f572xf9c59","f5abx81053","f68cx9322d","f6c9xda66f","f6dfx4407f","f6ffx551c9","f77ax33e02","f785xaa296","f787x56c10","f79cx58f16","f7b6x853fe","f810xc2a2b","f810xc63cb","f82fxa183b","f831x4a5ff","f83fx5c242","f86bx44163","f90exc7381","f96ax214b4","fa08x5d65d","fab8x9df9a","fabbx83f5d","fad8xc22e3","fae3x895c8","faf5x6637d","fb23xcc182","fb65x43ec8","fb6dxbe0a0","fb71x67bfc","fbedx931be","fcc6xf75b1","fccdx5b906","fd11x9ba43","fe5cx21830","fe66x683ca","fe92x6b385","fedaxab1ec","ff31xb3d04","ff51x93b26","ff6ax9cd97","ffa3xb0499","ffbexb6629","ffedx3b7bb","ffedx71b63"]

let hardcodeNodes2 = null//["1653x16ec1","19f0xd5472","1cf4xde0eb","2a19x5e3b1","32bexf57c0","4995xf8b99","4ecexd6312","5a7fx44c45","68cbx40e22","70b5x9e9ee","726cx7382c","759axd5017","792exda25a","a2a8x6c883","a61ex8efbf","d7ddx789eb","f0ddx1549b","f937x3e4ce","fd6cxea9a4"]

if (useHardcodenodes) {
  numNodes = hardcodeNodes.length
}
if (hardcodeNodes2) {
  numNodes2 = hardcodeNodes2.length
}

// Set debugStartsWith to specify what node will be "our node" in the following calculations
let debugStartsWith = '19ef' // 21f7 851c '8bc4' // '33d7' //'0692' // '23d5' // 'f211' //'147d' // '2054' // '2512'  // '7459' // '5c42' // '37ae' // '37ae' '6eb5' // 97da 5d07 'dc16'  '0683'  'ed93' ac3c 3d28
let debugID = debugStartsWith.slice(0, 4) + '7'.repeat(64 - 4)

// set debugAccount to specify and example address that will get calculations made to it
let debugAccount = 'c69e' + '3'.repeat(60) // 5c43 386e 60b1  60b1 c173
let debugNode = null
// 5c43xba41c account test.. need to expand it.



testLoop()


async function testLoop() {
    //await utils.sleep(30 * 1000)
  let runTimes = []

    for (let i = 0; i < testIterations; i++) {
        testCounter++
        let time = Date.now()
        await runOneTest()
      let elapsed = Date.now() - time
      runTimes.push(elapsed)
        console.log(`Test complete: ${testCounter} --nodes:${numNodes}  elapsed:${elapsed}  --------------------------------------`)

        //await utils.sleep(100000 * 1000)
        numNodes++

    }
  console.log(`Avg run time: ${(runTimes.reduce((p, c) => p + c, 0) / runTimes.length)}`);
}


async function runOneTest() {

    console.log(`Test run: ${testCounter} --nodes:${numNodes}------------------------------------`)

    let nodesPerConsenusGroup = 128
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


    let currentCycleShardDataFake = {}
    let nodeShardData = null
    let ourNode = null
  let randomIndex = Math.floor(Math.random() * activeNodes.length)
  ourNode = activeNodes[randomIndex]
  debugNode = ourNode
    // for (let node of activeNodes) {
    //     if (node.id === debugID) {
    //         ourNode = node
    //         debugNode = node
    //     }
    // }

    if (debugStartsWith != null && ourNode == null) {
        // debugID
        ourNode = { status: 'active', id: debugID }
        debugNode = ourNode
    }

    if (debugStartsWith != null) {

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

        // // generate full data for nodes that store our home partition
        ShardFunctions.computeNodePartitionDataMap(shardGlobals, nodeShardDataMap, nodeShardData.nodeThatStoreOurParitionFull, parititionShardDataMap, activeNodes, true, false)


        // generate lightweight data for all active nodes  (note that last parameter is false to specify the lightweight data)
        let fullDataForDebug = true // Set this to false for performance reasons!!! setting it to true saves us from having to recalculate stuff when we dump logs.
        ShardFunctions.computeNodePartitionDataMap(shardGlobals, nodeShardDataMap, activeNodes, parititionShardDataMap, activeNodes, fullDataForDebug)

        //console.log('storedPartitions' + utils.stringifyReduce(nodeShardData.storedPartitions))

        // calc consensus partitions
        let ourConsensusPartitions = ShardFunctions.getConsenusPartitionList(shardGlobals, nodeShardData)
        //console.log('ourConsensusPartitions ' + utils.stringifyReduce(ourConsensusPartitions) + `  consensusEndPartition: ${nodeShardData.consensusEndPartition} consensusStartPartition ${nodeShardData.consensusStartPartition}`)

        let hash = debugAccount // '0'.repeat(64) // debugAccount

        let extraTests = false
        if(extraTests){
            let closestNodes = getClosestNodes(shardGlobals, parititionShardDataMap, activeNodes, hash, 1)
            // @ts-ignore
            let closestNodes2 = getClosestNodes(shardGlobals, parititionShardDataMap, activeNodes, hash, 2)
            let closestNodes3 = getClosestNodes(shardGlobals, parititionShardDataMap, activeNodes, hash, 300)
            let inDist = isNodeInDistancePartition(shardGlobals, hash, debugID, 2)

            //////////////////////////////////////////////////
            //DATA sync ranges investigation...
            let lowAddressSearch = upscaleAddr("9555x00000", '0')
            let highAddressSearch = upscaleAddr("9d2axfffff", 'f')

            let { dataSourceNode, dataSourceNodes } = getDataSourceNode(currentCycleShardDataFake, lowAddressSearch, highAddressSearch)


            //generte sync ranges
            let rangesToSync = syncRangeCalculations(currentCycleShardDataFake)

            //test if sync ranges can find valid nodes!
            for (let range of rangesToSync) {

                let { dataSourceNode, dataSourceNodes } = getDataSourceNode(currentCycleShardDataFake, range.low, range.high)
                console.log(`dataSorurces  ${dataSourceNodes.length}  `)
                if (dataSourceNodes.length === 0) {
                    console.log(`error dataSorurces  ${dataSourceNodes.length}  `)
                    dataSorurce = getDataSourceNode(currentCycleShardDataFake, range.low, range.high)
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
    }


}
/* eslint-enable */
