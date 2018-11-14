const path = require('path')
const fs = require('fs')

const P2P = require('../../src/p2p')
const Logger = require('../../src/logger')
const Storage = require('../../src/storage')
const Crypto = require('../../src/crypto/index')

const { clearTestDb, createTestDb } = require('../includes/utils-storage')

let p2p
let confStorage = module.require(`../../config/storage.json`)
let config = require(path.join(__dirname, '../../config/server.json'))
// increase the timeSync limit to avoid issues in the test
config.syncLimit = 100000
config.ipInfo = { externalIp: config.externalIp || null, externalPort: config.externalPort || null }

let configFilePath = path.join(__dirname, '../../config/logs.json')
let loggerConfig = {
  dir: '/logs',
  confFile: '/config/logs.json',
  files: {
    main: 'main.log',
    fatal: 'fatal.log',
    net: 'net.log'
  }
}

let newConfStorage = createTestDb(confStorage)

function getInstances (loggerConf = null, externalPort = null) {
  return new Promise(async (resolve) => {
    let logger = new Logger(path.resolve('./'), loggerConf || loggerConfig)
    let storage = new Storage(
      logger,
      '../../../',
      { confFile: './config/storage.json' }
    )
    config.externalPort = externalPort || config.externalPort
    let ipInfo = { externalIp: config.externalIp || null, externalPort: config.externalPort || null }
    config.ipInfo = ipInfo
    await storage.init()
    let crypto = new Crypto(logger, storage)
    await crypto.init()
    p2p = new P2P(config, logger, storage, crypto)
    resolve({
      storage,
      logger,
      storage,
      crypto,
      p2p,
      newConfStorage
    })
  })
}

exports.getInstances = getInstances
