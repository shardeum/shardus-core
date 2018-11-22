const test = require('tap').test
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const { spawn } = require('child_process')

const Shardus = require('../../../src/shardus')
const { sleep } = require('../../../src/utils')
const { readLogFile, resetLogFile } = require('../../includes/utils-log')
const { clearTestDb, createTestDb } = require('../../includes/utils-storage')

// let newConfStorage, shardus
let shardus
let config = require(path.join(__dirname, '../../../config/server.json'))
let confStorage = module.require(`../../../config/storage.json`)
config.baseDir = '.'
config.log.confFile = 'config/logs.json'
config.storage.confFile = './config/storage.json'
// increase the timeSync limit to avoid issues in the test
config.syncLimit = 100000

// Testing constructor
test('testing Shardus class', async t => {
  // Testing constructor
  // newConfStorage = createTestDb(confStorage, '../../../db/db.test.sqlite')
  createTestDb(confStorage, '../../../db/db.test.sqlite')
  shardus = new Shardus(config)
  t.equal(shardus instanceof Shardus, true, 'the object should be an instance of Shardus')
  await shardus.storage.init()
  t.end()
})

test('testing methods isolated', { timeout: 20000 }, async t => {
  let server = spawn('node', [path.join(__dirname, 'child-process.js')])
  server.stdout.on('data', (data) => console.log(`[stdout] ==> ${data.toString()}`))
  server.stderr.on('data', (data) => console.log(`[stderr] ==> ${data.toString()}`))
  await sleep(6000)
  const res = await axios.post(`http://${config.externalIp}:${config.externalPort}/exit`)
  await sleep(6000)
  console.log(server.exitCode)
  t.equal(res.data.success, true, 'should return success: true from /exit endpoint')
  t.equal(server.exitCode, 0, 'the server should be killed correctly')
  await server.kill()
  t.end()
})

test('testing the shutdown method', { timeout: 10000 }, async t => {
  resetLogFile('main')
  let server = spawn('node', [path.join(__dirname, 'child-process-shutdown.js')])
  server.stdout.on('data', (data) => console.log(`[stdout] ==> ${data.toString()}`))
  server.stderr.on('data', (data) => console.log(`[stderr] ==> ${data.toString()}`))
  await sleep(8000)
  const log = readLogFile('main')
  if (confStorage) {
    confStorage.options.storage = 'db/db.sqlite'
    fs.writeFileSync(path.join(__dirname, `../../../config/storage.json`), JSON.stringify(confStorage, null, 2))
    clearTestDb()
  }
  t.notEqual(log.indexOf('Logger shutting down cleanly...'), -1, 'Should terminate the logger within shardus correctly and insert the log entry')
  t.end()
})
