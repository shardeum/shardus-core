const test = require('tap').test
const path = require('path')
const fs = require('fs')
const { isIP } = require('net')
const { spawn } = require('child_process')

const P2P = require('../../../src/p2p')
const Logger = require('../../../src/logger')
const Storage = require('../../../src/storage')
const Crypto = require('../../../src/crypto/index')
const ExitHandler = require('../../../src/exit-handler')

const { readLogFile, resetLogFile } = require('../../includes/utils-log')
const { sleep } = require('../../../src/utils')

let p2p
let config = require(path.join(__dirname, '../../../config/server.json'))
// increase the timeSync limit to avoid issues in the test
config.syncLimit = 10000
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

let exitHandler = new ExitHandler()
let logger = new Logger(path.resolve('./'), loggerConfig)
let storage = new Storage(
  exitHandler,
  logger,
  '../../../',
  { confFile: './config/storage.json' }
)
let crypto

test('Testing p2p constructor', async t => {
  await storage.init()
  crypto = new Crypto(logger, storage)
  await crypto.init()
  p2p = new P2P(config, logger, null, crypto)
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

test('Testing _getSeedNodes method', async t => {
  {
    const localNode = { ip: "127.0.0.1", port: 9001 }
    const res = await p2p._getSeedListSigned()
    t.equal(Array.isArray(res.seedNodes), true, '_getSeedNodes should return an array type')
    t.notEqual(res.seedNodes.length, 0, 'the array should have at least one node in its list')
    t.deepEqual(res.seedNodes[0], localNode, 'should have a local node as the first element of the array list')
  }

  t.end()
})

test('Testing getIpInfo method', async t => {
  t.deepEqual(p2p.getIpInfo(), config.ipInfo, 'should return the identical object from ipInfo')
  t.end()
})

test('Testing discoverNetwork method', async t => {
  resetLogFile('main')
  await p2p.discoverNetwork()
  const log = readLogFile('main')
  t.notEqual(log.includes('You are not the seed node!'), true, 'the discoverNetwork method should write this message in main log file, the seedNode port is 8080 and this instance has the port 9001')
  t.end()
})
