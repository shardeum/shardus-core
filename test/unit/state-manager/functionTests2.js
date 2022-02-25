
// @ts-nocheck
/*eslint-disable*/

var fs = require('fs')
var path = require('path')
// const StateManager = require('../../../src/state-manager')
// let stateManager = new StateManager(false)

const ShardFunctions = require('../../../build/src/state-manager/shardFunctions2.js').default

const crypto = require('@shardus/crypto-utils')
const utils = require('../../../build/src/utils')
crypto.init('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')


function getDupes(list) {
    let map = {}
    let dupes = []
    for(let str of list){
        if(map[str] === true){
            dupes.push(str)
        }

        map[str] = true

    }
    return dupes
}


//TEST INPUTS:

//shrd_sync_cycleData blob (the json blob from shrd_sync_cycleData line in playback log) 
let shardDataBlobFile = 'debugInput3.txt'
// paste this list of active nodes from shard summary
let activeListStr = '3.140.198.212] [18.189.194.15] [3.133.138.221] [35.183.25.17] [35.183.199.15] [54.193.19.29] [35.176.200.200] [3.10.209.157] [35.178.13.233] [13.115.245.155] [35.183.148.90] [3.21.244.108] [18.191.154.213] [3.138.181.189] [35.167.90.52] [54.199.213.163] [13.231.60.210] [34.220.162.182] [3.113.25.187] [13.125.198.186] [3.36.109.59] [18.218.10.112] [3.137.169.181] [18.222.115.32] [34.213.106.95] [54.191.121.175] [3.36.85.67] [34.218.239.137] [35.183.136.35] [52.56.183.198] [3.35.231.13] [3.96.197.106] [34.222.119.29] [3.101.62.245] [3.10.142.199] [54.199.206.128] [3.36.106.127] [54.176.136.196] [3.101.129.166] [3.34.95.136] [52.79.160.237] [3.137.160.64] [3.15.208.147] [3.101.76.170] [13.56.160.141] [34.210.232.179] [52.195.3.93] [18.191.171.210] [35.182.189.150] [35.176.188.35] [35.182.241.209] [54.188.10.176] [35.178.187.221] [3.10.20.96] [13.115.124.34] [3.96.216.136] [3.36.58.93] [52.79.159.114] [18.183.149.21] [18.130.189.250] [35.183.69.133] [13.231.5.134] [35.182.133.226] [3.36.60.26] [18.223.211.148'
//Paste this input from cycle.log 
//NODES
//     (delete first and last squar bracket.. sorry, lazy parser)
// byIdOrder: 
let nodebyIDStr = '3.36.60.26:9001-x033,3.21.244.108:9001-x077,54.199.213.163:9001-x084,35.183.136.35:9001-x097,35.167.90.52:9001-x0e9,3.36.111.142:9001-x130,54.193.19.29:9001-x151,18.223.211.148:9001-x16f,54.178.24.36:9001-x18f,34.220.162.182:9001-x1a4,13.125.198.186:9001-x1bc,18.191.171.210:9001-x1bc,54.191.121.175:9001-x21c,18.222.115.32:9001-x2eb,3.36.85.67:9001-x314,35.183.25.17:9001-x31e,34.218.239.137:9001-x32a,18.218.10.112:9001-x363,3.140.198.212:9001-x36b,35.183.148.90:9001-x37e,3.36.99.251:9001-x39d,3.137.169.181:9001-x42b,35.178.249.144:9001-x47d,3.96.216.136:9001-x47e,3.36.124.235:9001-x499,35.176.188.35:9001-x4c3,34.216.191.144:9001-x4cc,3.36.58.93:9001-x512,3.36.109.59:9001-x519,3.15.208.147:9001-x565,3.35.51.131:9001-x664,18.183.149.21:9001-x6bf,13.115.245.155:9001-x6db,52.79.159.114:9001-x6f6,3.10.142.199:9001-x6ff,54.202.74.122:9001-x716,35.178.13.233:9001-x736,3.35.231.13:9001-x779,18.130.189.250:9001-x7ac,3.10.20.96:9001-x7b3,34.210.232.179:9001-x7fe,3.36.106.127:9001-x80c,35.183.69.133:9001-x953,52.79.160.237:9001-x957,3.96.197.106:9001-x95c,3.113.25.187:9001-x9c7,52.195.3.93:9001-x9e6,34.213.106.95:9001-xa23,3.36.103.146:9001-xa53,54.176.136.196:9001-xa56,13.231.5.134:9001-xa5d,3.138.181.189:9001-xa60,13.231.60.210:9001-xa94,18.191.154.213:9001-xad1,54.188.10.176:9001-xad3,35.183.199.15:9001-xadd,18.189.194.15:9001-xb0f,35.178.187.221:9001-xb94,13.115.124.34:9001-xbe0,3.101.129.166:9001-xbf7,3.101.76.170:9001-xc20,35.182.241.209:9001-xd0e,3.8.40.170:9001-xd42,3.137.160.64:9001-xd7a,3.34.95.136:9001-xddd,3.10.209.157:9001-xdfb,35.182.189.150:9001-xe2c,3.101.62.245:9001-xe47,54.199.206.128:9001-xed6,3.133.138.221:9001-xf20,35.182.133.226:9001-xf6b,34.222.119.29:9001-xfb5,18.181.174.14:9001-xfbf,35.176.200.200:9001-xfd7,52.56.183.198:9001-xffa'

let testInput = null
try {
  var localDir = path.resolve('./test/unit/state-manager/')
  var data = fs.readFileSync(path.join(localDir, shardDataBlobFile), 'utf8')
  // console.log(data)

  testInput = JSON.parse(data)
} catch (e) {
  console.log('Error:', e.stack)
}

let output = ''
let nonDupedOutput = ''
let seen = {}
let dupes = []
let count

// print out active nodes in a format that is useable by shardvalues2.js hardcodeNodes
// also figure out if there are dupes in the active nodes list.
for(let node of testInput.activeNodes){
    output += utils.stringifyReduce(node.id) + ','    
    if(seen[node.id] === true){
        dupes.push(utils.stringifyReduce(node.id))
        continue
    }
    nonDupedOutput += utils.stringifyReduce(node.id) + ','
    seen[node.id] = true
}

console.log(`[${output}]`)

let activeList = activeListStr.split('] [')

let activeListDupes = getDupes(activeList)
console.log('activeListDupes:' + activeListDupes.join())

let nodebyID = nodebyIDStr.split(',')
let ipToID = {}
for(let str of nodebyID){
    let pair = str.split('-x')
    ipToID[pair[0]] = pair[1]
}

console.log(`blob.activeNodes.length: ${testInput.activeNodes.length} dupes.length: ${dupes.length} activeList.length:${activeList.length} nodebyID.length:${nodebyID.length}`)

//from other debugging we know:
//13.56.160.141 => 9105x44345:9001 
// HACK TEST DATA HERE...
// this test was missing a look up for this ip..
// ipToID['13.56.160.141:9001'] = '910'

let activeByAddr = ''
let activeByAddrList = []
for(let ip of activeList){
    let tag = ipToID[ip + ':9001']
    if(tag === undefined){
        console.log(`no lookup found for ${ip}`) //can hard code a fix above this in (see above comments)
    }
    activeByAddrList.push( `"${ipToID[ip + ':9001']}0x0000"` )
}
activeByAddrList.sort()

let activeListDupes2 = getDupes(activeByAddrList)

//translates the active nodes list in the cycle log to a list by address.
//THIS IS Usefull because it gives you a list that you can feed into shardvalues2.js hardcodeNodes and rerun extensive sharding calculations
//console.log(`activeByAddr: [${activeByAddrList.join()}]`)
console.log(`activeByAddr(short): [${activeByAddrList.map((n) => n.substr(0,5)).join()}]`)

//dupes found in the address list.
console.log(`activeListDupes2: [${activeListDupes2.join()}]`)


//todo can easily add more stuff here to check if nodes are in one list but not another.etc.