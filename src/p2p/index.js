const utils = require('../utils')
const http = require('../http')
const P2PState = require('./p2p-state')

class P2P {
  constructor (config, logger, storage, crypto) {
    this.logger = logger
    this.mainLogger = logger.getLogger('main')
    this.storage = storage
    this.crypto = crypto
    this.ipInfo = config.ipInfo
    this.ipServer = config.ipServer
    this.timeServer = config.timeServer
    this.seedList = config.seedList
    this.syncLimit = config.syncLimit
    this.netadmin = config.netadmin || 'default'
    this.state = new P2PState(this.logger, this.crypto, this.storage)
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
    this.mainLogger.debug(`Retrieved IP: ${ip}`)
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

  getCycleMarkerInfo () {
    const cycleMarker = this.state.getLastCycleMarker()
    const joined = this.state.getLastJoined()
    const currentTime = utils.getTime()
    const info = { cycleMarker, joined, currentTime }
    this.mainLogger.debug(`Requested cycle marker info: ${JSON.stringify(info)}`)
    return info
  }

  _getThisNodeInfo () {
    const { externalIp, externalPort } = this.getIpInfo()
    // TODO: add actual internal IP and port
    const internalPort = externalPort
    const internalIp = externalIp
    const publicKey = this.crypto.getPublicKey()
    // TODO: Change this to actual selectable address
    const address = publicKey
    // TODO: Incorporate joinRequestTimestamps
    const joinRequestTimestamp = utils.getTime()
    const nodeInfo = { publicKey, externalIp, externalPort, internalIp, internalPort, joinRequestTimestamp, address }
    this.mainLogger.debug(`Node info of this node: ${JSON.stringify(nodeInfo)}`)
    return nodeInfo
  }

  async discoverNetwork () {
    let timeSynced = await this._checkTimeSynced(this.timeServer)
    if (!timeSynced) throw new Error('Local time out of sync with time server.')
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
        const thisNode = this._getThisNodeInfo()
        this.mainLogger.info('Adding this node to node list.')
        this.state.addJoinRequest(thisNode)
        this.mainLogger.info('Creating first cycle marker...')
        // TODO: Make this happen on a given interval, or make this function call itself on a timer
        this.state.createCycle()
        return
      }
      this.mainLogger.info('You are not the seed node!')
    }
  }
}

module.exports = P2P
