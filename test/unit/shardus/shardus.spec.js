const test = require('tap').test
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const { spawn } = require('child_process')

const Shardus = require('../../../src/shardus')
const { sleep } = require('../../../src/utils')
const { readLogFile, resetLogFile } = require('../../includes/utils-log')

let shardus
let config = require(path.join(__dirname, '../../../config/server.json'))
// increase the timeSync limit to avoid issues in the test
config.syncLimit = 10000

// Testing constructor
test('testing Shardus class', async t => {
  // Testing constructor
  {
    try {
      const instance = new Shardus(null)
      t.fail('should return an error passing a null config to the constructor')
    } catch (e) {
      t.ok(e, 'returned an error as expected')
    }
  }

  // Testing constructor
  {
    shardus = new Shardus(config)
    t.equal(shardus instanceof Shardus, true, 'the object should be an instance of Shardus')
  }

  t.end()
})

test('testing methods isolated', { timeout: 2000 }, async t => {
  let server = spawn('node', [path.join(__dirname, 'child-process.js')])
  // server.stdout.on('data', (data) => console.log(`[stdout] ==> ${data.toString()}`))
  // server.stderr.on('data', (data) => console.log(`[stderr] ==> ${data.toString()}`))
  await sleep(500)
  const res = await axios.post(`http://${config.externalIp}:${config.externalPort}/exit`)
  await sleep(500)
  t.equal(res.data.success, true, 'should return success: true from /exit endpoint')
  t.equal(server.exitCode, 0, 'the server should be killed correctly')
  await server.kill()
  t.end()
})

test('testing the shutdown method', { timeout: 10000 }, async t => {
  resetLogFile('main')
  let server = spawn('node', [path.join(__dirname, 'child-process-shutdown.js')])
  // server.stdout.on('data', (data) => console.log(`[stdout] ==> ${data.toString()}`))
  // server.stderr.on('data', (data) => console.log(`[stderr] ==> ${data.toString()}`))
  await sleep(3000)
  const log = readLogFile('main')
  t.notEqual(log.indexOf('Logger shutting down cleanly...'), -1, 'Should terminate the logger within shardus correctly and insert the log entry')
  t.end()
})
