const express = require('express')
const bodyParser = require('body-parser')
const Logger = require('../logger')
const ExitHandler = require('../exit-handler')
const P2P = require('../p2p')
const Crypto = require('../crypto')
const Storage = require('../storage')

class Shardus {
  constructor (config) {
    this.externalPort = config.externalPort || 8080

    this.logger = new Logger(config.baseDir, config.log)
    this.mainLogger = this.logger.getLogger('main')
    this.fatalLogger = this.logger.getLogger('fatal')
    this.exitHandler = new ExitHandler()
    this.storage = new Storage(this.exitHandler, this.logger, config.baseDir, config.storage)
    this.app = express()
    this.crypto = {}
    this.p2p = {}

    this.exitHandler.addSigListeners()
    this.exitHandler.registerAsync('logger', () => {
      return this.logger.shutdown()
    })
  }

  _setupExternalApi (app) {
    return new Promise((resolve, reject) => {
      app.use(bodyParser.json())

      app.post('/exit', async (req, res) => {
        res.json({ success: true })
        await this.shutdown()
      })

      app.get('/cyclemarker', (req, res) => {
        const cycleMarkerInfo = this.p2p.getCycleMarkerInfo()
        res.json(cycleMarkerInfo)
      })

      app.get('/cyclechain', (req, res) => {
        const cycleChain = this.p2p.getLatestCycles(10)
        res.json({ cycleChain })
      })

      app.listen(this.externalPort, () => {
        const msg = `Server running on port ${this.externalPort}...`
        console.log(msg)
        this.mainLogger.info(msg)
        resolve()
      })
    })
  }

  registerExceptionHandler () {
    process.on('uncaughtException', (err) => {
      this.fatalLogger.fatal(err.message)
      this.exitHandler.exitCleanly()
    })
  }

  async setup (config) {
    await this.storage.init()
    this.crypto = new Crypto(this.logger, this.storage)
    await this.crypto.init()

    let { ipServer, timeServer, seedList, syncLimit, netadmin, cycleDuration } = config
    let ipInfo = { externalIp: config.externalIp || null, externalPort: config.externalPort || null }
    let p2pConf = { ipInfo, ipServer, timeServer, seedList, syncLimit, netadmin, cycleDuration }
    this.p2p = new P2P(p2pConf, this.logger, this.storage, this.crypto)
    await this._setupExternalApi(this.app)
    await this.p2p.discoverNetwork()
  }

  async shutdown () {
    await this.exitHandler.exitCleanly()
  }
}

module.exports = Shardus
