const { before, test } = require('tap')// eslint-disable-line
const path = require('path')
const fs = require('fs')
const axios = require('axios')

let confStorage = module.require(`../../../config/storage.json`)
const { getInstances } = module.require('../../includes/utils-class')
const { clearTestDb } = module.require('../../includes/utils-storage')
const { sleep } = require('../../../src/utils')
const startUtils = require('../../../tools/server-start-utils/index')('../../../', './instances')
// let storage, logger, crypto, newConfStorage
let p2p
let config = module.require(path.join(__dirname, '../../../config/server.json'))

async function init (loggerConf = null, externalPort = null) {
  // standard cleanup, commenting out unused variables, can add them back in as needed
  const instances = await getInstances(loggerConf, externalPort)
  // storage = instances.storage
  // logger = instances.logger
  // crypto = instances.Crypto
  p2p = instances.p2p
  // newConfStorage = instances.newConfStorage
}

test('Testing P2P integrated methods with a seedNode up', { timeout: 100000, skip: false }, async t => {
  await startUtils.startServer(9001)
  await init(null, 9002)
  await p2p.discoverNetwork()
  let joinRequest = await p2p._createJoinRequest()
  t.match(joinRequest, {
    cycleMarker: /[0-9a-fA-F]+/,
    nodeInfo: {
      address: /[0-9a-fA-F]+/,
      externalIp: /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/,
      externalPort: /\d+/,
      internalIp: /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/,
      internalPort: /\d+/,
      joinRequestTimestamp: /\d+/,
      publicKey: /[0-9a-fA-F]+/
    },
    proofOfWork: {
      compute: {
        hash: /[0-9a-fA-F]+/,
        nonce: /[0-9a-fA-F]+/
      }
    },
    selectionNum: /[0-9a-fA-F]+/,
    sign: {
      owner: /[0-9a-fA-F]+/,
      sig: /[0-9a-fA-F]+/
    }
  }, 'joinRequest should have all expected properties')
  await sleep(2000)
  const shutdown = await axios.post(`http://${config.externalIp}:${config.externalPort - 1}/exit`, {})
  await sleep(2000)
  await startUtils.deleteAllServers()
  if (confStorage) {
    confStorage.options.storage = 'db/db.sqlite'
    fs.writeFileSync(path.join(__dirname, `../../../config/storage.json`), JSON.stringify(confStorage, null, 2))
    clearTestDb()
  }
  t.equal(shutdown.data.success, true, 'should shutdown the server correctly')
  t.end()
})

test('Testing discoverNetwork method with a seednode up', { timeout: 100000, skip: false }, async t => {
  await startUtils.startServer(9001)
  await sleep(1000)
  await init(null, 9002)
  await p2p.discoverNetwork()
  const response = await axios.get(`http://127.0.0.1:9001/cyclemarker`)
  let thisNodeInfo = p2p._getThisNodeInfo()
  await sleep(2000)
  await startUtils.deleteAllServers()
  await sleep(3000)
  t.notEqual(response.data.nodesJoined.indexOf(thisNodeInfo.publicKey), -1, 'Should included this node in joined list')
  if (confStorage) {
    confStorage.options.storage = 'db/db.sqlite'
    fs.writeFileSync(path.join(__dirname, `../../../config/storage.json`), JSON.stringify(confStorage, null, 2))
    clearTestDb()
  }
  t.end()
})

test('Testing join procedure with 1 seed node and 3 normal ndoes', { timeout: 100000, skip: false }, async t => {
  startUtils.startServer(9001)
  await sleep(500)
  startUtils.startServers(9002, 3)
  await sleep(config.cycleDuration * 2.9 * 1000) // waiting unitl third cycle to check join result
  let response = await axios.get(`http://127.0.0.1:9001/cyclemarker`)
  if (response.data.nodesJoined.length < 3) {
    await sleep(config.cycleDuration * 1 * 1000) // waiting for one more cycle if all 3 nodes haven't been accepted yet
    response = await axios.get(`http://127.0.0.1:9001/cyclemarker`)
  }
  await startUtils.deleteAllServers()
  t.equal(response.data.nodesJoined.length, 3, 'Should have 3 nodes joined in second cycle')
  if (confStorage) {
    confStorage.options.storage = 'db/db.sqlite'
    fs.writeFileSync(path.join(__dirname, `../../../config/storage.json`), JSON.stringify(confStorage, null, 2))
    clearTestDb()
  }
  t.end()
})
