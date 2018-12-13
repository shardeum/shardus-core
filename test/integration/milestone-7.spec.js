const { test, afterEach, tearDown } = require('tap')
const axios = require('axios')
const { sleep } = require('../../src/utils')
const { isValidHex } = require('../includes/utils')
const startUtils = require('../../tools/server-start-utils')({ baseDir: '../..' })

const seedNodePort = 9001
const secondNodePort = 9002
const cycleDuration = 5

startUtils.setDefaultConfig({ server: { cycleDuration } })

afterEach(async (t) => {
  await startUtils.deleteAllServers()
})

test('Second node should compute and save its node_id and activate its internal API', async t => {
  await startUtils.startServer(seedNodePort, 9015)
  await startUtils.startServer(secondNodePort, 9016, 'active')

  await sleep(2 * cycleDuration * 1000)

  const { data } = await axios(`http://127.0.0.1:${secondNodePort}/nodeinfo`)
  const secondNodeId = data.nodeInfo.id
  let requests = await startUtils.getRequests(seedNodePort)
  requests = requests.map(r => r.url)
  t.equal(isValidHex(secondNodeId), true, 'Should save valid node_id to database')
  t.equal(requests.includes('active'), true, 'Should receive internal API request from second node')
})

test('Second node should use its internal API to sync its node list and cycle chain with the network ', async t => {
  await startUtils.startServer(seedNodePort, 9015)
  await startUtils.startServer(secondNodePort, 9016, 'active')

  await sleep(2 * cycleDuration * 1000)

  let seedState = await startUtils.getState(seedNodePort)
  let secondState = await startUtils.getState(secondNodePort)
  t.deepEqual(seedState.nodes, secondState.nodes, 'Should have same node list as seed node')

  // Check only the cycles that have been synced by the second node
  const seedCycles = {}
  const secondCycles = {}
  for (const cycle in secondState.cycles) {
    secondCycles[cycle] = secondState.cycles[cycle]
    seedCycles[cycle] = seedState.cycles[cycle]
  }
  t.deepEqual(seedCycles, secondCycles, 'Should have same cycles as seed node')
})

tearDown(async () => {
  await startUtils.stopAllServers()
})
