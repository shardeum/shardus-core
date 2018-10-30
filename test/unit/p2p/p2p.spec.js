const test = require('tap').test
const path = require('path')
const fs = require('fs')
const { isIP } = require('net')
const { spawn } = require('child_process')

const P2P = require('../../../src/p2p')
const Logger = require('../../../src/logger')
const Storage = require('../../../src/storage')

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

let storage = new Storage({ dbDir: __dirname + '../../../../src/storage/', dbName: 'db.sqlite3' })
let logger = new Logger(path.resolve('./'), loggerConfig)

test('Testing p2p constructor', async t => {
  p2p = new P2P(config, logger, storage)
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
    const localNode = { ip: "127.0.0.1", port: 8080 }
    const res = await p2p._getSeedNodes()
    t.equal(Array.isArray(res), true, '_getSeedNodes should return an array type')
    t.notEqual(res.length, 0, 'the array should have at least one node in its list')
    t.deepEqual(res[0], localNode, 'should have a local node as the first element of the array list')
  }

  t.end()
})

test('Testing addNode and getNodes method', async t => {
  const localNode = { id: 'mysecretkey', ip: "127.0.0.1", port: 8081 }
  // testing addNode
  {
    const res = await p2p.addNode(localNode)
    t.equal(res, true, 'should add the node correctly')
  }

  // testing getNodes
  {
    const res = await p2p.getNodes()
    t.equal(res.includes(localNode), true, 'should include the added node')
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
  t.equal(log.includes('You are not the seed node!'), true, 'the discoverNetwork method should write this message in main log file, the seedNode port is 8080 and this instance has the port 9001')
  t.end()
})
