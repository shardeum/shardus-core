const { test, afterEach, tearDown } = require('tap')
const axios = require('axios')
const { sleep } = require('../../src/utils')
const startUtils = require('../../tools/server-start-utils')({ baseDir: '../..', verbose: true })

const seedNodePort = 9001
const cycleDuration = 5

startUtils.setDefaultConfig({ server: { cycleDuration } })

afterEach(async (t) => {
  await startUtils.deleteAllServers()
})

test('Second node should send "active" message to all known nodes', async t => {
  await startUtils.startServers(2, seedNodePort, 9015)
  await startUtils.startServer(9003, 8003)
  const { data } = await axios(`http://127.0.0.1:9003/nodeinfo`)
  const nodeId = data.nodeInfo.id
  await sleep(cycleDuration * 1000)
  for (let i = 0; i < 2; i += 1) {
    const requests = await startUtils.getRequests(seedNodePort + i)
    const activeMessages = requests.filter(r => r.url === 'active').map(r => r.body.nodeId)
    t.equal(activeMessages.includes(nodeId), true, 'Should send active message to other nodes')
  }
})

test('Network should add nodes active state to the cycle chain', async t => {
  await startUtils.startServers(2, seedNodePort, 9015)
  await startUtils.startServer(9003, 8003)
  await sleep(3 * cycleDuration * 2000)
  const { data } = await axios(`http://127.0.0.1:${seedNodePort}/cyclechain`)
  const cycleChain = data.cycleChain
  const lastCycle = cycleChain[cycleChain.length - 1]
  const { nodes } = await startUtils.getState(seedNodePort)
  const lastJoinedNode = nodes.find(n => n.externalPort === 9003)
  t.equal(lastCycle.active, 3, 'Seed node should have  3 active nodes in cycle chain')
  t.equal(lastJoinedNode.status, 'active', 'Network should update all node lists to mark node as active')
  // TODO: check same things for second node at port 9002. Currently, second node is not adding new node into nodelist
})

tearDown(async () => {
  await startUtils.deleteAllServers()
})
