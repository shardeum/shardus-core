const { test, afterEach } = require('tap')
const { sleep } = require('../../src/utils')
const Shardus = require('../../src/shardus')
const startUtils = require('../../tools/server-start-utils')('../..')
const axios = require('axios')
const path = require('path')
const fs = require('fs')

const { readLogFile } = require('../includes/utils-log')
const { clearTestDb, createTestDb } = require('../includes/utils-storage')

const seedNodePort = 9001
const secondNodePort = 9002
const cycleDuration = 5

startUtils.setDefaultConfig({ server: { cycleDuration } })

afterEach(async t => {
  await startUtils.deleteAllServers()
})

test('seed node should have a `/join` endpoint on its external API', { skip: false }, async t => {
  await startUtils.startServer(9001)
  try {
    await axios.post(`http://127.0.0.1:${seedNodePort}/join`, {})
  } catch (e) {
    throw new Error(e)
  }
  t.pass('Seed node should have a `/join` endpoint')
  await startUtils.deleteAllServers()
  t.end()
})

test('second node should send a join request to the seed nodes `/join` endpoint', { skip: false }, async t => {
  await startUtils.startServers(2, 9001)
  await sleep(1.2 * cycleDuration * 1000 + 100)
  try {
    var { data } = await axios.get(`http://127.0.0.1:${seedNodePort}/test`)
  } catch (e) {
    throw new Error(e)
  }
  const joinRequest = data.requests.find(r => r.url === '/join' && r.method === 'POST')
  t.equal(joinRequest.body.nodeInfo.externalPort, secondNodePort, 'Seed node recieves join request from second node')
  await startUtils.deleteAllServers()
  t.end()
})

test('second node should poll the seed nodes `/cyclemarker` endpoint to check if it was accepted', { skip: false }, async t => {
  await startUtils.startServers(2, 9001)
  await sleep(2.8 * cycleDuration * 1000 + 100)
  // read second node's main log file
  const logs = readLogFile('main', '../../instances/shardus-server-9002/logs')
  t.notEqual(logs.indexOf('Successfully joined the network!'), -1, 'Should poll cyclemarker from seedNode and check if it is accepted in network')
  await startUtils.deleteAllServers()
  t.end()
})

test('second node should make join requests every cycle marker if it is not accepted', { skip: false, timeout: 100000 }, async t => {
  let shardus
  let success = true
  let config = require(path.join(__dirname, '../../config/server.json'))
  let confStorage = module.require(`../../config/storage.json`)

  config.baseDir = '.'
  config.log.confFile = 'config/logs.json'
  config.storage.confFile = './config/storage.json'
  config.syncLimit = 100000
  createTestDb(confStorage, '../../db/db.test.sqlite')

  // start seed node
  shardus = new Shardus(config)
  await shardus.setup(config)

  // set seed node acceptJoinReq = false to reject join requests from second node
  setInterval(() => {
    if (shardus.p2p.state.acceptJoinReq === true) {
      shardus.p2p.state.acceptJoinReq = false
    }
  }, 100)

  // start second node
  await startUtils.startServer(9002) // start second node
  let currentCounter = 0
  let previousNumOfJoinRequests

  const checkEachCycle = async function () {
    let { data } = await axios.get('http://127.0.0.1:9001/test')
    let { requests, state } = data
    if (state.cycleInfo.counter > currentCounter) {
      let joinRequests = requests.filter(r => r.url === '/join')
      let currentNumOfJoinRequests = joinRequests.length
      if (previousNumOfJoinRequests > 0 && currentNumOfJoinRequests <= previousNumOfJoinRequests) {
        console.log('Number of join request is not increasing in each cycle')
        success = false
      }
      previousNumOfJoinRequests = currentNumOfJoinRequests
      currentCounter = state.cycleInfo.counter
    }
  }
  let checkInterval = setInterval(checkEachCycle, 500)
  await sleep(8 * cycleDuration * 1000) // testing a few cycles

  // cleaning up
  clearInterval(checkInterval)
  shardus.shutdown()
  if (confStorage) {
    confStorage.options.storage = 'db/db.sqlite'
    fs.writeFileSync(path.join(__dirname, `../../config/storage.json`), JSON.stringify(confStorage, null, 2))
    clearTestDb()
  }

  t.equal(success, true, 'Number of join requests from second node should be increasing in each cycle')
  t.end()
})
