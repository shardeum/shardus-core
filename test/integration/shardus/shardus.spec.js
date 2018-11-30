const { before, test } = require('tap')// eslint-disable-line
const path = require('path')
const fs = require('fs')
const axios = require('axios')

let confStorage = module.require(`../../../config/storage.json`)
const { getInstances } = module.require('../../includes/utils-class')
const { clearTestDb } = module.require('../../includes/utils-storage')
const { readLogFile } = require('../../includes/utils-log')
// const { sleep } = require('../../../src/utils')
const startUtils = require('../../../tools/server-start-utils/index')('../../../', './instances')
// let storage, logger, crypto, newConfStorage
let p2p
let config = module.require(path.join(__dirname, '../../../config/server.json'))

async function init (loggerConf = null, externalPort = null) {
  const instances = await getInstances(loggerConf, externalPort)
  p2p = instances.p2p
}

test('Testing /join API endpoint in shardus class', { timeout: 100000, skip: false }, async t => {
  await startUtils.startServer(9001)
  await init(null, 9002)

  let response = await axios.post(`http://${config.externalIp}:${config.externalPort - 1}/join`, {})
  //  t.equal(response.data.success, false, 'Should return success: false for an empty join request')
  //  t.equal(response.data.error, 'invalid join request', 'Should return error message for empty join request')

  let joinRequest = await p2p._createJoinRequest()
  response = await axios.post(`http://${config.externalIp}:${config.externalPort - 1}/join`, joinRequest)
  const log = readLogFile('main', '../integration/shardus/instances/shardus-server-9001/logs')
  await startUtils.deleteAllServers()
  t.equal(response.data.success, true, 'Should return success: true for a valid join request')
  t.notEqual(log.indexOf(`Join request received: ${JSON.stringify(joinRequest)}`), -1, 'Should enter recieved join request into main.log')
  if (confStorage) {
    confStorage.options.storage = 'db/db.sqlite'
    fs.writeFileSync(path.join(__dirname, `../../../config/storage.json`), JSON.stringify(confStorage, null, 2))
    clearTestDb()
  }
  t.end()
})
