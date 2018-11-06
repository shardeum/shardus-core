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

  _checkWithinSyncLimit (time1, time2) {
    let timeDif = Math.abs(time1 - time2)
    if (timeDif > this.syncLimit) {
      return false
    }
    return true
  }

  // TODO: add way to compare time from major server head requests like google.com
  async _checkTimeSynced (timeServer) {
    const localTime = utils.getTime('s')
    let timestamp = await http.get(timeServer)
    return this._checkWithinSyncLimit(localTime, timestamp)
  }

  async _getSeedListSigned () {
    let seedListSigned = await http.get(this.seedList)
    return seedListSigned
  }

  async _getSeedNodes () {
    let seedListSigned = await this._getSeedListSigned()
    if (!this.crypto.verify(seedListSigned, this.netadmin)) throw Error('Fatal: Seed list was not signed by specified netadmin!')
    return seedListSigned.seedNodes

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

  async _ensureExternalIp () {
    if (!this._verifyIpInfo(this.getIpInfo())) {
      this.ipInfo.externalIp = await this._retrieveIp(this.ipServer)
    }
  }

  async _checkRejoin () {
    const currExternIp = this.getIpInfo().externalIp
    const currExternPort = this.getIpInfo().externalPort
    const dbExternIp = await this.storage.getProperty('externalIp')
    const dbExternPort = await this.storage.getProperty('externalPort')

    // Check if our external network info matches what's in the database, otherwise we need to rejoin
    if (currExternIp !== dbExternIp || currExternPort !== dbExternPort) return true

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
    // Create a join request which contains a valid proof-of-work.
    let joinRequest = await this._createJoinRequest()
    this.state.addJoinRequest(joinRequest)
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

  async _createJoinRequest () {
    // The server makes a /get_cycle_marker request.
    const seedNodes = await this._getSeedNodes()
    try {
      var { cycleMarker, currentTime } = await this._getNetworkCycleMarker(seedNodes)
    } catch (e) {
      throw new Error(e)
    }
    let difficulty = 16
    // Checks that the time difference is within syncLimit (as configured).
    const localTime = utils.getTime('s')
    this._checkWithinSyncLimit(localTime, currentTime)
    // Build and return a join request
    let nodeInfo = this._getThisNodeInfo()
    delete nodeInfo.joinRequestTimestamp
    delete nodeInfo.address
    let selectionNum = this.crypto.hash({ cycleMarker, publicKey: nodeInfo.publicKey })
    let signedSelectionNum = this.crypto.sign({ selectionNum })
    let proofOfWork = {
      compute: await this.crypto.getComputeProofOfWork(cycleMarker, difficulty)
    }
    return {
      // TODO: add a version number at some point
      // version: '0.0.0',
      nodeInfo,
      cycleMarker,
      proofOfWork,
      selectionNum,
      signedSelectionNum
    }
  }

  async discoverNetwork () {
    // Check if our time is synced to network time server
    let timeSynced = await this._checkTimeSynced(this.timeServer)
    if (!timeSynced) throw new Error('Local time out of sync with time server.')
    
    // Make sure we know our external IP
    await this._ensureExternalIp()

    // Check if we are first seed node
    const seedNodes = await this._getSeedNodes()
    const isFirstSeed = this._checkIfFirstSeedNode(seedNodes)
    if (isFirstSeed) {
      this.mainLogger.info('You are the first seed node!')
    } else {
      this.mainLogger.info('You are not the first seed node...')
    }

    // Check if we need to rejoin
    const rejoin = await this._checkRejoin()
    if (rejoin) {
      this.mainLogger.info('Server needs to rejoin...')
      this.mainLogger.debug('Clearing P2P state...')
      await this.state.clear()
      await this.storage.setProperty('externalIp', this.getIpInfo().externalIp)
      await this.storage.setProperty('externalPort', this.getIpInfo().externalPort)
      if (isFirstSeed) {
        this.mainLogger.debug('Rejoining network...')
        this.state.startCycles()
        this.state.addJoinRequest(this._getThisNodeInfo())
        return true
      }
      const joined = await this._attemptJoin()
      if (!joined) return false
      return true
    }
    // If we made it this far, we need to sync to the network

    // TODO: need to make it robust when resync implemented,
    // ---   currently system would never resync if we were only
    // ---   seed node in the network

    // If you are first node, there is nothing to sync to
    if (isFirstSeed) {
      this.mainLogger.debug('No rejoin required, starting new cycle...')
      this.state.startCycles()
      return true
    }

    // If not first seed, we need to sync to network
    this.mainLogger.debug('Syncing to network...')
    // TODO: add resyncing
    return false
  }
}

module.exports = P2P
