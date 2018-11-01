const utils = require('../utils')
const http = require('../http')

class P2P {
  constructor (config, logger, state, crypto) {
    this.mainLogger = logger.getLogger('main')
    this.state = state
    this.crypto = crypto
    this.ipInfo = config.ipInfo
    this.ipServer = config.ipServer
    this.timeServer = config.timeServer
    this.seedList = config.seedList
    this.syncLimit = config.syncLimit
    this.netadmin = config.netadmin
    this.joinRequests = []
  }

  _verifyIpInfo (ipInfo) {
    if (!ipInfo.externalIp) {
      return false
    }
    if (!ipInfo.externalPort) {
      throw Error('No port specified, unable to start server.')
    }
    return true
  }

  async _retrieveIp (ipServer) {
    let { ip } = await http.get(ipServer)
    console.log(ip)
    return ip
  }

  async _checkTimeSynced (timeServer) {
    const localTime = utils.getTime('s')
    let timestamp = await http.get(timeServer)
    let timeDif = Math.abs(localTime - timestamp)
    if (timeDif > this.syncLimit) {
      return false
    }
    return true
  }

  async _getSeedListSigned () {
    let seedListSigned = await http.get(this.seedList)
    return seedListSigned
  }

  getIpInfo () {
    return this.ipInfo
  }

  async discoverNetwork () {
    let timeSynced = await this._checkTimeSynced(this.timeServer)
    if (!timeSynced) throw Error('Local time out of sync with time server.')
    if (!this._verifyIpInfo(this.getIpInfo())) {
      this.ipInfo.externalIp = await this._retrieveIp(this.ipServer)
    }
    let seedListSigned = await this._getSeedListSigned()
    if (!this.crypto.verify(seedListSigned, this.netadmin)) throw Error('Fatal: Seed list was not signed by specified netadmin!')
    const seedNodes = seedListSigned.seedNodes
    if (seedNodes.length === 1) {
      let seed = seedNodes[0]
      let { externalIp, externalPort } = this.getIpInfo()
      if (externalIp === seed.ip && externalPort === seed.port) {
        this.mainLogger.info('You are the seed node!')
        return
      }
      this.mainLogger.info('You are not the seed node!')
    }
  }
}

module.exports = P2P
