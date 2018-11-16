const Logger = require('../logger')
const ExitHandler = require('../exit-handler')
const P2P = require('../p2p')
const Crypto = require('../crypto')
const Storage = require('../storage')
const Network = require('../network')
const utils = require('../utils')

class Shardus {
  constructor (config) {
    this.logger = new Logger(config.baseDir, config.log)
    this.mainLogger = this.logger.getLogger('main')
    this.fatalLogger = this.logger.getLogger('fatal')
    this.exitHandler = new ExitHandler()
    this.storage = new Storage(this.logger, config.baseDir, config.storage)
    this.crypto = {}
    this.network = new Network(this.logger)
    this.p2p = {}

    this.heartbeatInterval = config.heartbeatInterval
    this.heartbeatTimer = null

    this.exitHandler.addSigListeners()
    this.exitHandler.registerSync('shardus', () => {
      this.stopHeartbeat()
    })
    this.exitHandler.registerSync('crypto', () => {
      this.crypto.stopAllGenerators()
    })
    this.exitHandler.registerAsync('shardus', () => {
      this.mainLogger.info('Writing heartbeat to database before exiting...')
      return this.writeHeartbeat()
    })
    this.exitHandler.registerAsync('storage', () => {
      return this.storage.close()
    })
    this.exitHandler.registerAsync('logger', () => {
      return this.logger.shutdown()
    })
  }

  _registerRoutes () {
    this.network.registerExternalPost('exit', async (req, res) => {
      res.json({ success: true })
      await this.shutdown()
    })
  }

  registerExceptionHandler () {
    process.on('uncaughtException', async (err) => {
      this.fatalLogger.fatal(err)
      try {
        await this.exitHandler.exitCleanly()
      } catch (e) {
        console.error(e)
        process.exit(1)
      }
    })
  }

  async writeHeartbeat () {
    const timestamp = utils.getTime('s')
    await this.storage.setProperty('heartbeat', timestamp)
  }

  _setupHeartbeat () {
    this._heartbeatTimer = setInterval(async () => {
      await this.writeHeartbeat()
    }, this.heartbeatInterval * 1000)
  }

  stopHeartbeat () {
    this.mainLogger.info('Stopping heartbeat...')
    clearInterval(this.heartbeatTimer)
  }

  async setup (config) {
    await this.storage.init()
    this._setupHeartbeat()
    this.crypto = new Crypto(this.logger, this.storage)
    await this.crypto.init()
    const { ipServer, timeServer, seedList, syncLimit, netadmin, cycleDuration, maxRejoinTime, difficulty, queryDelay } = config
    const ipInfo = config.network
    const p2pConf = { ipInfo, ipServer, timeServer, seedList, syncLimit, netadmin, cycleDuration, maxRejoinTime, difficulty, queryDelay }
    this.p2p = new P2P(p2pConf, this.logger, this.storage, this.crypto, this.network)
    await this.p2p.init()
    this._registerRoutes()
    let joinedNetwork
    try {
      joinedNetwork = await this.p2p.discoverNetwork()
    } catch (e) {
      throw new Error(e)
    }
    if (!joinedNetwork) await this.shutdown()
  }

  async shutdown () {
    try {
      await this.exitHandler.exitCleanly()
    } catch (e) {
      throw e
    }
  }
}

module.exports = Shardus
