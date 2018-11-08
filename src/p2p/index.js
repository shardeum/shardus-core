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
    this.maxRejoinTime = config.maxRejoinTime
    this.netadmin = config.netadmin || 'default'
    this.state = new P2PState(config, this.logger, this.storage, this.crypto)
  }

  async init () {
    await this.state.init()
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

  // TODO: add way to compare time from major server head requests like google.com
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

  getLatestCycles (amount) {
    const cycles = this.state.getCycles(amount)
    return cycles
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

  async _checkRejoin () {
    const currentTime = utils.getTime('s')
    const lastHeartbeat = await this.storage.getProperty('heartbeat') || 0
    // If time since last heartbeat is greater than the max rejoin time, we have to rejoin
    if (currentTime - lastHeartbeat > this.maxRejoinTime) {
      return true
    }
    // TODO: Check if we are in nodeslist (requires ID)
    return false
  }

  // TODO: add actual join procedure
  // ---   Whatever this function calls from state needs to find from network
  // ---   when it is joined, should start syncing, then it can call startCycles()
  async _attemptJoin () {
    // this.state.addJoinRequest()
    // return true
    this.mainLogger.debug('This is where you would try to join...')
    return false
  }

  async _getSeedNodes () {
    const seedListSigned = await this._getSeedListSigned()
    if (!this.crypto.verify(seedListSigned, this.netadmin)) throw Error('Fatal: Seed list was not signed by specified netadmin!')
    const seedNodes = seedListSigned.seedNodes
    return seedNodes
  }

  // TODO: Think about exception when there is more than
  // ----- one seed node in seed list, but you are still a seednode
  _checkIfFirstSeedNode (seedNodes) {
    if (!seedNodes.length) throw new Error('Fatal: No seed nodes in seed list!')
    if (seedNodes.length > 1) return false
    const seed = seedNodes[0]
    const { externalIp, externalPort } = this.getIpInfo()
    if (externalIp === seed.ip && externalPort === seed.port) {
      return true
    }
    return false
  }

  async discoverNetwork () {
    let timeSynced = await this._checkTimeSynced(this.timeServer)
    if (!timeSynced) throw new Error('Local time out of sync with time server.')

    let needsFreshJoin = false
    let needsResync = false
    let needsFetchIp = false

    // Check if we need to rejoin
    const dbExternIp = await this.storage.getProperty('externalIp')
    const dbExternPort = await this.storage.getProperty('externalPort')

    const rejoin = await this._checkRejoin()
    if (rejoin) {
      this.mainLogger.info('Server needs to rejoin...')
      needsFreshJoin = true
    } else {
      if (!this._verifyIpInfo(this.getIpInfo())) {
        if (dbExternIp && dbExternPort) {
          needsResync = true
        } else {
          needsFetchIp = true
          needsFreshJoin = true
        }
      } else {
        const currExternIp = this.getIpInfo().externalIp
        const currExternPort = this.getIpInfo().externalPort
        if (currExternIp !== dbExternIp || currExternPort !== dbExternPort) {
          needsFreshJoin = true
        } else {
          needsResync = true
        }
      }
    }
    if (needsFreshJoin) {
      this.mainLogger.debug('Clearing P2P state...')
      await this.state.clear()
    }
    if (needsFetchIp) {
      this.ipInfo.externalIp = await this._retrieveIp(this.ipServer)
    }
    if (!dbExternIp) await this.storage.setProperty('externalIp', this.getIpInfo().externalIp)
    if (!dbExternPort) await this.storage.setProperty('externalPort', this.getIpInfo().externalPort)

    const seedNodes = await this._getSeedNodes()
    const isFirstSeed = this._checkIfFirstSeedNode(seedNodes)
    // TODO: need to make it robust when resync implemented,
    // ---   currently system would never resync if we were only
    // ---   seed node in the network
    if (isFirstSeed) {
      this.mainLogger.info('You are the first seed node!')
      if (needsFreshJoin) {
        this.mainLogger.debug('Rejoining network...')
        this.state.addJoinRequest(this._getThisNodeInfo())
      } else {
        this.mainLogger.debug('No rejoin required, starting new cycle...')
      }
      this.state.startCycles()
      return true
    }
    if (needsResync) {
      this.mainLogger.debug('Resyncing to network...')
      // TODO: await resync
      // this.state.startCycles()
      // TODO: Change this only to return false if resync fails
      return false
    }
    const joined = await this._attemptJoin()
    if (!joined) return false
    return true
  }
}

module.exports = P2P
