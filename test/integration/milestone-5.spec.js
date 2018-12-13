const { test, afterEach, tearDown } = require('tap')
const { sleep } = require('../../src/utils')
const startUtils = require('../../tools/server-start-utils')({ baseDir: '../..' })
const axios = require('axios')

const seedNodePort = 9001
const secondNodePort = 9002
const cycleDuration = 5

startUtils.setDefaultConfig({ server: { cycleDuration } })

afterEach(async (t) => {
  await startUtils.deleteAllServers()
})

test('seed node should have a `/join` endpoint on its external API', async t => {
  await startUtils.startServer(9001, 9005)
  try {
    await axios.post(`http://127.0.0.1:${seedNodePort}/join`, {})
  } catch (e) {
    throw new Error(e)
  }
  t.pass('Seed node should have a `/join` endpoint')
})

test('second node should send a join request to the seed node `/join` endpoint', async t => {
  await startUtils.startServer(seedNodePort, 9015)
  await startUtils.startServer(secondNodePort, 9016)
  await sleep(cycleDuration * 1000)
  const requests = await startUtils.getRequests(seedNodePort)
  const joinRequest = requests.find(r => r.url === '/join' && r.method === 'POST')
  t.equal(joinRequest.body.nodeInfo.externalPort, secondNodePort, 'Seed node recieves join request from second node')
})

test('second node should poll the seed nodes `/cyclemarker` endpoint to check if it was accepted', async t => {
  await startUtils.startServer(seedNodePort, 9015)
  await startUtils.startServer(secondNodePort, 9016)
  await sleep(2 * cycleDuration * 1000)
  const requests = await startUtils.getRequests(seedNodePort)
  let cycleMarkerRequests = requests.filter(r => r.url === '/cyclemarker')
  t.equal(cycleMarkerRequests.length > 1, true, 'Should seed node receive more than one cyclemarker requests from second node')
})

tearDown(async () => {
  await startUtils.deleteAllServers()
})
