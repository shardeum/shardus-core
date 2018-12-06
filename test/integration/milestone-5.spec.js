const { test, afterEach } = require('tap')
const { sleep } = require('../../src/utils')
const startUtils = require('../../tools/server-start-utils')('../..')
const axios = require('axios')

const seedNodePort = 9001
const secondNodePort = 9002
const cycleDuration = 5

startUtils.setDefaultConfig({ server: { cycleDuration } })

afterEach(async t => {
  await startUtils.deleteAllServers()
})

test('seed node should have a `/join` endpoint on its external API', async t => {
  await startUtils.startServer(9001)
  try {
    await axios.post(`http://127.0.0.1:${seedNodePort}/join`, {})
  } catch (e) {
    throw new Error(e)
  }
})

test('second node should send a join request to the seed nodes `/join` endpoint', async t => {
  await startUtils.startServers(2, 9001)
  await sleep(cycleDuration * 1000 + 100)
  try {
    var { data } = await axios.get(`http://127.0.0.1:${seedNodePort}/test`)
  } catch (e) {
    throw new Error(e)
  }
  const joinRequest = data.requests.find(r => r.url === '/join' && r.method === 'POST')
  t.equal(joinRequest.body.nodeInfo.externalPort, secondNodePort, 'seed node got second nodes join request')
})

test('second node should poll the seed nodes `/cyclemarker` endpoint to check if it was accepted', async t => {})

test('second node should make join requests every cycle marker if it is not accepted', async t => {})
