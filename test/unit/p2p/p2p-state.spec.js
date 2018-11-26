const test = require('tap').test
const path = require('path')
const fs = require('fs')

const Logger = require('../../../src/logger')
const Storage = require('../../../src/storage')
const Crypto = require('../../../src/crypto/index')
const P2PState = require('../../../src/p2p/p2p-state')

const { clearTestDb, createTestDb } = require('../../includes/utils-storage')
const { sleep } = require('../../../src/utils')

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
  t.equal(p2pState instanceof P2PState, true, 'should instanciate the object correctly')
})

test('Testing addJoinRequest, getCycleInfo and clear methods', { timeout: 100000 }, async t => {
  let keys = []
  let joinArray = []
  let numberOfJoinRequest = 10
  await p2pState.storage.init()
  await p2pState.crypto.init()
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

test('Testing addNodes', async t => {
  let address = '50e686d4e7bf82abe86df4b5de8cc27cae0d28f2fa5a9afbddf0a700758b252b'
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
  if (confStorage) {
    confStorage.options.storage = 'db/db.sqlite'
    fs.writeFileSync(path.join(__dirname, `../../../config/storage.json`), JSON.stringify(confStorage, null, 2))
    clearTestDb()
  }
  t.end()
})
