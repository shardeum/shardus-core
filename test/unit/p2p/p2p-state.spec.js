const test = require('tap').test
const path = require('path')
const fs = require('fs')

const Logger = require('../../../src/logger')
const Storage = require('../../../src/storage')
const Crypto = require('../../../src/crypto/index')
const P2PState = require('../../../src/p2p/p2p-state')

const { clearTestDb, createTestDb } = require('../../includes/utils-storage')
const { sleep } = require('../../../src/utils')
const { isValidHex } = require('../../includes/utils')
const { readLogFile } = require('../../includes/utils-log')

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../config/server.json')))
config.cycleDuration = 10
let logger = new Logger(path.resolve('./'), config.log)
let confStorage = module.require(`../../../config/storage.json`)
let storage, p2pState
// let newConfStorage = createTestDb(confStorage)
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

test('Testing addJoinRequest, getCycleInfo and clear methods', { timeout: 100000 }, async t => {
  let keys = []
  let joinArray = []
  let numberOfJoinRequest = 10
  // Testing addJoinRequest and getLastJoined
  // {
  p2pState.startCycles()
  // fill the array of keypair
  for (let i = 0; i < numberOfJoinRequest; i++) {
    keys.push(p2pState.crypto._generateKeypair())
    joinArray.push({
      publicKey: keys[i].publicKey,
      internalIp: '127.0.0.1',
      internalPort: 10000 + i,
      externalIp: '127.0.0.1',
      externalPort: 10000 + i,
      joinRequestTimestamp: Date.now(),
      address: keys[i].publicKey
    })
    // add each node created
    p2pState.addJoinRequest({ nodeInfo: joinArray[i] })
  }
  // await the finishing phase
  await sleep((Math.ceil(config.cycleDuration * 0.4) * 1000))
  let res = p2pState.getCycleInfo()
  for (let i = 0; i < numberOfJoinRequest; i++) {
    t.equal(joinArray[i].address, res.joined[i], 'Each adress should be equal')
  }
  // testing getCycle() method
  {
    await sleep((Math.ceil(config.cycleDuration * 0.65) * 1000))
    p2pState.stopCycles()
    await sleep((Math.ceil(config.cycleDuration) * 1000))
    let res = p2pState.getCycles(5)
    t.equal(Array.isArray(res), true, 'Should return an array with this method')
    t.equal(res.length, 2, 'Should have 2 cycles generated with the awaited time')
    t.equal(res[0].previous, '0'.repeat(64), 'the first cycle should point to 000...')
    const cycle0 = Object.assign({}, res[0])
    t.equal(res[1].previous, cycle0.marker, 'the 2th cycle should point correctly to the first cycle hash')
  }
  // testing clear() method
  {
    await p2pState.clear()
    const cycleInfo = p2pState.getCycleInfo()
    const emptyNodelist = {
      ordered: [],
      current: {},
      active: {},
      syncing: {},
      pending: {}
    }
    t.equal(cycleInfo.previous, '0'.repeat(64), 'the first cycle should point to 000...')
    t.equal(cycleInfo.counter, 0, 'Should reset cycle counter to zero')
    t.equal(cycleInfo.joined.length, 0, 'Joined length should be zero')
    t.equal(cycleInfo.start, null, 'Should reset start to null')
    t.equal(cycleInfo.duration, null, 'Should reset duration to null')
    t.equal(cycleInfo.certificate, null, 'Should reset certificate to null')
    t.equal(p2pState.cycles.length, 0, 'Cycles length should be zero')
    t.deepEqual(p2pState.nodes, emptyNodelist, 'Should reset the nodes')
  }
  t.end()
})

test('Testing addNodes method', async t => {
  let key = p2pState.crypto._generateKeypair()
  let address = key.publicKey
  let validNode = {
    internalIp: '127.0.0.1',
    internalPort: 9001,
    externalIp: '127.0.0.1',
    externalPort: 9001,
    joinRequestTimestamp: 1543041904826,
    address: address,
    id: address,
    status: 'pending'
  }
  let invalidNode = { ...validNode, status: null }

  await p2pState.addNode(validNode)
  let addedNodes = await p2pState.storage.listNodes()

  t.deepEqual(p2pState.nodes.pending[address], validNode, 'Should add node to spcified list')
  t.deepEqual(p2pState.nodes.current[address], validNode, 'Should add node to current list')
  t.equal(addedNodes[0].id, address, 'Should store node in database')

  try {
    await p2pState.addNode(invalidNode)
    t.fail('Should throw an error when invalid node is provided')
  } catch (e) {
    t.pass('Should throw an error when invalid node is provided')
  }
  t.end()
})

test('Testing _addPendingNode, _addJoiningNodes and _acceptNodes methods', async t => {
  let key = p2pState.crypto._generateKeypair()
  let node = {
    publicKey: key.publicKey,
    internalIp: '127.0.0.1',
    internalPort: 10000,
    externalIp: '127.0.0.1',
    externalPort: 10000,
    joinRequestTimestamp: Date.now(),
    address: key.publicKey
  }
  // testing _addPendingNode
  p2pState._addPendingNode(node)
  t.deepEqual(p2pState.nodes.pending[key.publicKey], node, 'should add node to pending list')
  // testing _addJoiningNodes
  p2pState._addJoiningNodes([node])
  t.notEqual(p2pState.currentCycle.joined.indexOf(key.publicKey), -1, 'should add node to currently joined list')
  // testing _acceptNode
  const cycleMarker = p2pState.getCurrentCycleMarker()
  const cycleInfo = p2pState.getCycleInfo()
  p2pState._acceptNodes(cycleInfo.joined, cycleMarker)
  t.deepEqual(p2pState.nodes.current[key.publicKey], node, 'should accept node and add to current list')
  t.deepEqual(p2pState.nodes.syncing[key.publicKey], node, 'should accept node and add to syncing list')
  t.end()
})

test('Testing _addNodesToNodelist and _addNodeToNodelist methods', async t => {
  let nodes = []
  let keys = []
  for (let i = 0; i < 3; i++) {
    keys.push(p2pState.crypto._generateKeypair())
    nodes.push({
      publicKey: keys[i].publicKey,
      internalIp: '127.0.0.1',
      internalPort: 10000 + i,
      externalIp: '127.0.0.1',
      externalPort: 10000 + i,
      joinRequestTimestamp: Date.now(),
      address: keys[i].publicKey,
      id: keys[i].publicKey
    })
  }
  try {
    p2pState._addNodesToNodelist(nodes)
    t.fail('Should throw an error when node status is not provided')
  } catch (e) {
    t.pass('Should throw an error when node status is not provided')
  }
  nodes.forEach(function (node) { node.status = 'syncing' })
  p2pState._addNodesToNodelist(nodes)
  for (let i = 0; i < 3; i++) {
    t.deepEqual(p2pState.nodes.current[keys[i].publicKey], nodes[i], 'should add each nodes to current list')
    t.deepEqual(p2pState.nodes.syncing[keys[i].publicKey], nodes[i], 'should add each nodes to syncing list')
  }
  await p2pState.clear()
  t.end()
})

test('Testing getLastCycleStart, currentCycleStart methods', { timeout: 100000 }, async t => {
  p2pState.startCycles()
  await sleep((Math.ceil(config.cycleDuration * 1.1) * 1000)) // wait at least one cycle
  const lastCycleStart = p2pState.getLastCycleStart()
  const currentCycleStart = p2pState.getCurrentCycleStart()
  t.equal(isNaN(Number(lastCycleStart * 1000)), false, 'the last cycle start should be a valid time value')
  t.equal(isNaN(Number(currentCycleStart * 1000)), false, 'the current cycle start should be a valid time value')
  p2pState.stopCycles()
  await sleep((Math.ceil(config.cycleDuration) * 1000))
  t.end()
})

test('Testing _computeCycleMarker, _createCertificate methods', { timeout: 100000 }, async t => {
  p2pState.startCycles()
  await sleep((Math.ceil(config.cycleDuration * 0.4) * 1000)) // wait at least one cycle
  const cycleInfo = p2pState.getCycleInfo(false)
  const cycleMarker = p2pState._computeCycleMarker(cycleInfo)
  const cycleCertificate = p2pState._createCertificate(cycleMarker)
  p2pState.stopCycles()
  await sleep((Math.ceil(config.cycleDuration) * 1000))
  const log = readLogFile('main')

  t.equal(isValidHex(cycleMarker), true, 'Cycle Marker should be a valid hex value')
  t.notEqual(log.indexOf(`Created cycle marker: ${cycleMarker}`), -1, 'Should enter created cycle marker into logs')
  t.equal(cycleCertificate.marker, cycleMarker, 'Should have correct marker field in certificate')
  t.equal(p2pState.crypto.verify(cycleCertificate), true, 'Should have valid signature in certificate')
  t.end()
})

test('Testing _createCycleMarker method', { timeout: 100000 }, async t => {
  p2pState.startCycles()
  p2pState._createCycleMarker()
  let certificate = p2pState.currentCycle.certificate
  p2pState.stopCycles()
  await sleep((Math.ceil(config.cycleDuration) * 1000))

  t.equal(isValidHex(certificate.marker), true, 'Cycle Marker in certificate should be a valid hex value')
  t.equal(p2pState.crypto.verify(certificate), true, 'Should have valid signature in certificate')

  if (confStorage) {
    confStorage.options.storage = 'db/db.sqlite'
    fs.writeFileSync(path.join(__dirname, `../../../config/storage.json`), JSON.stringify(confStorage, null, 2))
    clearTestDb()
  }
  t.end()
})
