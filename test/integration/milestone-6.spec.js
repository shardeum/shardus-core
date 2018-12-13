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

test('The seed node allows 1 new node to join per cycle: ', async t => {
  await startUtils.startServer(seedNodePort, 9005)
  await startUtils.startServer(secondNodePort, 9006)
  await sleep(cycleDuration * 1000)
  const { nodes } = await startUtils.getState(seedNodePort)
  let joinedNodes = nodes.filter(n => n.externalPort !== seedNodePort).map(n => n.externalPort)
  t.notEqual(joinedNodes.indexOf(secondNodePort), -1, 'Should have second node Id in the joined node list')
})

test('seed node should send join tx to all known nodes', async t => {
  // establish a network with a seed node and 3 other nodes
  await startUtils.startServer(seedNodePort, 9016)
  await startUtils.startServer(secondNodePort, 9017)
  await startUtils.startServer(9003, 9018, 'id')

  // start a 4th node on port 9004
  await startUtils.startServer(9004, 8004, 'id')
  await sleep(cycleDuration * 1000)

  const requests = await startUtils.getRequests(9002)
  const joinRequests = requests.filter(r => r.url === 'join').map(r => r.body.nodeInfo.externalPort)
  t.notEqual(joinRequests.indexOf(9004), -1, 'Should have join request from node on port 9004')
})

test('seed node should select one new node per cycle based on highest selection number', async t => {
  await startUtils.startServer(seedNodePort, 9016)
  await startUtils.startServer(secondNodePort, 9017)
  await startUtils.startServer(9003, 9018, 'id')
  await sleep(cycleDuration * 1000)
  const requests = await startUtils.getRequests(seedNodePort)
  const joinRequests = requests
    .filter(r => r.url === '/join')
    .sort((r1, r2) => parseInt(r1.body.selectionNum, 16) - parseInt(r2.body.selectionNum, 16))

  const nodeWithHighSelectionNum = joinRequests[0].body.nodeInfo
  const response = await axios(`http://127.0.0.1:${seedNodePort}/cyclechain`)
  const cycleChain = response.data.cycleChain
  const { nodes } = await startUtils.getState(seedNodePort)
  const joinedNodeAddresses = nodes.map(n => n.address)

  t.equal(cycleChain.length > 0, true, 'Cycle chain should have more than one cycle')
  t.equal(joinedNodeAddresses.includes(nodeWithHighSelectionNum.address), true, 'Seed node should add selected nodes to its node list ')

  // TODO: to test seedNode accept join request with highest selection number first
  // const joinedNodes = cycleChain
  // .filter(c => c.counter > 0 && c.joined.length > 0)
  // .map(c => c.joined[0])
  // const firstAcceptedNode = joinedNodes[0]
  // t.equal(firstAcceptedNode, nodeWithHighSelectionNum.address, 'Should accept node with highest selection number first')
})

tearDown(async () => {
  await startUtils.stopAllServers()
})
