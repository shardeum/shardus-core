const test = require('tap').test
const path = require('path')
const fs = require('fs')

const Logger = require('../../../src/logger')
const Storage = require('../../../src/storage')
const Crypto = require('../../../src/crypto/index')
const P2PState = require('../../../src/p2p/p2p-state')

const { clearTestDb, createTestDb } = require('../../includes/utils-storage')

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../config/server.json')))
config.cycleDuration = 10
let logger = new Logger(path.resolve('./'), config.log)
let confStorage = module.require(`../../../config/storage.json`)
let storage, p2pState
createTestDb(confStorage)

storage = new Storage(
  logger,
  '.',
  { confFile: './config/storage.json' }
)
let crypto = new Crypto(logger, storage)

test('Testing constructor P2PState', async t => {
  p2pState = new P2PState(config, logger, storage, crypto)
  await storage.init()
  await p2pState.init()

  await p2pState.storage.init()
  await p2pState.crypto.init()
  t.equal(p2pState instanceof P2PState, true, 'should instanciate the object correctly')
})

test('Testing _isKnownNode and _areEquivalentNodes method', async t => {
  await p2pState.clear()
  let key = p2pState.crypto._generateKeypair()
  let address = key.publicKey
  let node = {
    id: address,
    publicKey: address,
    cycleJoined: '0'.repeat(64),
    internalIp: '127.0.0.1',
    externalIp: '127.0.0.1',
    internalPort: 9001,
    externalPort: 9001,
    joinRequestTimestamp: Date.now(),
    address: address,
    status: 'pending'
  }
  let secondNode = {
    ...node,
    internalIp: '127.0.0.2',
    externalIp: '127.0.0.2',
    internalPort: 9002,
    externalPort: 9002
  }
  await p2pState.addNode(node)
  t.equal(p2pState._isKnownNode(node), true, 'Should return true if a node is known by server')
  // t.equal(p2pState._areEquivalentNodes(node, node), true, 'Should return true if two nodes are equivalent')
  t.equal(p2pState._areEquivalentNodes(node, secondNode), false, 'Should return false if two nodes are not equivalent')
  t.end()
})

test('Testing getNode and getAllNodes method', async t => {
  await p2pState.clear()
  let keys = []
  let nodes = []
  for (let i = 0; i < 3; i++) {
    let key = p2pState.crypto._generateKeypair()
    keys.push(key)
    nodes.push({
      id: key.publicKey,
      publicKey: key.publicKey,
      cycleJoined: '0'.repeat(64),
      internalIp: '127.0.0.1',
      externalIp: '127.0.0.1',
      internalPort: 9002 + i,
      externalPort: 9002 + i,
      joinRequestTimestamp: Date.now(),
      address: key.publicKey,
      status: 'pending'
    })
  }
  await p2pState.addNodes(nodes)
  t.deepEqual(p2pState.getNode(nodes[0].id), nodes[0], 'Should return inserted node from getNode method')
  t.deepEqual(p2pState.getAllNodes(), nodes, 'Should return all nodes from getAllNodes method')
  t.end()
})

test('Testing _setNodeStatus, getNodeStatus and _updateNodeStatus methods', async t => {
  await p2pState.clear()
  let key = p2pState.crypto._generateKeypair()
  let node = {
    id: key.publicKey,
    publicKey: key.publicKey,
    cycleJoined: '0'.repeat(64),
    internalIp: '127.0.0.1',
    externalIp: '127.0.0.1',
    internalPort: 9002,
    externalPort: 9002,
    joinRequestTimestamp: Date.now(),
    address: key.publicKey,
    status: 'pending'
  }
  p2pState.addNode(node)
  t.equal(await p2pState._setNodeStatus('0'.repeat(64), 'syncing'), false, 'Should return false if node ID is not found')
  t.equal(await p2pState._setNodeStatus(node.id, 'syncing'), true, 'Should successfully set the node status to syncing')
  t.equal(p2pState.getNodeStatus(node.id), 'syncing', 'Should set the node status to syncing and retrieve the status')
  t.equal(await p2pState._updateNodeStatus(node, 'active'), true, 'Should successfully set the node status to active')
  t.equal(p2pState.getNodeStatus(node.id), 'active', 'Should set the node status to active and retrieve the status')
  let nodesInDb = await p2pState.storage.listNodes()
  t.equal(nodesInDb[0].status, 'active', 'Should update the node status in database')
  if (confStorage) {
    confStorage.options.storage = 'db/db.sqlite'
    fs.writeFileSync(path.join(__dirname, `../../../config/storage.json`), JSON.stringify(confStorage, null, 2))
    clearTestDb()
  }
  t.end()
})
