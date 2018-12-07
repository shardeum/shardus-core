const test = require('tap').test
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const { fork } = require('child_process')

const Shardus = require('../../../src/shardus')
const { sleep } = require('../../../src/utils')
const { readLogFile } = require('../../includes/utils-log')
const { createTestDb, clearTestDb } = require('../../includes/utils-storage')
const startUtils = require('../../../tools/server-start-utils/index')('../../../', './instances')
const { isValidHex } = require('../../includes/utils')

// let newConfStorage, shardus
let shardus
let config = require(path.join(__dirname, '../../../config/server.json'))
let confStorage = module.require(`../../../config/storage.json`)
config.baseDir = '.'
config.log.confFile = 'config/logs.json'
config.storage.confFile = './config/storage.json'
// increase the timeSync limit to avoid issues in the test
config.syncLimit = 100000

async function requestFromChild (msg) {
  return new Promise(function (resolve, reject) {
    const forked = fork('./test/unit/shardus/child-process-shardus.js')
    forked.send(msg)
    forked.on('message', (data) => {
      forked.send('shutdown')
      setTimeout(() => { // wait until child_process is shutdowned
        resolve(data)
      }, 4000)
    })
  })
}

// Testing constructor
test('testing Shardus class', async t => {
  shardus = new Shardus(config)
  t.equal(shardus instanceof Shardus, true, 'the object should be an instance of Shardus')
  await shardus.storage.init()
  t.end()
})

test('testing /exit endpoint', { timeout: 20000 }, async t => {
  let server = await startUtils.startServer(9001)
  const res = await axios.post(`http://127.0.0.1:9001/exit`)
  await sleep(4000)
  t.equal(res.data.success, true, 'should return success: true from /exit endpoint')
  t.equal(server.process.exitCode, 0, 'the server should be killed correctly')
  await startUtils.deleteAllServers()
  t.end()
})

// TODO: use shardus instance from sever-start-util for this test
test('Testing getCycleMarkerInfo', { skip: true, timeout: 50000 }, async t => {
  createTestDb(confStorage, '../../../db/db.test.sqlite')
  let { cycleMarkerInfo, nodeAddress } = await requestFromChild('getCycleMarkerInfo')
  const diff = Date.now() - (cycleMarkerInfo.currentTime * 1000)
  t.equal(isValidHex(cycleMarkerInfo.currentCycleMarker), true, 'cycleMarker should be a valid hex')
  t.equal(Array.isArray(cycleMarkerInfo.nodesJoined), true, 'last joined should be an array')
  t.equal(cycleMarkerInfo.nodesJoined.length, 1, 'should have at least one node in last joined list')
  t.equal(isValidHex(cycleMarkerInfo.nodesJoined[0]), true, 'the element 0 of the last joined list should be a valid hex value')
  t.equal(cycleMarkerInfo.nodesJoined[0], nodeAddress, 'the last joined node address should be equals to the address of the inserted node')
  t.equal(isNaN(Number(cycleMarkerInfo.currentTime * 1000)), false, 'the currentTime should be a valid time value')
  t.equal(diff > 10000, false, 'the difference of times should not be greater than 10s')
  if (confStorage) {
    confStorage.options.storage = 'db/db.sqlite'
    fs.writeFileSync(path.join(__dirname, `../../../config/storage.json`), JSON.stringify(confStorage, null, 2))
    clearTestDb()
  }
  t.end()
})

// TODO: use shardus instance from sever-start-util for this test
test('Testing getLatestCycles method', { skip: true, timeout: 50000 }, async t => {
  createTestDb(confStorage, '../../../db/db.test.sqlite')
  let { latestCycles } = await requestFromChild('getLatestCycles')
  t.equal(Array.isArray(latestCycles), true, 'latestCycles should be an array')
  t.equal(latestCycles.length, 2, 'should have last 2 latest cycles')
  t.equal(isValidHex(latestCycles[0].previous), true, 'Cycle 1 cycleMarker should be a valid hex')
  t.equal(isValidHex(latestCycles[1].previous), true, 'Cycle 2 cycleMarker should be a valid hex')
  t.equal(latestCycles[0].counter + 1, latestCycles[1].counter, 'Cycle 2 counter should be larger than Cycle 1 counter by 1')
  t.equal(latestCycles[1].previous, latestCycles[0].marker, 'Previous of Cycle 2 should be equal to cycle marker of Cycle 1')
  if (confStorage) {
    confStorage.options.storage = 'db/db.sqlite'
    fs.writeFileSync(path.join(__dirname, `../../../config/storage.json`), JSON.stringify(confStorage, null, 2))
    clearTestDb()
  }
  t.end()
})

// TODO: use shardus instance from sever-start-util for this test
test('Testing _join method', { skip: true, timeout: 50000 }, async t => {
  createTestDb(confStorage, '../../../db/db.test.sqlite')
  let { joined } = await requestFromChild('_join')
  t.equal(joined, true, '_join method should return true if join is successful')
  if (confStorage) {
    confStorage.options.storage = 'db/db.sqlite'
    fs.writeFileSync(path.join(__dirname, `../../../config/storage.json`), JSON.stringify(confStorage, null, 2))
    clearTestDb()
  }
  t.end()
})

// TODO: use shardus instance from sever-start-util for this test
test('Testing _submitJoin method', { skip: true, timeout: 50000 }, async t => {
  createTestDb(confStorage, '../../../db/db.test.sqlite')
  let { joinRequest } = await requestFromChild('_submitJoin')
  const log = readLogFile('main')
  const submitJoinMessage = `Join request received: ${JSON.stringify(joinRequest)}`
  t.notEqual(log.indexOf(submitJoinMessage), -1, 'Should recieve submitted join request and insert the log entry')
  if (confStorage) {
    confStorage.options.storage = 'db/db.sqlite'
    fs.writeFileSync(path.join(__dirname, `../../../config/storage.json`), JSON.stringify(confStorage, null, 2))
    clearTestDb()
  }
  t.end()
})
