/* eslint-disable */
// const StateManager = require('../../../src/state-manager')
//const ShardFunctions = require('../../../src/state-manager/shardFunctions.js')
const ShardFunctions = require('../../../build/src/state-manager/shardFunctions2.js').default
// import {ShardGlobals,ShardInfo,WrappableParitionRange,NodeShardData,AddressRange, HomeNodeSummary,ParititionShardDataMap,NodeShardDataMap,MergeResults,BasicAddressRange} from  './shardFunctionTypes'
// import ShardFunctions from './shardFunctions.js'

const crypto = require('@shardus/crypto-utils')
const utils = require('../../../build/src/utils')
crypto('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')

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
    // if(partitionStart !== highResult.homePartition){
    //   logErrorLimited(`failed partition ${partitionStart} high result: ${highResult.homePartition}`)
    // }
    // if(highResult.homePartition !== addressRange.partitionEnd){
    //   logErrorLimited(`failed partition ${addressRange.partitionEnd} high result: ${highResult.homePartition}`)
    // }
  }
  if (errorsLogged > 0) {
    console.log(`A num nodes: ${numNodes} complete total Errors: ${errorsLogged}`)
  }
}

function testPartitionMath1_new(numNodes, debugIndex) {
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
    // if(partitionStart !== highResult.homePartition){
    //   logErrorLimited(`failed partition ${partitionStart} high result: ${highResult.homePartition}`)
    // }
    if (highResult.homePartition !== addressRange.partitionEnd) {
      logErrorLimited(
        `failed partition ${addressRange.partitionEnd} high result: ${highResult.homePartition}`
      )
    }
  }
  if (errorsLogged > 0) {
    console.log(`B num nodes: ${numNodes} complete total Errors: ${errorsLogged}`)
  }
}

// testPartitionMath1_B(1111)

let maxNodesToTest = 3000

// test node counts 1 through maxNodesToTest node networks

// console.log(`--------Old math--------------`)
// // Old math
// for(let i=1; i<maxNodesToTest; i++){
//   errorsLogged=0
//   testPartitionMath1_old(i)
// }

testPartitionMath1_new(10)

// console.log(`--------New math--------------`)
// // New math
// for(let i=1; i < maxNodesToTest; i++){
//   errorsLogged=0
//   testPartitionMath1_new(i)
// }

//testPartitionMath1_B(i)

console.log(`complete`)

/* eslint-enable */
