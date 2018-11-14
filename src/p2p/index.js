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
    this.difficulty = config.difficulty
    this.queryDelay = config.queryDelay
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

  _getNetworkCycleMarker (nodes) {
    // TODO: verify cycle marker from multiple nodes
    let node = nodes[0]
    this.mainLogger.debug(`Node to be asked for cycle marker: ${JSON.stringify(node)}`)
    return http.get(`${node.ip}:${node.port}/cyclemarker`)
  }

  getIpInfo () {
    return this.ipInfo
  }

  getCycleMarkerInfo () {
    const currentCycleMarker = this.state.getCurrentCycleMarker()
    const nextCycleMarker = this.state.getNextCycleMarker()
    const cycleStart = this.state.getCurrentCycleStart()
    const cycleDuration = this.state.getCurrentCycleDuration()
    const nodesJoined = this.state.getLastJoined()
    const currentTime = utils.getTime('s')
    const info = { currentCycleMarker, nextCycleMarker, cycleStart, cycleDuration, nodesJoined, currentTime }
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
    const joinRequestTimestamp = utils.getTime('s')
    const nodeInfo = { publicKey, externalIp, externalPort, internalIp, internalPort, address, joinRequestTimestamp }
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

  async _submitJoin (nodes, joinRequest) {
    const node = nodes[0]
    this.mainLogger.debug(`Sending join request to ${node.ip}:${node.port}`)
    await http.post(`${node.ip}:${node.port}/join`, joinRequest)
  }

  async _checkJoined (seedNodes) {
    // TODO: implement a more robust way to choose a node
    const { nodesJoined } = await this._getNetworkCycleMarker(seedNodes)
    this.mainLogger.debug(`Nodes joined in this cycle: ${JSON.stringify(nodesJoined)}`)
    const { publicKey } = this._getThisNodeInfo()
    for (const key of nodesJoined) {
      if (key === publicKey) return true
    }
    return false
  }

  async _waitUntilJoinPhase (currentTime, cycleStart, cycleDuration) {
    this.mainLogger.debug(`Current time is: ${currentTime}`)
    this.mainLogger.debug(`Current cycle started at: ${cycleStart}`)
    this.mainLogger.debug(`Current cycle duration: ${cycleDuration}`)
    const nextJoinStart = cycleStart + cycleDuration
    this.mainLogger.debug(`Next join cycle starts at: ${nextJoinStart}`)
    const timeToWait = (nextJoinStart - currentTime + this.queryDelay) * 1000
    this.mainLogger.debug(`Waiting for ${timeToWait} ms before next join phase...`)
    await utils.sleep(timeToWait)
  }

  async _waitUntilCycleMarker (currentTime, cycleStart, cycleDuration) {
    const cycleMarker = cycleStart + cycleDuration + (2 * Math.ceil(cycleDuration / 4))
    let timeToWait
    if (currentTime < cycleMarker) {
      timeToWait = (cycleMarker - currentTime + this.queryDelay) * 1000
    } else {
      timeToWait = 0
    }
    this.mainLogger.debug(`Waiting for ${timeToWait} ms before next cycle marker creation...`)
    await utils.sleep(timeToWait)
  }

  async _attemptJoin (seedNodes, joinRequest, timeOffset, cycleStart, cycleDuration) {
    // TODO: check if we missed join phase
    const currTime1 = utils.getTime('s') + timeOffset
    await this._waitUntilJoinPhase(currTime1, cycleStart, cycleDuration)
    await this._submitJoin(seedNodes, joinRequest)
    const currTime2 = utils.getTime('s') + timeOffset
    await this._waitUntilCycleMarker(currTime2, cycleStart, cycleDuration)
    const joined = await this._checkJoined(seedNodes)
    return joined
  }

  async _join () {
    const seedNodes = await this._getSeedNodes()
    const localTime = utils.getTime('s')
    const { currentTime } = await this._getNetworkCycleMarker(seedNodes)
    if (!this._checkWithinSyncLimit(localTime, currentTime)) throw Error('Local time out of sync with network.')
    const timeOffset = currentTime - localTime
    this.mainLogger.debug(`Time offset with selected node: ${timeOffset}`)
    let joined = false
    while (!joined) {
      const { currentCycleMarker, nextCycleMarker, cycleStart, cycleDuration } = await this._getNetworkCycleMarker(seedNodes)
      if (nextCycleMarker) {
        // Use next cycle marker
        const joinRequest = await this._createJoinRequest(nextCycleMarker)
        joined = await this._attemptJoin(seedNodes, joinRequest, timeOffset, cycleStart, cycleDuration)
        if (!joined) {
          const { cycleStart, cycleDuration } = await this._getNetworkCycleMarker(seedNodes)
          joined = await this._attemptJoin(seedNodes, joinRequest, timeOffset, cycleStart, cycleDuration)
        }
      } else {
        const joinRequest = await this._createJoinRequest(currentCycleMarker)
        joined = await this._attemptJoin(seedNodes, joinRequest, timeOffset, cycleStart, cycleDuration)
      }
    }
    return joined
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

  async _createJoinRequest (cycleMarker) {
    // Build and return a join request
    let nodeInfo = this._getThisNodeInfo()
    let selectionNum = this.crypto.hash({ cycleMarker, address: nodeInfo.address })
    // let signedSelectionNum = this.crypto.sign({ selectionNum })
    let proofOfWork = {
      compute: await this.crypto.getComputeProofOfWork(cycleMarker, this.difficulty)
    }
    // TODO: add a version number at some point
    // version: '0.0.0'
    const joinReq = { nodeInfo, cycleMarker, proofOfWork, selectionNum }
    const signedJoinReq = this.crypto.sign(joinReq)
    this.mainLogger.debug(`Join request created... Join request: ${JSON.stringify(signedJoinReq)}`)
    return signedJoinReq
  }

  _validateJoinRequest (joinRequest) {
    // TODO: implement actual validation
    return true
  }

  addJoinRequest (joinRequest) {
    const valid = this._validateJoinRequest(joinRequest)
    if (!valid) return false
    return this.state.addJoinRequest(joinRequest)
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
        const joinRequest = await this._createJoinRequest()
        this.state.addJoinRequest(joinRequest)
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
      const joinRequest = await this._createJoinRequest()
      this.state.addJoinRequest(joinRequest)
      return true
    }

    // If not first seed, we need to sync to network
    this.mainLogger.debug('Syncing to network...')
    // TODO: add resyncing
    return false
  }
}

module.exports = P2P
