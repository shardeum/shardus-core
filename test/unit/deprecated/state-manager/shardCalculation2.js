/* eslint-disable */

const ShardFunctions = require('../../../build/src/state-manager/shardFunctions2.js').default

const crypto = require('@shardus/crypto-utils')
const utils = require('../../../build/src/utils')
crypto.init('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')

// const Profiler = require('../../../src/utils/profiler.js')
// let profiler = new Profiler()

let maxLogs = 100

let errorsLogged = 0
function logErrorLimited(msg) {
  errorsLogged++
  if (maxLogs > 0) {
    console.log(msg)
  }
  maxLogs--
}

let nodesPerConsenusGroup = 3

function testPartitionMath1_old(numNodes, debugIndex) {
  let shardGlobals = ShardFunctions.calculateShardGlobals(numNodes, nodesPerConsenusGroup)

  for (let i = 0; i < numNodes; i++) {
    let partitionStart = i

    if (debugIndex === i) {
      logErrorLimited('debug here')
    }

    let addressRange = ShardFunctions.partitionToAddressRange2(shardGlobals, partitionStart)

    let lowResult = ShardFunctions.addressToPartition(shardGlobals, addressRange.low)
    let highResult = ShardFunctions.addressToPartition(shardGlobals, addressRange.high)

    if (partitionStart !== lowResult.homePartition) {
      logErrorLimited(`failed partition ${partitionStart} low result: ${lowResult.homePartition}`)
    }
  }
  if (errorsLogged > 0) {
    console.log(`A num nodes: ${numNodes} complete total Errors: ${errorsLogged}`)
  }
}

function testPartitionMath1_new(numNodes, debugIndex) {
  let shardGlobals = ShardFunctions.calculateShardGlobals(numNodes, nodesPerConsenusGroup)

  let nextAddress = null
  for (let i = 0; i < numNodes; i++) {
    let partitionStart = i

    if (debugIndex === i) {
      logErrorLimited('debug here')
    }

    let addressRange = ShardFunctions.partitionToAddressRange2(shardGlobals, partitionStart)

    let lowResult = ShardFunctions.addressToPartition(shardGlobals, addressRange.low)
    let highResult = ShardFunctions.addressToPartition(shardGlobals, addressRange.high)

    let { address1, address2 } = ShardFunctions.getNextAdjacentAddresses(addressRange.high)

    //logErrorLimited(`info i:${i}/${numNodes} ${utils.stringifyReduce(addressRange.low)} hi ${utils.stringifyReduce(addressRange.high)}`)
    //logErrorLimited(`info i:${i}/${numNodes} ${(addressRange.low)} hi ${(addressRange.high)}`)

    if (partitionStart !== lowResult.homePartition) {
      logErrorLimited(`failed partition ${partitionStart} low result: ${lowResult.homePartition}`)
    }

    // not sure how this was ever a good test.
    // if(highResult.homePartition !== addressRange.partitionEnd){
    //   logErrorLimited(`failed partition ${addressRange.partitionEnd} high result: ${highResult.homePartition}`)
    // }

    if (partitionStart !== highResult.homePartition) {
      logErrorLimited(
        `failed partition ${addressRange.partitionEnd} high result: ${highResult.homePartition}`
      )
    }

    if (nextAddress != null && nextAddress !== addressRange.low) {
      logErrorLimited(`failed getNextAdjacentAddresses ${nextAddress} addressRange.low: ${addressRange.low}`)
    }
    nextAddress = address2
  }
  if (errorsLogged > 0) {
    console.log(`B num nodes: ${numNodes} complete total Errors: ${errorsLogged}`)
  }
}

function computePartitionShardDataMap(shardGlobals, partitionStart, partitionsToScan) {
  let partitionIndex = partitionStart
  let numPartitions = shardGlobals.numPartitions
  for (let i = 0; i < partitionsToScan; ++i) {
    if (partitionIndex >= numPartitions) {
      partitionIndex = 0
    }
    let fpAdressCenter = (i + 0.5) / numPartitions
    let addressPrefix = Math.floor(fpAdressCenter * 0xffffffff)

    let addressPrefixHex = ShardFunctions.leadZeros8(addressPrefix.toString(16))
    let address = addressPrefixHex + '7' + 'f'.repeat(55) // 55 + 1 + 8 = 64

    let shardinfo = ShardFunctions.calculateShardValues(shardGlobals, address)
    //parititionShardDataMap.set(i, shardinfo)
    // increment index:
    let { homePartition, addressNum } = ShardFunctions.addressToPartition(shardGlobals, address)

    if (homePartition !== i) {
      logErrorLimited(`failed computePartitionShardDataMap ${homePartition} != ${i}`)
      return
    }

    partitionIndex++
    if (partitionIndex === partitionStart) {
      break // we looped
    }
  }
}

console.log(`--------unit test a hacked computePartitionShardDataMap--------------`)
for (let i = 1; i < 1000; i++) {
  let numParitions = i
  let shardGlobals = ShardFunctions.calculateShardGlobals(numParitions, nodesPerConsenusGroup)
  computePartitionShardDataMap(shardGlobals, 0, numParitions)
}

//testPartitionMath1_new(10)

let maxNodesToTest = 100

// test node counts 1 through maxNodesToTest node networks

// console.log(`--------Old math--------------`)
// // Old math
// for(let i=1; i<maxNodesToTest; i++){
//   errorsLogged=0
//   testPartitionMath1_old(i)
// }
console.log(`--------New math--------------`)
// New math
for (let i = 1; i < maxNodesToTest; i++) {
  errorsLogged = 0
  testPartitionMath1_new(i)
}

//testPartitionMath1_new(10)

//testPartitionMath1_B(i)

console.log(`complete`)

/* eslint-enable */
