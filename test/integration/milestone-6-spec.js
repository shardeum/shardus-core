const { test, afterEach } = require('tap')
const { sleep } = require('../../src/utils')
const startUtils = require('../../tools/server-start-utils')('../..')

const seedNodePort = 9001
const secondNodePort = 9002
const cycleDuration = 10

startUtils.setDefaultConfig({ server: { cycleDuration } })

afterEach(async (t) => {
  await startUtils.deleteAllServers()
})

test('The seed node allows 1 new node to join per cycle: ', async t => {
  await startUtils.startServers(2, seedNodePort, 9005)
  await sleep(2.5 * cycleDuration * 1000)
  const { nodes } = await startUtils.getState(seedNodePort)
  let joinedNodes = nodes.filter(n => n.externalPort !== seedNodePort).map(n => n.externalPort)
  t.notEqual(joinedNodes.indexOf(secondNodePort), -1, 'Should have second node Id in the joined node list')
})

test('seed node should send join tx to all known nodes', async t => {
  // establish a network with a seed node and 3 other nodes
  await startUtils.startServer(seedNodePort, 9015, true)
  await startUtils.startServers(3, secondNodePort, 9016)
  await sleep(2.0 * cycleDuration * 1000)
  // const { cycles, nodes } = await startUtils.getState(9001)
  // console.log(cycles.length)
  // console.log(nodes.map(n => n.externalPort))

  // start a 5th node on port 9005
  await startUtils.startServer(9005, 9019)
  await sleep(3.5 * cycleDuration * 1000)

  const request = await startUtils.getRequests(9002)
  const joinRequests = request.filter(r => r.url === 'join').map(r => r.body.nodeInfo.externalPort)
  t.notEqual(joinRequests.indexOf(9005), -1, 'Should have join request from node on port 9005')
})
