const test = require('tap').test
const path = require('path')
const fs = require('fs')
const { isIP } = require('net')
const { spawn } = require('child_process')

const P2P = require('../../../src/p2p')
const Logger = require('../../../src/logger')
const Storage = require('../../../src/storage')
const Crypto = require('../../../src/crypto/index')

const { readLogFile, resetLogFile } = require('../../includes/utils-log')
const { clearTestDb, createTestDb } = require('../../includes/utils-storage')
const { sleep } = require('../../../src/utils')
const { isValidHex } = require('../../includes/utils')

let p2p
let confStorage = module.require(`../../../config/storage.json`)
let config = require(path.join(__dirname, '../../../config/server.json'))
// increase the timeSync limit to avoid issues in the test
config.syncLimit = 100000
config.ipInfo = { externalIp: config.externalIp || null, externalPort: config.externalPort || null }

let configFilePath = path.join(__dirname, '../../../config/logs.json')
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
let newConfStorage = createTestDb(confStorage)
let storage = new Storage(
  logger,
  '../../../',
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
  {
    try {
      p2p._verifyIpInfo()
      t.fail('this call without args should not be allowed')
    } catch (e) {
      t.pass('should throw an error with no args passed')
    }
  }

  {
    try {
      p2p._verifyIpInfo({ externalIp: '127.0.0.1' })
      t.fail('this call without port should not be allowed')
    } catch (e) {
      t.pass('should throw an error with no property port passed')
    }
  }

  {
    const res = p2p._verifyIpInfo({ externalIp: '127.0.0.1', externalPort: 9001 })
    t.equal(res, true, 'should return true for a valid ip and port passed as parameter')
  }

  t.end()
})

test('Testing _retrieveIp method', async t => {
  {
    try {
      const res = await p2p._retrieveIp('http://google.com')
      t.fail('should not get an IP from google')
    } catch (e) {
      t.pass('should throw an error for an invalid ip server')
    }
  }

  {
     const res = await p2p._retrieveIp(config.ipServer)
     t.notEqual(isIP(res), 0, 'should return a valid ip from ipServer')
  }
  t.end()
})

test('Testing _checkTimeSynced method', async t => {
  {
    t.equal(await p2p._checkTimeSynced(config.timeServer), true, 'should validate the timeSync verification with arimaa time server')
  }
  t.end()
})

test('Testing _getSeedListSigned method', async t => {
  const localNode = { ip: "127.0.0.1", port: 9001 }
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

let nodeAddress
test('Testing _getThisNodeInfo', t => {
  const res = p2p._getThisNodeInfo()
  nodeAddress = res.address
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

// TODO: move this kind of test to shardus module
// test('Testing getCycleMarkerInfo', async t => {
//   await sleep(Math.ceil(p2p.state.cycleDuration * 0.75) * 1000)
//   p2p.state.stopCycles()
//   const res = p2p.getCycleMarkerInfo()
//   const diff = Date.now() - res.currentTime
//   t.equal(isValidHex(res.cycleMarker), true, 'cycleMarker should be a valid hex')
//   t.equal(Array.isArray(res.joined), true, 'joined should be an array')
//   t.equal(res.joined.length, 1, 'should have at least one joined node')
//   t.equal(isValidHex(res.joined[0]), true, 'the element 0 of the joined array should be a hex value')
//   t.equal(res.joined[0], nodeAddress, 'the joined node address should be equals to the address of the inserted node')
//   t.equal(isNaN(Number(res.currentTime)), false, 'the currentTime should be a valid time value')
//   t.equal(diff > 10000, false, 'the difference of times should not be greater than 10s')
//   t.end()
// })

// TODO: move the _createJoinRequest to an e2e tests since requires a spwaned seedNode to be up to request cycleMarkers

// test('Testing _createJoinRequest method', async t => {
//   let joinRequest = await p2p._createJoinRequest()
  // t.match(joinRequest, {
  //   nodeInfo: {
  //     externalIp: /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/,
  //     externalPort: /\d+/,
  //     internalIp: /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/,
  //     internalPort: /\d+/,
  //     publicKey: /[0-9a-fA-F]+/
  //   },
  //   cycleMarker: /[0-9a-fA-F]+/,
  //   proofOfWork: {
  //     compute: {
  //       hash: /[0-9a-fA-F]+/,
  //       nonce: /[0-9a-fA-F]+/
  //     }
  //   },
  //   selectionNum: /[0-9a-fA-F]+/,
  //   signedSelectionNum: {
  //     selectionNum: /[0-9a-fA-F]+/,
  //     sign: {
  //       owner: /[0-9a-fA-F]+/,
  //       sig: /[0-9a-fA-F]+/
  //     }
  //   }
  // }, 'joinRequest should have all expected properties')
//   t.end()
// })
//
//
// test('Testing _createJoinRequest method', async t => {
//   let joinRequest = await p2p._createJoinRequest()
//   t.match(joinRequest, {
//     externalIp: /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/,
//     externalPort: /\d+/,
//     internalIp: /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/,
//     internalPort: /\d+/,
//     publicKey: /[0-9a-fA-F]+/,
//     cycleMarker: /[0-9a-fA-F]+/,
//     nonce: /[0-9a-fA-F]+/,
//     selectionNum: /[0-9a-fA-F]+/,
//     signedSelectionNum: {
//       selectionNum: /[0-9a-fA-F]+/,
//       sign: {
//         owner: /[0-9a-fA-F]+/,
//         sig: /[0-9a-fA-F]+/
//       }
//     }
//   }, 'joinRequest should have all expected properties')
//
//   t.end()
// })
