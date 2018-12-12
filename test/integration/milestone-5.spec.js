const { test, afterEach } = require('tap')
const { sleep } = require('../../src/utils')
const startUtils = require('../../tools/server-start-utils')({ baseDir: '../..', verbose: true })
const axios = require('axios')

const seedNodePort = 9001
const secondNodePort = 9002
const cycleDuration = 5

startUtils.setDefaultConfig({ server: { cycleDuration } })

afterEach(async (t) => {
  // await startUtils.deleteAllServers()
})

test('seed node should have a `/join` endpoint on its external API', async t => {
  await startUtils.startServer(9001, 9005)
  try {
    await axios.post(`http://127.0.0.1:${seedNodePort}/join`, {})
  } catch (e) {
    throw new Error(e)
  }
  t.pass('Seed node should have a `/join` endpoint')
  await startUtils.deleteAllServers()
})

test('second node should send a join request to the seed node `/join` endpoint', async t => {
  await startUtils.startServers(2, seedNodePort, 9015)
  await sleep(2.5 * cycleDuration * 1000)
  const requests = await startUtils.getRequests(seedNodePort)
  const joinRequest = requests.find(r => r.url === '/join' && r.method === 'POST')
  t.equal(joinRequest.body.nodeInfo.externalPort, secondNodePort, 'Seed node recieves join request from second node')
  await startUtils.deleteAllServers()
})

test('second node should poll the seed nodes `/cyclemarker` endpoint to check if it was accepted', async t => {
  await startUtils.startServers(2, seedNodePort, 9015)
  await sleep(3.0 * cycleDuration * 1000)
  const requests = await startUtils.getRequests(seedNodePort)
  let cycleMarkerRequests = requests.filter(r => r.url === '/cyclemarker')
  t.equal(cycleMarkerRequests.length > 1, true, 'Should seed node receive more than one cyclemarker requests from second node')
  await startUtils.deleteAllServers()
})

test('second node should make join requests every cycle marker if it is not accepted', { timeout: 200000, skip: false }, async t => {
  let server = await startUtils.startServer(seedNodePort, 9015, null, true, true)
  let shardus = server.process
  let success = true

  // set seed node acceptJoinReq = false to reject join requests from second node
  const rejectInterval = setInterval(() => {
    if (shardus.p2p.state.acceptJoinReq === true) {
      shardus.p2p.state.acceptJoinReq = false
    }
  }, 100)

  // start second node
  // TODO: start second seed node while seed node is not accepting requests
  try {
    await startUtils.startServer(secondNodePort, 9016) // start second node
  } catch (e) {
    console.log('some error while trying to start second node')
  }

  let record = {}
  const checkEachCycle = async function () {
    let { data } = await axios.get('http://127.0.0.1:9001/test')
    let { requests, state } = data
    let counter = state.cycles.length - 1
    let joinRequests = requests.filter(r => r.url === '/join')
    if (counter >= 0) record[counter] = joinRequests.length
  }
  let checkInterval = setInterval(checkEachCycle, 1000)
  await sleep(4 * cycleDuration * 1000) // testing a few cycles

  let previous
  let keys = Object.keys(record)
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (previous > 0 && record[keys[i]] <= previous) success = false
    previous = record[keys[i]]
  }
  // cleaning up
  clearInterval(checkInterval)
  clearInterval(rejectInterval)
  t.equal(success, true, 'Number of join requests from second node should be increasing in each cycle')
  await startUtils.deleteAllServers()
})
