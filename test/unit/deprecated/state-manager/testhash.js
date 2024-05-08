/* eslint-disable */
//  const StateManager = require('../../../src/state-manager')

var fs = require('fs')
var path = require('path')
const crypto = require('@shardus/crypto-utils')
const utils = require('../../../build/src/utils')
const ShardFunctions = require('../../../build/src/state-manager/shardFunctions.js').default
// const Profiler = require('../../../src/utils/profiler.js')
// let profiler = new Profiler()
// const utils = require('../../../utils')

// crypto('64f152869ca2d473e4ba64ab53f49ccdb2edae22da192c126850970e788af347')

crypto('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')

// 9004
// let tx1 = '{"from":"cc7255420bb071f92d14b5070c08a3196aa025f243edd51a8d09e9a853d49562","issue":"68733e8c523de80def9c8bfbdc174381eff434fc8d5a2f73f26ff0584c9c011c","nodeId":"6c07e7c7f8804fe0cfba357719dd8e767ea93f6a2ccb2c338d88a1ef1787f819","proposal":"9cc61afb96a7e7c2091166f0533f96cffb024e7fb9cebb97e0fbfb41e508aecd","timestamp":1578353331003,"to":"0000000000000000000000000000000000000000000000000000000000000000","type":"issue"}'

// let tx2 = '{"from":"cc7255420bb071f92d14b5070c08a3196aa025f243edd51a8d09e9a853d49562","issue":"68733e8c523de80def9c8bfbdc174381eff434fc8d5a2f73f26ff0584c9c011c","nodeId":"6c07e7c7f8804fe0cfba357719dd8e767ea93f6a2ccb2c338d88a1ef1787f819","proposal":"9cc61afb96a7e7c2091166f0533f96cffb024e7fb9cebb97e0fbfb41e508aecd","timestamp":1578353331003,"to":"0000000000000000000000000000000000000000000000000000000000000000","type":"issue"}'

// let r1 = '{"sign":{"owner":"cc7255420bb071f92d14b5070c08a3196aa025f243edd51a8d09e9a853d49562","sig":"958b27bb477f2110f83bcbb365572f874e3e9f71374e3f8b3c243ca0066367d06bfb0b9eaf757f4037f3db5fd65b69233e0040110ab2c80ddb17508c1bfb9f091227b480aa99955eb58894dbbef0dcf1635fa0baa5a5f2fd7b0ce306cfe5a9fe"},"stateId":null,"targetStateId":null,"time":1578353331006,"txHash":"f686d04c01a20374f28fa66c89ef6c7b7bc6c53d844a25318f1a1350a12616f2"}'

// console.log(crypto.hash(tx1))

// let tx3 = '{"from":"cc7255420bb071f92d14b5070c08a3196aa025f243edd51a8d09e9a853d49562","issue":"68733e8c523de80def9c8bfbdc174381eff434fc8d5a2f73f26ff0584c9c011c","nodeId":"6c07e7c7f8804fe0cfba357719dd8e767ea93f6a2ccb2c338d88a1ef1787f819","proposal":"9cc61afb96a7e7c2091166f0533f96cffb024e7fb9cebb97e0fbfb41e508aecd","timestamp":1578353331003,"to":"0000000000000000000000000000000000000000000000000000000000000000","type":"issue"}'

// let tx1 = '{"from":"1d488e0b637df2462b54af4b5ae1e0ebde02e0745d50941d47c8869a6abe2755","issue":"6f1513715917f7e1a33714f4b8104660965a965f67b30f7ba5050b26423d77fa","parameters":{"devProposalFee":20,"maintenanceFee":0.01,"maintenanceInterval":60000,"nodePenalty":100,"nodeRewardAmount":1000,"nodeRewardInterval":120000,"proposalFee":500,"stakeRequired":500,"transactionFee":0},"proposal":"ea0ae7728c74ef8be5f38d6353a189d80f9270303d9b958941628b32637d43d8","sign":{"owner":"1d488e0b637df2462b54af4b5ae1e0ebde02e0745d50941d47c8869a6abe2755","sig":"39b279bc618fe76110a62d4700dec5f550712c4f807f6374c6cd12e9f0f418daf288b79e191d1cef8312f8a738517435997af59ab233f029668051dda1e4750707a4ac17de1afdac858fe5d131b27df34268cf2d899033469c76a761168a803f"},"timestamp":1578420963645,"type":"proposal"}'

// // accepted TXs  f686d04c01a20374f28fa66c89ef6c7b7bc6c53d844a25318f1a1350a12616f2 ???

// console.log(crypto.hashObj(JSON.parse(tx1)))

// let tx2 = '{"from":"1d488e0b637df2462b54af4b5ae1e0ebde02e0745d50941d47c8869a6abe2755","issue":"6f1513715917f7e1a33714f4b8104660965a965f67b30f7ba5050b26423d77fa","parameters":{"devProposalFee":20,"maintenanceFee":0.01,"maintenanceInterval":60000,"nodePenalty":100,"nodeRewardAmount":1000,"nodeRewardInterval":120000,"proposalFee":500,"stakeRequired":500,"transactionFee":0},"proposal":"ea0ae7728c74ef8be5f38d6353a189d80f9270303d9b958941628b32637d43d8","sign":{"owner":"1d488e0b637df2462b54af4b5ae1e0ebde02e0745d50941d47c8869a6abe2755","sig":"39b279bc618fe76110a62d4700dec5f550712c4f807f6374c6cd12e9f0f418daf288b79e191d1cef8312f8a738517435997af59ab233f029668051dda1e4750707a4ac17de1afdac858fe5d131b27df34268cf2d899033469c76a761168a803f"},"timestamp":1578420963645,"type":"proposal"}'

// console.log(crypto.hashObj(JSON.parse(tx2)))

// let tx3 = '{"from":"1d488e0b637df2462b54af4b5ae1e0ebde02e0745d50941d47c8869a6abe2755","issue":"6f1513715917f7e1a33714f4b8104660965a965f67b30f7ba5050b26423d77fa","parameters":{"devProposalFee":20,"maintenanceFee":0.01,"maintenanceInterval":60000,"nodePenalty":100,"nodeRewardAmount":1000,"nodeRewardInterval":120000,"proposalFee":500,"stakeRequired":500,"transactionFee":0},"proposal":"ea0ae7728c74ef8be5f38d6353a189d80f9270303d9b958941628b32637d43d8","sign":{"owner":"1d488e0b637df2462b54af4b5ae1e0ebde02e0745d50941d47c8869a6abe2755","sig":"39b279bc618fe76110a62d4700dec5f550712c4f807f6374c6cd12e9f0f418daf288b79e191d1cef8312f8a738517435997af59ab233f029668051dda1e4750707a4ac17de1afdac858fe5d131b27df34268cf2d899033469c76a761168a803f"},"timestamp":1578420963645,"type":"proposal"}'

// console.log(crypto.hashObj(JSON.parse(tx3)))

// // let account1 = '{"approve":0,"hash":"99d4x6cc34","id":"56fe2d4940725c1fe606e34a358efb2146e5e5e263336432e7ceae7becaf66e2","reject":0,"timestamp":0,"totalVotes":0}'
// let account1 = '{"approve":0,"hash":"","id":"56fe2d4940725c1fe606e34a358efb2146e5e5e263336432e7ceae7becaf66e2","reject":0,"timestamp":0,"totalVotes":0}'
// // 654ba906420851f9b71012c4b92c4d0e98fdd30e8417d5f6a46b7e28ebc2ac38
// console.log(crypto.hashObj(JSON.parse(account1)))

// console.log(crypto.hashObj(JSON.parse(tx3)))

// let keyString = '["cc72x49562","000000000","6873xc011c","9cc6x8aecd"]'
// let allKeys = JSON.parse(keyString)
// let keyHash = {}
// for (let key of allKeys) {
//   keyHash[key] = true
// }

// let keys = Object.keys(keyHash)

// console.log(utils.stringifyReduce(keys))

// let tx4 = '{"amount":1,"from":"0000000000000000000000000000000000000000000000000000000000000000","sign":{"owner":"4d294ca759148f82437d6b88cf82e17d68ea6010c7824139bc2fcd65db4a4684","sig":"14d757625fb406af3463e2105768a8bf261a9c9855c2f01b1d3b6a58817a11d300a4b0101a85c462ddac22e2aa57fac2f834f9fb6f73b1ffb1bdcf3023fa7c0b68d996c3154d7743559ef4fd8aa693e3e333a3765f7a684df34be446da223145"},"timestamp":1579040886726,"to":"4d294ca759148f82437d6b88cf82e17d68ea6010c7824139bc2fcd65db4a4684","type":"create"}'
// console.log(crypto.hashObj(JSON.parse(tx4)))

// let tx4b = '{"amount":1,"from":"0000000000000000000000000000000000000000000000000000000000000000","timestamp":1579040886726,"to":"4d294ca759148f82437d6b88cf82e17d68ea6010c7824139bc2fcd65db4a4684","type":"create"}'
// console.log(crypto.hashObj(JSON.parse(tx4b)))

// let testcode1 = '299022' // 'b667d2ec3caec2d0506428e4b7499b9a10aa09239e67ac880785a9a72997600c'

// let testcode2 = '948699'
// console.log(crypto.hash((testcode1)))
// console.log(crypto.hash((testcode2)))

// let test1 = {asdf:2, testM:new Map()}
// test1.testM.set('sadf', {asdf:22})
// test1.testM.set('saddf', 33)
// let serialized1 = utils.stringifyReduce(test1)
// console.log( serialized1)
// let test2 = JSON.parse(serialized1, utils.reviver)
// return

let str1 = `[
  "6b88x860f7",
  null,
  "0d2axf5a72",
  null,
  "78c1x5116e",
  null,
  null,
  "cd35x1de41",
  null,
  null,
  null,
  "285bxd1d25",
  null,
  "d90dx98d8e",
  null,
  "a52bxac487"
]`

//let accTest1obj = JSON.parse(str1)

//TEST account hash:
let accTest1str =
  '{"current":{"defaultToll":1,"description":"These are the initial network parameters liberdus started with","devProposalFee":50,"faucetAmount":10,"maintenanceFee":0,"maintenanceInterval":86400000,"nodePenalty":10,"nodeRewardAmount":1,"nodeRewardInterval":3600000,"proposalFee":50,"stakeRequired":5,"title":"Initial parameters","transactionFee":0.001},"devIssue":1,"devWindows":{"devApplyWindow":[1595874113020,1596046943020],"devGraceWindow":[1595787683020,1595874113020],"devProposalWindow":[1595442023020,1595528453020],"devVotingWindow":[1595528453020,1595787683020]},"developerFund":[],"hash":"a451c379443deac8e1376254b433ec88c4a20c9d6b35ce6cccefafccf01cbbec","id":"0000000000000000000000000000000000000000000000000000000000000000","issue":1,"next":{},"nextDevWindows":{},"nextDeveloperFund":[],"nextWindows":{},"timestamp":1595442023020,"windows":{"applyWindow":[1595874113020,1596046943020],"graceWindow":[1595787683020,1595874113020],"proposalWindow":[1595442023020,1595528453020],"votingWindow":[1595528453020,1595787683020]}}'
let accTest1obj = JSON.parse(accTest1str, utils.reviver)

let accTest1OldHash = accTest1obj.hash
accTest1obj.hash = ''
let accTest1Hash = crypto.hashObj(accTest1obj)

console.log(`accTest acc.hash=${accTest1OldHash} crypto.hashObj = ${accTest1Hash}`)

return //early

function testParse(dir, filename) {
  let testInput = null
  try {
    var localDir = path.resolve(dir) // './test/unit/state-manager/')
    var data = fs.readFileSync(path.join(localDir, filename), 'utf8')
    // console.log(data)

    testInput = JSON.parse(data, utils.reviver)
    return testInput
  } catch (e) {
    console.log('Error:', e.stack)
  }
}

let testInput = testParse('../liberdus-server/instances12/', 'shardCalcs2.txt')

let debugAccount = '38ab' + '3'.repeat(60)

testInput.parititionShardDataMap = new Map()
testInput.nodeShardDataMap = new Map()
ShardFunctions.computePartitionShardDataMap(
  testInput.shardGlobals,
  testInput.parititionShardDataMap,
  0,
  testInput.shardGlobals.numPartitions
)
// generate limited data for all nodes data for all nodes.
ShardFunctions.computeNodePartitionDataMap(
  testInput.shardGlobals,
  testInput.nodeShardDataMap,
  testInput.activeNodes,
  testInput.parititionShardDataMap,
  testInput.activeNodes,
  true
)

let homeNode = ShardFunctions.findHomeNode(
  testInput.shardGlobals,
  debugAccount,
  testInput.parititionShardDataMap
)

console.log('done')

// keep this
