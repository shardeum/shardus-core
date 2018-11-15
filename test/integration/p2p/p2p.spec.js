const { before, test } = require('tap')// eslint-disable-line
const path = require('path')
const fs = require('fs')
const axios = require('axios')
const { spawn } = require('child_process')

let confStorage = module.require(`../../../config/storage.json`)
const { getInstances } = module.require('../../includes/utils-class')
const { clearTestDb } = module.require('../../includes/utils-storage')
const { sleep } = require('../../../src/utils')
// let storage, logger, crypto, newConfStorage
let p2p

async function init (loggerConf = null, externalPort = null) {
  // standard cleanup, commenting out unused variables, can add them back in as needed
  const instances = await getInstances(loggerConf, externalPort)
  // storage = instances.storage
  // logger = instances.logger
  // crypto = instances.Crypto
  p2p = instances.p2p
  // newConfStorage = instances.newConfStorage
}

test('Testing P2P integrated methods with a seedNode up', async t => {
  let server = spawn('node', [path.join(__dirname, 'shardus-child-process.js')])
  let config = module.require(path.join(__dirname, '../../../config/server.json'))
  server.stdout.on('data', (data) => console.log(`[stdout] ==> ${data.toString()}`))
  server.stderr.on('data', (data) => console.log(`[stderr] ==> ${data.toString()}`))
  await sleep(5000)
  await init(null, 9002)
  await p2p.discoverNetwork()
  let res = await p2p._createJoinRequest()
  t.match(res, {
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
  await sleep(10000)
  const shutdown = await axios.post(`http://${config.externalIp}:${config.externalPort - 1}/exit`)
  if (confStorage) {
    confStorage.options.storage = 'db/db.sqlite'
    fs.writeFileSync(path.join(__dirname, `../../../config/storage.json`), JSON.stringify(confStorage, null, 2))
    clearTestDb()
  }
  t.equal(shutdown.data.success, true, 'should shutdown the server correctly')
  t.end()
})
