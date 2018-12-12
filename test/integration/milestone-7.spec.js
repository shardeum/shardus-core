const { test, afterEach } = require('tap')
const { sleep } = require('../../src/utils')
const { isValidHex } = require('../includes/utils')
const startUtils = require('../../tools/server-start-utils')({ baseDir: '../..', verbose: true })
// const axios = require('axios')
const seedNodePort = 9001
const secondNodePort = 9002
const cycleDuration = 5

startUtils.setDefaultConfig({ server: { cycleDuration } })

afterEach(async (t) => {
  // await startUtils.deleteAllServers()
})

test('Second node should compute and save its node_id and activate its internal API', async t => {
  await startUtils.startServer(seedNodePort, 9015)
  const secondNode = await startUtils.startServer(secondNodePort, 9016, null, true, true)
  const shardusSecond = secondNode.process
  await sleep(2.0 * cycleDuration * 1000)
  const secondNodeId = await shardusSecond.storage.getProperty('id')

  await sleep(5000)
  let requests = await startUtils.getRequests(seedNodePort)
  requests = requests.map(r => r.url)

  t.equal(isValidHex(secondNodeId), true, 'Should save valid node_id to database')
  t.equal(requests.includes('active'), true, 'Should receive internal API request from second node')
  await startUtils.deleteAllServers()
})

test('Second node should use its internal API to sync its node list and cycle chain with the network ', async t => {
  await startUtils.startServer(seedNodePort, 9015)
  await sleep(cycleDuration * 1000)
  await startUtils.startServer(secondNodePort, 9016)

  await sleep(2.0 * cycleDuration * 1000)

  let seedState = await startUtils.getState(seedNodePort)
  let secondState = await startUtils.getState(secondNodePort)

  // TODO: to compare cyclechain from seed node and second node
  t.deepEqual(seedState.nodes, secondState.nodes, 'Should have same nodelist as seed node')
  await startUtils.deleteAllServers()
})
