const { before, test } = require('tap')// eslint-disable-line
const path = require('path')
const fs = require('fs')
const axios = require('axios')

let confStorage = module.require(`../../../config/storage.json`)
const { getInstances } = module.require('../../includes/utils-class')
const { clearTestDb } = module.require('../../includes/utils-storage')
const { sleep } = require('../../../src/utils')
const startUtils = require('../../../tools/server-start-utils/index')('../../../', './instances')
let p2p
// let config = module.require(path.join(__dirname, '../../../config/server.json'))

async function init (loggerConf = null, externalPort = null) {
  const instances = await getInstances(loggerConf, externalPort)
  p2p = instances.p2p
}

test('Testing P2P integrated methods with a seedNode up', { timeout: 100000, skip: false }, async t => {
  await startUtils.startServer(9001, 9005)
  await init(null, 9002)
  let joinRequest = await p2p._createJoinRequest('abc123')
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
  const shutdown = await axios.post(`http://127.0.0.1:9001/exit`, {})
  await sleep(4000)
  if (confStorage) {
    confStorage.options.storage = 'db/db.sqlite'
    fs.writeFileSync(path.join(__dirname, `../../../config/storage.json`), JSON.stringify(confStorage, null, 2))
    clearTestDb()
  }
  t.equal(shutdown.data.success, true, 'should shutdown the server correctly')
  await startUtils.deleteAllServers()
})

// TODO: use shardus instance from sever-start-util for this test
test('Testing startup method with a seednode up', { timeout: 100000, skip: true }, async t => {
  await startUtils.startServer(9001, 9005, true)
  await init(null, 9002)
  let startup = await p2p.startup()
  t.equal(startup, true, 'Should return true if startup is successful')
  if (confStorage) {
    confStorage.options.storage = 'db/db.sqlite'
    fs.writeFileSync(path.join(__dirname, `../../../config/storage.json`), JSON.stringify(confStorage, null, 2))
    clearTestDb()
  }
  await startUtils.deleteAllServers()
})
