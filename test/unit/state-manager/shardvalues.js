const StateManager = require('../../../src/state-manager')
const crypto = require('shardus-crypto-utils')
const utils = require('../../../src/utils')

// generate a sorted list of nodes
function generateNodes (count) {
  let nodeList = []
  for (let i = 0; i < count; ++i) {
    let newNode = { status: 'active' }
    newNode.id = crypto.randomBytes()
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

// test 1
for (let i = 0; i < 20; i++) {
  let numNodes = 5000
  let nodesInConsensusGroup = 10
  let nodeList1 = generateNodes(numNodes - 1)
  let ourId = 'deadbeef' + '3'.repeat(56)
  let ourNode = { id: ourId, status: 'active' }
  nodeList1.push(ourNode)
  nodeList1.sort(function (a, b) { return a.id === b.id ? 0 : a.id < b.id ? -1 : 1 })

  let shardInfo = StateManager.calculateShardValues(numNodes, nodesInConsensusGroup, ourId)

  let exclude = [] // [ourNode.id]
  let nodeInRange = StateManager.getNodesThatCoverRange(shardInfo.homeRange.low, shardInfo.homeRange.high, exclude, nodeList1, shardInfo.lookRange, shardInfo.numPartitions)

  let ourNodeIndex = nodeList1.findIndex(function (node) { return node.id === ourId })

  let nodeInRange2 = StateManager.getNeigborNodesInRange(ourNodeIndex, nodesInConsensusGroup, exclude, nodeList1)

  //   if (nodeInRange2.length !== 10) {
  //     StateManager.getNeigborNodesInRange(shardInfo.homePartition, nodesInConsensusGroup, [ourNode.id], nodeList1)
  //   }

  console.log(`our index in the node list: ${ourNodeIndex}  test number ${i}`)
  //   console.log(` all nodes. len: ${nodeList1.length}  nodes: ${utils.stringifyReduce(nodeList1)}`)
  //   console.log(` nodes that see our home partition len: ${nodeInRange.length}  nodes: ${utils.stringifyReduce(nodeInRange)}`)
  //   console.log(` nodes in our consensus:  ${nodeInRange2.length}  nodes: ${utils.stringifyReduce(nodeInRange2)}`)

  let nodesOutOfCoverage = findBnotInA(nodeInRange, nodeInRange2)
  if (nodesOutOfCoverage.length > 0) {
    console.log(` shardInfo: ${JSON.stringify(shardInfo)}`)
    // console.log(` all nodes. len: ${nodeList1.length}  nodes: ${utils.stringifyReduce(nodeList1)}`)
    console.log(` nodes that see our home partition len: ${nodeInRange.length}  nodes: ${utils.stringifyReduce(nodeInRange)}`)
    console.log(` nodes in our consensus:  ${nodeInRange2.length}  nodes: ${utils.stringifyReduce(nodeInRange2)}`)

    console.log(` ERROR some nodes in consensus not covered by partition:  ${nodesOutOfCoverage.length}  nodes: ${utils.stringifyReduce(nodesOutOfCoverage)}`)
    break
  }
}

// StateManager.calculateShardValues(20, 30, 'd011ffff' + '3'.repeat(52))
