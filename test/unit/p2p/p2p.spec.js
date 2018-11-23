const test = require('tap').test
const path = require('path')
const fs = require('fs')
const { isIP } = require('net')
// const { spawn } = require('child_process')

const P2P = require('../../../src/p2p')
const Logger = require('../../../src/logger')
const Storage = require('../../../src/storage')
const Crypto = require('../../../src/crypto/index')

// const { readLogFile, resetLogFile } = require('../../includes/utils-log')
const { clearTestDb, createTestDb } = require('../../includes/utils-storage')
// const { sleep } = require('../../../src/utils')
const { isValidHex } = require('../../includes/utils')

let p2p
let confStorage = module.require(`../../../config/storage.json`)
let config = require(path.join(__dirname, '../../../config/server.json'))
// increase the timeSync limit to avoid issues in the test
config.syncLimit = 100000
config.ipInfo = { externalIp: config.externalIp || null, externalPort: config.externalPort || null }

// let configFilePath = path.join(__dirname, '../../../config/logs.json')
let loggerConfig = {
  dir: '/logs',
  confFile: '/config/logs.json',
  files: {
    main: 'main.log',
    fatal: 'fatal.log',
    net: 'net.log'
  }
}

let logger = new Logger(path.resolve('./'), loggerConfig)
// let newConfStorage = createTestDb(confStorage)
createTestDb(confStorage)
let storage = new Storage(
  logger,
  '.',
  { confFile: './config/storage.json' }
)
let crypto

test('Testing p2p constructor', async t => {
  await storage.init()
  crypto = new Crypto(logger, storage)
  await crypto.init()
  p2p = new P2P(config, logger, storage, crypto)
  t.equal(p2p instanceof P2P, true, 'p2p should be instatiated correctly')
  t.end()
})

test('Testing _verifyIpInfo', async t => {
  // {
  try {
    p2p._verifyIpInfo()
    t.fail('this call without args should not be allowed')
  } catch (e) {
    t.pass('should throw an error with no args passed')
  }
  // }

  // {
  try {
    p2p._verifyIpInfo({ externalIp: '127.0.0.1' })
    t.fail('this call without port should not be allowed')
  } catch (e) {
    t.pass('should throw an error with no property port passed')
  }
  // }

  {
    const res = p2p._verifyIpInfo({ externalIp: '127.0.0.1', externalPort: 9001 })
    t.equal(res, true, 'should return true for a valid ip and port passed as parameter')
  }

  t.end()
})

test('Testing _retrieveIp method', async t => {
  // {
  try {
    // const res = await p2p._retrieveIp('http://google.com')
    await p2p._retrieveIp('http://google.com')
    t.fail('should not get an IP from google')
  } catch (e) {
    t.pass('should throw an error for an invalid ip server')
  }
  // }

  {
    const res = await p2p._retrieveIp(config.ipServer)
    t.notEqual(isIP(res), 0, 'should return a valid ip from ipServer')
  }
  t.end()
})

test('Testing _checkTimeSynced method', async t => {
  // {
  t.equal(await p2p._checkTimeSynced(config.timeServer), true, 'should validate the timeSync verification with arimaa time server')
  // }
  t.end()
})

test('Testing _getSeedListSigned method', async t => {
  const localNode = { ip: '127.0.0.1', port: 9001 }
  const res = await p2p._getSeedListSigned()
  t.equal(Array.isArray(res.seedNodes), true, '_getSeedNodes should return an array type')
  t.notEqual(res.seedNodes.length, 0, 'the array should have at least one node in its list')
  t.deepEqual(res.seedNodes[0], localNode, 'should have a local node as the first element of the array list')
  t.equal(typeof res.sign, 'object', 'the sign property should be an object')
  t.equal(isValidHex(res.sign.owner), true, 'owner pk should be a valid hex')
  t.equal(isValidHex(res.sign.sig), true, 'signature should be a valid hex')
  t.end()
})

test('Testing getIpInfo method', async t => {
  t.deepEqual(p2p.getIpInfo(), config.ipInfo, 'should return the identical object from ipInfo')
  t.end()
})

// discorverNetwork is already tested in shardus module unit tests

// let nodeAddress
test('Testing _getThisNodeInfo', t => {
  const res = p2p._getThisNodeInfo()
  // nodeAddress = res.address
  const diff = (Math.floor(Date.now() / 1000)) - res.joinRequestTimestamp
  t.equal(typeof res.externalIp, 'string', 'externalIp should be a string')
  t.notEqual(isIP(res.externalIp), 0, 'externalIp should be a valid ip')
  t.equal(typeof res.externalPort, 'number', 'externalPort should be a number')
  t.equal(typeof res.internalIp, 'string', 'internalIp should be a string')
  t.notEqual(isIP(res.internalIp), 0, 'internalIp should be a valid ip')
  t.equal(typeof res.internalPort, 'number', 'internalPort should be a number')
  t.equal(diff > 10000, false, 'the difference of times should not be greater than 10s')
  if (confStorage) {
    confStorage.options.storage = 'db/db.sqlite'
    fs.writeFileSync(path.join(__dirname, `../../../config/storage.json`), JSON.stringify(confStorage, null, 2))
    clearTestDb()
  }
  t.end()
})
