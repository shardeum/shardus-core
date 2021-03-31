import util from 'util'
import { EventEmitter } from 'events'
import Sntp from '@hapi/sntp'
import * as utils from '../utils'
import * as http from '../http'
import P2PState = require('./p2p-state')
import P2PLostNodes from './p2p-lost-nodes'
import P2PArchivers from './p2p-archivers'
import routes from './routes'

import * as P2PContext from './Context'
import * as P2PApoptosis from './Apoptosis'
import * as Sync from './Sync'
import * as GlobalAccounts from './GlobalAccounts'
import { robustQuery } from './Utils'
import {logFlags} from '../logger'

class P2P extends EventEmitter {
  logger: any
  mainLogger: any
  fatalLogger: any
  storage: any
  crypto: any
  network: any
  ipInfo: any
  id: any
  ipServer: any
  timeServers: any
  existingArchivers: any
  syncLimit: any
  maxRejoinTime: any
  difficulty: any
  queryDelay: any
  minNodesToAllowTxs: any
  archiverActiveNodes: any
  isFirstSeed: boolean
  acceptInternal: boolean
  scalingRequested: boolean
  gossipHandlers: {}
  gossipRecipients: any
  gossipTimeout: number
  gossipedHashes: Map<any, any>
  gossipedHashesSent: Map<any, any>
  joinRequestToggle: boolean
  
  state: P2PState & EventEmitter
  lostNodes: P2PLostNodes
  archivers: P2PArchivers
  InternalRecvCounter: number
  keyCounter: number
  constructor(config, logger, storage, crypto) {
    super()
    this.logger = logger
    this.mainLogger = logger.getLogger('main')
    this.fatalLogger = this.logger.getLogger('fatal')
    this.storage = storage
    this.crypto = crypto
    this.network = null
    this.ipInfo = config.ipInfo
    this.id = null
    this.ipServer = config.ipServer
    this.timeServers = config.timeServers
    this.existingArchivers = config.existingArchivers
    this.syncLimit = config.syncLimit
    this.maxRejoinTime = config.maxRejoinTime
    this.difficulty = config.difficulty
    this.queryDelay = config.queryDelay
    this.minNodesToAllowTxs = config.minNodesToAllowTxs
    this.archiverActiveNodes = null
    this.isFirstSeed = false
    this.acceptInternal = false

    this.scalingRequested = false

    this.gossipHandlers = {}
    this.gossipRecipients = config.gossipRecipients
    this.gossipTimeout = config.gossipTimeout * 1000
    this.gossipedHashes = new Map()
    this.gossipedHashesSent = new Map() // TODO Perf: both of these lists need some eventual cleaning.  Perferably keep a sorted list also and periodically remove expired messages from the map and list

    this.joinRequestToggle = false

    this.state = new P2PState(
      config,
      this.logger,
      this.storage,
      this,
      this.crypto
    ) as P2PState & EventEmitter

    this.state.on('removed', () => {
      this.emit('removed')
    })
    this.state.on('newCycle', () => {
      this.scalingRequested = false
    })

    // Init lost node detection
    this.lostNodes = new P2PLostNodes(
      this.logger,
      this,
      this.state,
      this.crypto
    )
    this.state.initLost(this.lostNodes)

    this.state.on('cycle_q1_start', () => {
      this.lostNodes.proposeLost()
    })
    this.state.on('cycle_q3_start', () => {
      this.lostNodes.applyLost()
    })

    // Init saving archiver nodes into cycles
    this.archivers = new P2PArchivers(
      this.logger,
      this,
      this.state,
      this.crypto
    )

    this.state.on('removed', () => {
      this.archivers.reset()
    })

    this.state.on('cycle_q3_start', () => {
      const joinRequests = this.archivers.getArchiverUpdates()
      for (const joinRequest of joinRequests) {
        this.state.addArchiverUpdate(joinRequest)
      }
    })

    this.state.on('syncedCycle', cycle => {
      this.archivers.updateArchivers(cycle.joinedArchivers)
    })

    this.state.on('newCycle', cycles => {
      const cycle = cycles[cycles.length - 1]
      this.archivers.updateArchivers(cycle.joinedArchivers)
      this.archivers.sendData(cycle)
      this.archivers.resetJoinRequests()
    })

    this.InternalRecvCounter = 0
    this.keyCounter = 0
  }

  async init(network) {
    // Make sure we know our external IP
    await this._ensureIpKnown()

    // Load ID from database
    const id = await this.storage.getProperty('id')
    if (id) this._setNodeId(id, false)

    // Set up the network after we are sure we have our current IP info
    this.network = network
    await this.network.setup(this.getIpInfo())
    const reportLost = async node => {
      if (!this.isActive()) return
      await this._reportLostNode(node)
    }
    this.network.on('timeout', reportLost)
    this.network.on('error', reportLost)
    this._registerRoutes()
  }

  // getActiveNodes(self) {
  //   //return this.state.getActiveNodes(self) 
  //   this
  //   if (id) {
  //     return Object.values(NodeList.activeOthersByIdOrder)
  //   } else {
  //     return Object.values(NodeList.activeByIdOrder)
  //   }
  // }


  _registerRoutes() {
    // NO LONGER NEED THESE
    /*
    routes.register(this)
    this.lostNodes.registerRoutes()
    this.archivers.registerRoutes()
    for (const route of P2PApoptosis.internalRoutes) {
      this.registerInternal(route.name, route.handler)
    }
    for (const route of P2PApoptosis.gossipRoutes) {
      this.registerGossipHandler(route.name, route.handler)
    }
    for (const route of Sync.externalRoutes) {
      this.network._registerExternal(route.method, route.name, route.handler)
    }
    for (const route of GlobalAccounts.internalRoutes) {
      this.registerInternal(route.name, route.handler)
    }
    for (const route of GlobalAccounts.gossipRoutes) {
      this.registerGossipHandler(route.name, route.handler)
    }
    */
  }

  _verifyExternalInfo(ipInfo) {
    if (!ipInfo.externalIp) {
      return false
    }
    if (!ipInfo.externalPort) {
      throw Error('Fatal: No external port specified, unable to start server.')
    }
    return true
  }

  _verifyInternalInfo(ipInfo) {
    if (!ipInfo.internalIp) {
      return false
    }
    if (!ipInfo.internalPort) {
      throw Error('Fatal: No internal port specified, unable to start server.')
    }
    return true
  }

  async _discoverIp(ipServer) {
    let ip
    try {
      ;({ ip } = await http.get(ipServer))
    } catch (e) {
      throw Error(
        `Fatal: Could not discover IP from external IP server ${ipServer}: ` +
          e.message
      )
    }
    if (logFlags.debug) this.mainLogger.debug(`Discovered IP: ${ip}`)
    return ip
  }

  _checkWithinSyncLimit(time1, time2) {
    const timeDif = Math.abs(time1 - time2)
    if (timeDif > this.syncLimit) {
      return false
    }
    return true
  }

  async _checkTimeSynced(timeServers) {
    for (const host of timeServers) {
      try {
        const time = await Sntp.time({
          host,
          timeout: 10000,
        })
        return time.t <= this.syncLimit
      } catch (e) {
        this.mainLogger.warn(`Couldn't fetch ntp time from server at ${host}`)
      }
    }
    throw Error('Unable to check local time against time servers.')
  }

  async _setNodeId(id, updateDb = true) {
    this.id = id
    this.mainLogger.info(`Your node's ID is ${this.id}`)
    if (!updateDb) return
    await this.storage.setProperty('id', id)
  }

  getNodeId() {
    return this.id
  }

  getCycleMarker() {
    return this.state.getCurrentCycleMarker()
  }

  getIpInfo() {
    return this.ipInfo
  }

  getPublicNodeInfo() {
    const id = this.id
    const publicKey = this.crypto.getPublicKey()
    const curvePublicKey = this.crypto.convertPublicKeyToCurve(publicKey)
    const ipInfo = this.getIpInfo()
    const status = { status: this.state.getNodeStatus(this.id) }
    const nodeInfo = Object.assign(
      { id, publicKey, curvePublicKey },
      ipInfo,
      status
    )
    return nodeInfo
  }

  getCycleMarkerInfo() {
    const currentCycleMarker = this.state.getCurrentCycleMarker()
    const nextCycleMarker = this.state.getNextCycleMarker()
    const cycleCounter = this.state.getCycleCounter()
    const cycleStart = this.state.getCurrentCycleStart()
    const cycleDuration = this.state.getCurrentCycleDuration()
    const nodesJoined = this.state.getLastJoined()
    const currentTime = utils.getTime('s')
    const info = {
      currentCycleMarker,
      nextCycleMarker,
      cycleCounter,
      cycleStart,
      cycleDuration,
      nodesJoined,
      currentTime,
    }
    if (logFlags.debug) this.mainLogger.debug(
      `Requested cycle marker info: ${JSON.stringify(info)}`
    )
    return info
  }

  getLatestCycles(amount) {
    const cycles = this.state.getLastCycles(amount)
    return cycles
  }

  getCycleChain(start, end) {
    if (logFlags.debug) this.mainLogger.debug(
      `Requested cycle chain from cycle ${start} to ${end}...`
    )
    let cycles
    try {
      cycles = this.state.getCycles(start, end)
    } catch (e) {
      this.mainLogger.debug(e)
      cycles = null
    }
    if (logFlags.debug) this.mainLogger.debug(`Result of requested cycleChain: ${cycles}`)
    return cycles
  }

  getCycleMarkerCerts(start, end) {
    if (logFlags.debug) this.mainLogger.debug(
      `Requested cycle marker certificates from cycle ${start} to ${end}...`
    )
    let certs
    try {
      certs = this.state.getCertificates(start, end)
    } catch (e) {
      this.mainLogger.debug(e)
      certs = null
    }
    if (logFlags.debug) this.mainLogger.debug(`Result of requested cycleChain: ${certs}`)
    return certs
  }

  _getThisNodeInfo() {
    const {
      externalIp,
      externalPort,
      internalIp,
      internalPort,
    } = this.getIpInfo()
    const publicKey = this.crypto.getPublicKey()
    // TODO: Change this to actual selectable address
    const address = publicKey
    const joinRequestTimestamp = utils.getTime('s')
    const activeTimestamp = 0
    const nodeInfo = {
      publicKey,
      externalIp,
      externalPort,
      internalIp,
      internalPort,
      address,
      joinRequestTimestamp,
      activeTimestamp,
    }
    if (logFlags.debug) this.mainLogger.debug(`Node info of this node: ${JSON.stringify(nodeInfo)}`)
    return nodeInfo
  }

  async _ensureIpKnown() {
    let needsExternal = false
    let needsInternal = false

    if (!this._verifyExternalInfo(this.getIpInfo())) {
      needsExternal = true
    }
    if (!this._verifyInternalInfo(this.getIpInfo())) {
      needsInternal = true
    }
    if (!needsExternal && !needsInternal) return

    const discoveredIp = await this._discoverIp(this.ipServer)
    if (needsExternal) {
      this.ipInfo.externalIp = discoveredIp
    }
    if (needsInternal) {
      this.ipInfo.internalIp = discoveredIp
    }
  }

  async _checkIfNeedJoin() {
    const id = await this.storage.getProperty('id')
    if (!id) {
      if (logFlags.debug) this.mainLogger.debug('Node needs to join, no node ID found in database.')
      return true
    }

    const currExternIp = this.getIpInfo().externalIp
    const currExternPort = this.getIpInfo().externalPort
    const dbExternIp = await this.storage.getProperty('externalIp')
    const dbExternPort = await this.storage.getProperty('externalPort')

    // Check if our external network info matches what's in the database, otherwise we need to rejoin
    if (currExternIp !== dbExternIp || currExternPort !== dbExternPort) {
      return true
    }

    // TODO: Remove this and replace with robust way of seeing if no nodes
    // ----- are currently active before returning true
    if (this.isFirstSeed) return true

    const currentTime = utils.getTime('s')
    const lastHeartbeat = (await this.storage.getProperty('heartbeat')) || 0
    // If time since last heartbeat is greater than the max rejoin time, we have to rejoin
    if (currentTime - lastHeartbeat > this.maxRejoinTime) {
      return true
    }
    // TODO: Check if we are in nodeslist (requires ID)
    return false
  }

  getNodelistHash() {
    const nodelist = this.state.getAllNodes()
    const nodelistHash = this.crypto.hash({ nodelist })
    if (logFlags.debug) this.mainLogger.debug(`Hash of current nodelist: ${nodelistHash}`)
    return nodelistHash
  }

  async _submitJoin(nodes, joinRequest) {
    for (const node of nodes) {
      if (logFlags.debug) this.mainLogger.debug(`Sending join request to ${node.ip}:${node.port}`)
      await http.post(`${node.ip}:${node.port}/join`, joinRequest)
    }
  }

  // Check if we are in the update phase
  _isInUpdatePhase(
    currentTime = utils.getTime('s'),
    cycleStart = this.state.getCurrentCycleStart(),
    cycleDuration = this.state.getCurrentCycleDuration()
  ) {
    const startOfUpdatePhase = cycleStart    
    const endOfUpdatePhase = cycleStart + Math.ceil(0.25 * cycleDuration) 
    if (logFlags.debug){   
      this.mainLogger.debug(`Current time is: ${currentTime}`)
      this.mainLogger.debug(`Current cycle started at: ${cycleStart}`)
      this.mainLogger.debug(`Current cycle duration: ${cycleDuration}`)
      this.mainLogger.debug(`Start of first quarter: ${startOfUpdatePhase}`)
      this.mainLogger.debug(`End of first quarter: ${endOfUpdatePhase}`)
    }
    if (currentTime < startOfUpdatePhase || currentTime > endOfUpdatePhase) {
      return false
    }
    return true
  }

  _isInLastPhase(currentTime, cycleStart, cycleDuration) {
    const startOfLastPhase = cycleStart + Math.ceil(0.75 * cycleDuration)
    const endOfLastPhase = cycleStart + cycleDuration    
    if (logFlags.debug){
      this.mainLogger.debug(`Current time is: ${currentTime}`)
      this.mainLogger.debug(`Current cycle started at: ${cycleStart}`)
      this.mainLogger.debug(`Current cycle duration: ${cycleDuration}`)
      this.mainLogger.debug(`Start of last quarter: ${startOfLastPhase}`)
      this.mainLogger.debug(`End of last quarter: ${endOfLastPhase}`)
    }
    if (currentTime < startOfLastPhase || currentTime > endOfLastPhase) {
      return false
    }
    return true
  }

  // Wait until the chain update phase
  async _waitUntilUpdatePhase(
    currentTime = utils.getTime('s'),
    cycleStart = this.state.getCurrentCycleStart(),
    cycleDuration = this.state.getCurrentCycleDuration()
  ) {
    // If we are already in the update phase, return
    if (this._isInUpdatePhase(currentTime, cycleStart, cycleDuration)) return
    const nextJoinStart = cycleStart + cycleDuration
    const timeToWait = (nextJoinStart - currentTime + this.queryDelay) * 1000    
    if (logFlags.debug){
      this.mainLogger.debug(`Current time is: ${currentTime}`)
      this.mainLogger.debug(`Current cycle started at: ${cycleStart}`)
      this.mainLogger.debug(`Current cycle duration: ${cycleDuration}`)

      this.mainLogger.debug(`Next join cycle starts at: ${nextJoinStart}`)

      this.mainLogger.debug(
        `Waiting for ${timeToWait} ms before next update phase...`
      )
    }
    await utils.sleep(timeToWait)
  }

  // Wait until middle phase of cycle
  async _waitUntilSecondPhase(currentTime, cycleStart, cycleDuration) {
    const phaseStart = cycleStart + Math.ceil(0.25 * cycleDuration)    
    let timeToWait
    if (currentTime < phaseStart) {
      timeToWait = (phaseStart - currentTime + this.queryDelay) * 1000
    } else {
      timeToWait = 0
    }
    if (logFlags.debug){
      this.mainLogger.debug(`Current time is: ${currentTime}`)
      this.mainLogger.debug(`Current cycle started at: ${cycleStart}`)
      this.mainLogger.debug(`Current cycle duration: ${cycleDuration}`)
      this.mainLogger.debug(`Beginning of second phase at: ${phaseStart}`)
      this.mainLogger.debug(
        `Waiting for ${timeToWait} ms before the second phase...`
      )
    }
    await utils.sleep(timeToWait)
  }

  // Wait until middle phase of cycle
  async _waitUntilThirdPhase(currentTime, cycleStart, cycleDuration) {
    const phaseStart = cycleStart + Math.ceil(0.5 * cycleDuration)
    let timeToWait
    if (currentTime < phaseStart) {
      timeToWait = (phaseStart - currentTime + this.queryDelay) * 1000
    } else {
      timeToWait = 0
    }
    if (logFlags.debug){
      this.mainLogger.debug(`Current time is: ${currentTime}`)
      this.mainLogger.debug(`Current cycle started at: ${cycleStart}`)
      this.mainLogger.debug(`Current cycle duration: ${cycleDuration}`)
      this.mainLogger.debug(`Beginning of middle phase at: ${phaseStart}`)
      this.mainLogger.debug(
        `Waiting for ${timeToWait} ms before the middle phase...`
      )
    }
    await utils.sleep(timeToWait)
  }

  // Wait until last phase of cycle
  async _waitUntilLastPhase(
    currentTime = utils.getTime('s'),
    cycleStart = this.state.getCurrentCycleStart(),
    cycleDuration = this.state.getCurrentCycleDuration()
  ) {
    const beginningOfLast = cycleStart + Math.ceil(0.75 * cycleDuration)
    let timeToWait
    if (currentTime < beginningOfLast) {
      timeToWait = (beginningOfLast - currentTime + this.queryDelay) * 1000
    } else {
      timeToWait = 0
    }
    if (logFlags.debug){
      this.mainLogger.debug(`Current time is: ${currentTime}`)
      this.mainLogger.debug(`Current cycle started at: ${cycleStart}`)
      this.mainLogger.debug(`Current cycle duration: ${cycleDuration}`)
      this.mainLogger.debug(`Beginning of last phase at: ${beginningOfLast}`)
      this.mainLogger.debug(
        `Waiting for ${timeToWait} ms before the last phase...`
      )
    }
    await utils.sleep(timeToWait)
  }

  // Wait until the end of the cycle
  async _waitUntilEndOfCycle(
    currentTime = utils.getTime('s'),
    cycleStart = this.state.getCurrentCycleStart(),
    cycleDuration = this.state.getCurrentCycleDuration()
  ) {
    const endOfCycle = cycleStart + cycleDuration
    let timeToWait
    if (currentTime < endOfCycle) {
      timeToWait = (endOfCycle - currentTime + this.queryDelay) * 1000
    } else {
      timeToWait = 0
    }
    if (logFlags.debug){
      this.mainLogger.debug(`Current time is: ${currentTime}`)
      this.mainLogger.debug(`Current cycle started at: ${cycleStart}`)
      this.mainLogger.debug(`Current cycle duration: ${cycleDuration}`)
      this.mainLogger.debug(`End of cycle at: ${endOfCycle}`)
      this.mainLogger.debug(
        `Waiting for ${timeToWait} ms before next cycle marker creation...`
      )
    }
    await utils.sleep(timeToWait)
  }

  async _submitWhenUpdatePhase(route, message) {
    if (logFlags.debug) this.mainLogger.debug(
      `Submitting message: ${JSON.stringify(
        message
      )} on route: ${route} whenever it's not the second quarter of cycle...`
    )
    let cycleMarker
    try {
      cycleMarker = await this._fetchCycleMarkerInternal(
        this.state.getActiveNodes()
      )
    } catch (e) {
      this.mainLogger.warn(
        'Could not get cycleMarker from nodes. Querying seedNodes for it...'
      )
      try {
        cycleMarker = await this._fetchCycleMarkerInternal(
          this.archiverActiveNodes
        )
      } catch (err) {
        this.mainLogger.error(
          '_submitWhenUpdatePhase could not get cycleMarker from seedNodes. Exiting... ' +
            err
        )
        process.exit()
      }
    }
    const { currentTime, cycleStart, cycleDuration } = cycleMarker

    // If we are nto in the update phase, then wait until it starts to submit this message
    if (!this._isInUpdatePhase(currentTime, cycleStart, cycleDuration)) {
      await this._waitUntilUpdatePhase(currentTime, cycleStart, cycleDuration)
    }
    if (logFlags.verbose) {
      this.mainLogger.debug(
        `Gossiping message: ${JSON.stringify(message)} on '${route}'.`
      )
    }
    this.sendGossipIn(route, message)
  }

  // async _attemptJoin(
  //   seedNodes,
  //   joinRequest,
  //   timeOffset,
  //   cycleStart,
  //   cycleDuration
  // ) {
  //   // TODO: check if we missed join phase
  //   const currTime1 = utils.getTime('s') + timeOffset
  //   await this._waitUntilUpdatePhase(currTime1, cycleStart, cycleDuration)
  //   await this._submitJoin(seedNodes, joinRequest)
  //   const currTime2 = utils.getTime('s') + timeOffset
  //   // This time we use cycleStart + cycleDuration because we are in the next cycle
  //   await this._waitUntilEndOfCycle(
  //     currTime2,
  //     cycleStart + cycleDuration,
  //     cycleDuration
  //   )
  //   const nodeId = await this._fetchNodeId(seedNodes)
  //   return nodeId
  // }

  // async _join(seedNodes) {
  //   const localTime = utils.getTime('s')
  //   const { currentTime } = await this._fetchCycleMarker(seedNodes)
  //   if (!this._checkWithinSyncLimit(localTime, currentTime)) {
  //     throw Error('Local time out of sync with network.')
  //   }
  //   const timeOffset = currentTime - localTime
  //   this.mainLogger.debug(`Time offset with selected node: ${timeOffset}`)
  //   let nodeId = null
  //   let attempts = 2
  //   while (!nodeId && attempts > 0) {
  //     const {
  //       currentCycleMarker,
  //       nextCycleMarker,
  //       cycleStart,
  //       cycleDuration,
  //     } = await this._fetchCycleMarker(seedNodes)
  //     if (nextCycleMarker) {
  //       // Use next cycle marker
  //       const joinRequest = await this._createJoinRequest(nextCycleMarker)
  //       nodeId = await this._attemptJoin(
  //         seedNodes,
  //         joinRequest,
  //         timeOffset,
  //         cycleStart,
  //         cycleDuration
  //       )
  //       if (!nodeId) {
  //         const { cycleStart, cycleDuration } = await this._fetchCycleMarker(
  //           seedNodes
  //         )
  //         nodeId = await this._attemptJoin(
  //           seedNodes,
  //           joinRequest,
  //           timeOffset,
  //           cycleStart,
  //           cycleDuration
  //         )
  //       }
  //     } else {
  //       const joinRequest = await this._createJoinRequest(currentCycleMarker)
  //       nodeId = await this._attemptJoin(
  //         seedNodes,
  //         joinRequest,
  //         timeOffset,
  //         cycleStart,
  //         cycleDuration
  //       )
  //     }
  //     attempts--
  //   }
  //   return nodeId
  // }

  _checkIfFirstSeedNode(seedNodes) {
    if (!seedNodes.length) throw new Error('Fatal: No seed nodes in seed list!')
    if (seedNodes.length > 1) return false
    const seed = seedNodes[0]
    const { externalIp, externalPort } = this.getIpInfo()
    if (externalIp === seed.ip && externalPort === seed.port) {
      return true
    }
    return false
  }

  async _createJoinRequest(cycleMarker) {
    // Build and return a join request
    const nodeInfo = this._getThisNodeInfo()
    const selectionNum = this.crypto.hash({
      cycleMarker,
      address: nodeInfo.address,
    })
    // TO-DO: Think about if the selection number still needs to be signed
    // let signedSelectionNum = this.crypto.sign({ selectionNum })
    const proofOfWork = {
      compute: await this.crypto.getComputeProofOfWork(
        cycleMarker,
        this.difficulty
      ),
    }
    // TODO: add a version number at some point
    // version: '0.0.0'
    const joinReq = { nodeInfo, cycleMarker, proofOfWork, selectionNum }
    const signedJoinReq = this.crypto.sign(joinReq)
    if (logFlags.debug) this.mainLogger.debug(
      `Join request created... Join request: ${JSON.stringify(signedJoinReq)}`
    )
    return signedJoinReq
  }

  async initApoptosis(
    activeNodes = this.id
      ? this.state.getActiveNodes(this.id)
      : this.archiverActiveNodes
  ) {
    P2PApoptosis.apoptosizeSelf()
  }

  isActive() {
    if (logFlags.debug) this.mainLogger.debug('Checking if active...')
    const status = this.state.getNodeStatus(this.id)
    const active = status === 'active'
    if (!active) {
      if (logFlags.debug) this.mainLogger.debug(
        `This node is not currently active... Current status: ${status}`
      )
      return false
    }
    if (logFlags.debug) this.mainLogger.debug('This node is active!')
    return true
  }

  // async robustQuery(
  //   nodes = [],
  //   queryFn,
  //   equalityFn?,
  //   redundancy = 3,
  //   shuffleNodes = true
  // ) {
  //   if (nodes.length === 0) throw new Error('No nodes given.')
  //   if (typeof queryFn !== 'function') {
  //     throw new Error(`Provided queryFn ${queryFn} is not a valid function.`)
  //   }
  //   if (typeof equalityFn !== 'function') equalityFn = util.isDeepStrictEqual
  //   if (redundancy < 1) redundancy = 3
  //   if (redundancy > nodes.length) redundancy = nodes.length

  //   class Tally {
  //     winCount: any
  //     equalFn: any
  //     items: any[]
  //     constructor(winCount, equalFn) {
  //       this.winCount = winCount
  //       this.equalFn = equalFn
  //       this.items = []
  //     }
  //     add(newItem, node) {
  //       // We search to see if we've already seen this item before
  //       for (const item of this.items) {
  //         // If the value of the new item is not equal to the current item, we continue searching
  //         if (!this.equalFn(newItem, item.value)) continue
  //         // If the new item is equal to the current item in the list,
  //         // we increment the current item's counter and add the current node to the list
  //         item.count++
  //         item.nodes.push(node)
  //         // Here we check our win condition if the current item's counter was incremented
  //         // If we meet the win requirement, we return an array with the value of the item,
  //         // and the list of nodes who voted for that item
  //         if (item.count >= this.winCount) {
  //           return [item.value, item.nodes]
  //         }
  //         // Otherwise, if the win condition hasn't been met,
  //         // We return null to indicate no winner yet
  //         return null
  //       }
  //       // If we made it through the entire items list without finding a match,
  //       // We create a new item and set the count to 1
  //       this.items.push({ value: newItem, count: 1, nodes: [node] })
  //       // Finally, we check to see if the winCount is 1,
  //       // and return the item we just created if that is the case
  //       if (this.winCount === 1) return [newItem, [node]]
  //     }
  //     getHighestCount() {
  //       if (!this.items.length) return 0
  //       let highestCount = 0
  //       for (const item of this.items) {
  //         if (item.count > highestCount) {
  //           highestCount = item.count
  //         }
  //       }
  //       return highestCount
  //     }
  //   }
  //   const responses = new Tally(redundancy, equalityFn)
  //   let errors = 0

  //   nodes = [...nodes]
  //   if (shuffleNodes === true) {
  //     shuffleArray(nodes)
  //   }
  //   const nodeCount = nodes.length

  //   const queryNodes = async nodes => {
  //     // Wrap the query so that we know which node it's coming from
  //     const wrappedQuery = async node => {
  //       const response = await queryFn(node)
  //       return { response, node }
  //     }

  //     // We create a promise for each of the first `redundancy` nodes in the shuffled array
  //     const queries = []
  //     for (let i = 0; i < nodes.length; i++) {
  //       const node = nodes[i]
  //       queries.push(wrappedQuery(node))
  //     }
  //     const [results, errs] = await utils.robustPromiseAll(queries)

  //     let finalResult
  //     for (const result of results) {
  //       const { response, node } = result
  //       finalResult = responses.add(response, node)
  //       if (finalResult) break
  //     }

  //     for (const err of errs) {
  //       this.mainLogger.debug(err)
  //       errors += 1
  //     }

  //     if (!finalResult) return null
  //     return finalResult
  //   }

  //   let finalResult = null
  //   while (!finalResult) {
  //     const toQuery = redundancy - responses.getHighestCount()
  //     if (nodes.length < toQuery) break
  //     const nodesToQuery = nodes.splice(0, toQuery)
  //     finalResult = await queryNodes(nodesToQuery)
  //   }
  //   if (finalResult) {
  //     //return finalResult

  //     return { response: finalResult, node : null }
  //   }

  //   // TODO: Don't throw an error, should just return what had the most
  //   throw new Error(
  //     `Could not get ${redundancy} ${
  //       redundancy > 1 ? 'redundant responses' : 'response'
  //     } from ${nodeCount} ${
  //       nodeCount !== 1 ? 'nodes' : 'node'
  //     }. Encountered ${errors} query errors.`
  //   )
  // }

  // async _sequentialQuery(nodes, queryFn, verifyFn) {
  //   if (typeof verifyFn !== 'function') {
  //     verifyFn = result => true
  //   }

  //   let errors = 0
  //   let invalid = 0

  //   nodes = [...nodes]
  //   shuffleArray(nodes)

  //   for (const node of nodes) {
  //     try {
  //       const result = await queryFn(node)
  //       if (!result) throw new Error('Unable to get result from query.')
  //       this.mainLogger.debug(
  //         `Sequential query result: ${JSON.stringify(result)}`
  //       )
  //       const verified = verifyFn(result)
  //       if (!verified) {
  //         this.mainLogger.debug(`Query result failed verification.`)
  //         invalid += 1
  //         continue
  //       }
  //       return result
  //     } catch (e) {
  //       errors += 1
  //     }
  //   }

  //   throw new Error(
  //     `Could not get a responses from ${nodes.length} nodes. Encountered ${errors} errors and there were ${invalid} invalid queries.`
  //   )
  // }

  _verifyNodelist(nodelist, nodelistHash) {
    const ourHash = this.crypto.hash(nodelist)    
    if (logFlags.debug){
      this.mainLogger.debug(`Given nodelist: ${JSON.stringify(nodelist)}`)
      this.mainLogger.debug(`Our nodelist hash: ${ourHash}`)
      this.mainLogger.debug(`Given nodelist hash: ${nodelistHash}`)
    }
    return ourHash === nodelistHash
  }

  _verifyCycleChain(cycleChain, cycleChainHash) {
    const ourHash = this.crypto.hash({ cycleChain })   
    if (logFlags.debug){ 
      this.mainLogger.debug(`Given cycle chain: ${JSON.stringify(cycleChain)}`)
      this.mainLogger.debug(`Our cycle chain hash: ${ourHash}`)
      this.mainLogger.debug(`Given cycle chain hash: ${cycleChainHash}`)
    }
    return ourHash === cycleChainHash
  }

  _isSameCycleMarkerInfo(info1, info2) {
    const cm1 = utils.deepCopy(info1)
    const cm2 = utils.deepCopy(info2)
    delete cm1.currentTime
    delete cm2.currentTime
    const equivalent = util.isDeepStrictEqual(cm1, cm2)
    if (logFlags.debug) this.mainLogger.debug(
      `Equivalence of the two compared cycle marker infos: ${equivalent}`
    )
    return equivalent
  }

  // async _fetchCycleMarker(nodes) {
  //   const queryFn = async node => {
  //     const cycleMarkerInfo = await http.get(
  //       `${node.ip}:${node.port}/cyclemarker`
  //     )
  //     return cycleMarkerInfo
  //   }
  //   const [cycleMarkerInfo] = await this.robustQuery(
  //     nodes,
  //     queryFn,
  //     this._isSameCycleMarkerInfo.bind(this)
  //   )
  //   return cycleMarkerInfo
  // }

  // async _fetchNodeId(seedNodes) {
  //   const { publicKey } = this._getThisNodeInfo()
  //   const queryFn = async node => {
  //     const { cycleJoined } = await http.get(
  //       `${node.ip}:${node.port}/joined/${publicKey}`
  //     )
  //     return { cycleJoined }
  //   }
  //   let query
  //   let attempts = 2
  //   while ((!query || !query[0]) && attempts > 0) {
  //     try {
  //       query = await this.robustQuery(seedNodes, queryFn)
  //     } catch (e) {
  //       this.mainLogger.error(e)
  //     }
  //     attempts--
  //   }
  //   if (attempts <= 0) {
  //     this.mainLogger.info(
  //       'Unable to get consistent cycle marker from seednodes.'
  //     )
  //     return null
  //   }
  //   const { cycleJoined } = query[0]
  //   if (!cycleJoined) {
  //     this.mainLogger.info(
  //       "Unable to get cycle marker, likely this node's join request was not accepted."
  //     )
  //     return null
  //   }
  //   const nodeId = this.state.computeNodeId(publicKey, cycleJoined)
  //   return nodeId
  // }

  async _fetchCycleMarkerInternal(nodes) {
    const queryFn = async node => {
      const cycleMarkerInfo = await this.ask(node, 'cyclemarker')
      return cycleMarkerInfo
    }
    const {topResult:cycleMarkerInfo} = await robustQuery(
      nodes,
      queryFn,
      this._isSameCycleMarkerInfo.bind(this)
    )
    return cycleMarkerInfo
  }

  // async _fetchVerifiedCycleChain(nodes, cycleChainHash, start, end) {
  //   const queryFn = async node => {
  //     const chainAndCerts = await this.ask(node, 'cyclechain', { start, end })
  //     return chainAndCerts
  //   }
  //   const verifyFn = ({ cycleChain }) =>
  //     this._verifyCycleChain(cycleChain, cycleChainHash)
  //   const chainAndCerts = await this._sequentialQuery(nodes, queryFn, verifyFn)
  //   return chainAndCerts
  // }

  // async _fetchUnfinalizedCycle(nodes) {
  //   const queryFn = async node => {
  //     const { unfinalizedCycle } = await this.ask(node, 'unfinalized')
  //     return { unfinalizedCycle }
  //   }
  //   const equalFn = (payload1, payload2) => {
  //     // Make a copy of the cycle payload and delete the metadata for the hash comparison,
  //     // so that we get more consistent results
  //     const cycle1 = payload1.unfinalizedCycle.data
  //     const cycle2 = payload2.unfinalizedCycle.data
  //     const hash1 = this.crypto.hash(cycle1)
  //     const hash2 = this.crypto.hash(cycle2)
  //     return hash1 === hash2
  //   }
  //   let unfinalizedCycle
  //   try {
  //     const [response] = await this.robustQuery(nodes, queryFn, equalFn)
  //     ;({ unfinalizedCycle } = response)
  //   } catch (e) {
  //     this.mainLogger.debug(
  //       `Unable to get unfinalized cycle: ${e}. Need to resync cycle chain and try again.`
  //     )
  //     unfinalizedCycle = null
  //   }
  //   return unfinalizedCycle
  // }

  // async _fetchNodeByPublicKey(nodes, publicKey) {
  //   const queryFn = async target => {
  //     const payload = {
  //       getBy: 'publicKey',
  //       publicKey,
  //     }
  //     const { node } = await this.ask(target, 'node', payload)
  //     return node
  //   }
  //   const equalFn = (payload1, payload2) => {
  //     const hash1 = this.crypto.hash(payload1)
  //     const hash2 = this.crypto.hash(payload2)
  //     return hash1 === hash2
  //   }
  //   let node
  //   try {
  //     ;[node] = await this.robustQuery(nodes, queryFn, equalFn)
  //   } catch (e) {
  //     this.mainLogger.debug(
  //       `Unable to get node: $(e.message). Unable to get consistent response from nodes.`
  //     )
  //     node = null
  //   }
  //   return node
  // }

  async _requestCycleUpdates(nodeId) {
    let node
    try {
      node = this.state.getNode(nodeId)
    } catch (e) {
      this.mainLogger.error(e)
      this.mainLogger.error(`Received certificate from unknown node: ${nodeId}`)
      return false
    }
    const myCycleUpdates = this.state.currentCycle.updates
    const myCertificate = this.state.getCurrentCertificate()
    const { cycleUpdates } = await this.ask(node, 'cycleupdates', {
      myCycleUpdates,
      myCertificate,
    })
    return cycleUpdates
  }

  async _requestUpdatesAndAdd(nodeId) {
    const updates = await this._requestCycleUpdates(nodeId)
    if (!updates) {
      this.mainLogger.error(
        'Unable to add updates, no updates were able to be retrieved.'
      )
      return
    }
    await this.state.addCycleUpdates(updates)
  }

  async requestUpdatesFromRandom() {
    const [randomNode] = getRandom(this.state.getActiveNodes(this.id), 1)
    const randNodeId = randomNode.id
    await this._requestUpdatesAndAdd(randNodeId)
  }

  _validateJoinRequest(joinRequest) {
    // Reject join requests from nodes who's ip and port are already in the network
    const intIp = joinRequest.nodeInfo.internalIp
    const intPort = joinRequest.nodeInfo.internalPort
    const intHost = `${intIp}:${intPort}`
    const existingNode = this.state.nodes.byIp[intHost]
    if (existingNode) {
      return false
    }
    // TODO: implement actual validation (call to application side?)
    return true
  }

  async addJoinRequest(joinRequest, tracker, fromExternal = true) {
    const valid = this._validateJoinRequest(joinRequest)
    if (!valid) {
      if (logFlags.debug) this.mainLogger.debug(`Join request rejected: Failed validation.`)
      return false
    }
    let added
    const active = this.isActive()
    if (!fromExternal) added = this.state.addGossipedJoinRequest(joinRequest)
    else {
      if (!active) return false
      added = this.state.addNewJoinRequest(joinRequest)
    }
    if (!added) {
      if (logFlags.debug) this.mainLogger.debug(
        `Join request rejected: Was not added. TODO: Have this fn return reason.`
      )
      return false
    }
    if (!active) return true
    await this.sendGossipIn('join', joinRequest, tracker)
    return true
  }

  _createStatusUpdate(type) {
    const update = {
      nodeId: this.id,
      status: type,
      timestamp: utils.getTime(),
    }
    const signedUpdate = this.crypto.sign(update)
    return signedUpdate
  }

  async _submitStatusUpdate(type) {
    const update = this._createStatusUpdate(type)
    await this._submitWhenUpdatePhase(type, update)
    this.state.addStatusUpdate(update)
  }

  async goActive() {
    if (this.isFirstSeed) {
      const {
        currentTime,
        cycleStart,
        cycleDuration,
      } = this.getCycleMarkerInfo()
      if (!this._isInUpdatePhase(currentTime, cycleStart, cycleDuration)) {
        await this._waitUntilUpdatePhase(currentTime, cycleStart, cycleDuration)
      }
      const update = this._createStatusUpdate('active')
      this.state.addStatusUpdate(update)
      // Emit the 'active' event after becoming active
      if (logFlags.debug) this.mainLogger.debug('Emitting `active` event.')
      this.emit('active', this.id)
      return true
    }
    const ensureActive = async () => {
      if (!this.isActive()) {
        const { cycleDuration } = this.getCycleMarkerInfo()
        if (logFlags.debug) this.mainLogger.debug('Not active yet, submitting an active request.')
        await this._submitStatusUpdate('active')
        const toWait = cycleDuration * 1000
        if (logFlags.debug) this.mainLogger.debug(
          `Waiting before checking if active, waiting ${toWait} ms...`
        )
        setTimeout(async () => {
          await ensureActive()
        }, toWait)
      } else {
        // Emit the 'active' event after becoming active
        if (logFlags.debug) this.mainLogger.debug('Emitting `active` event.')
        this.emit('active', this.id)
        this.mainLogger.info('Node is now active!')
      }
    }
    await ensureActive()

    return true
  }

  _constructScalingRequest(upOrDown) {
    // Scaling request structure:
    // Node
    // Timestamp
    // Cycle counter
    // Scale up or down
    // Signature
    const request = {
      node: this.id,
      timestamp: utils.getTime(),
      cycleCounter: this.state.getCycleCounter() + 1,
      scale: undefined,
    }
    switch (upOrDown) {
      case 'up':
        request.scale = 'up'
        break
      case 'down':
        request.scale = 'down'
        break
      default:
        const err = new Error(`Invalid scaling request type: ${upOrDown}`)
        this.mainLogger.fatal(err)
        throw err
    }
    const signedReq = this.crypto.sign(request)
    return signedReq
  }

  async _requestNetworkScaling(upOrDown) {
    if (!this.isActive() || this.scalingRequested) return
    const request = this._constructScalingRequest(upOrDown)
    await this._waitUntilEndOfCycle()
    await this.state.addExtScalingRequest(request)
    await this.sendGossipIn('scaling', request)
    this.scalingRequested = true
  }

  async requestNetworkUpsize() {
    if (this.state.getDesiredCount() >= this.state.maxNodes) {
      return
    }
    console.log('DBG', 'UPSIZE!')
    await this._requestNetworkScaling('up')
  }

  async requestNetworkDownsize() {
    if (this.state.getDesiredCount() <= this.state.minNodes) {
      return
    }
    console.log('DBG', 'DOWNSIZE!')
    await this._requestNetworkScaling('down')
  }

  allowTransactions() {
    return this.state.getActiveCount() >= this.minNodesToAllowTxs
  }

  allowSet() {
    return this.state.getActiveCount() === 1
  }

  // Finds a node either in nodelist or in seedNodes listhis.mainLogger.debug(`Node ID to look up: ${nodeId}`)t if told to
  _findNodeInGroup(nodeId, group) {
    if (!group) {
      const errMsg = 'No group given for _findNodeInGroup()'
      if (logFlags.debug) this.mainLogger.debug(errMsg)
      throw new Error(errMsg)
    }
//    this.mainLogger.debug(`Node ID to find in group: ${nodeId}`)
    for (const node of group) {
      if (node.id === nodeId) return node
    }
    if (logFlags.debug) this.mainLogger.debug(`Node ID not found in group: ${nodeId}`)
    return false
  }

  // Verifies that the received internal message was signed by the stated node
  _authenticateByNode(message, node) {
    let result
    try {
      if (!node.curvePublicKey) {
        if (logFlags.debug) this.mainLogger.debug(
          'Node object did not contain curve public key for authenticateByNode()!'
        )
        return false
      }
//      this.mainLogger.debug(`Expected publicKey: ${node.curvePublicKey}`)
      result = this.crypto.authenticate(message, node.curvePublicKey)
    } catch (e) {
      if (logFlags.debug) this.mainLogger.debug(
        `Invalid or missing authentication tag on message: ${JSON.stringify(
          message
        )}`
      )
      return false
    }
    return result
  }

  _extractPayload(wrappedPayload, nodeGroup) {
    if (wrappedPayload.error) {
      const error = wrappedPayload.error
      if (logFlags.debug) this.mainLogger.debug(
        `_extractPayload Failed to extract payload. Error: ${error}`
      )
      return [null]
    }
    // Check to see if node is in expected node group
    const node = this._findNodeInGroup(wrappedPayload.sender, nodeGroup)
    if (!node) {
      if (logFlags.debug) this.mainLogger.debug(
        `_extractPayload Invalid sender on internal payload. sender: ${
          wrappedPayload.sender
        } payload: ${utils.stringifyReduceLimit(wrappedPayload)}`
      )
      return [null]
    }
    const authenticatedByNode = this._authenticateByNode(wrappedPayload, node)
    // Check if actually signed by that node
    if (!authenticatedByNode) {
      if (logFlags.debug) this.mainLogger.debug(
        '_extractPayload Internal payload not authenticated by an expected node.'
      )
      return [null]
    }
    const payload = wrappedPayload.payload
    const sender = wrappedPayload.sender
    const tracker = wrappedPayload.tracker
//    this.mainLogger.debug('Internal payload successfully authenticated.')
    return [payload, sender, tracker]
  }

  _wrapAndTagMessage(msg, tracker = '', recipientNode) {
    if (!msg) throw new Error('No message given to wrap and tag!')
    if (logFlags.verbose) {
      if (logFlags.debug) this.mainLogger.debug(
        `Attaching sender ${
          this.id
        } to the message: ${utils.stringifyReduceLimit(msg)}`
      )
    }
    const wrapped = {
      payload: msg,
      sender: this.id,
      tracker,
    }
    const tagged = this.crypto.tag(wrapped, recipientNode.curvePublicKey)
    return tagged
  }

  createMsgTracker() {
    return (
      'key_' +
      utils.makeShortHash(this.id) +
      '_' +
      Date.now() +
      '_' +
      this.keyCounter++
    )
  }
  createGossipTracker() {
    return (
      'gkey_' +
      utils.makeShortHash(this.id) +
      '_' +
      Date.now() +
      '_' +
      this.keyCounter++
    )
  }

  // Our own P2P version of the network tell, with a sign added
  async tell(nodes, route, message, logged = false, tracker = '') {
    if (tracker === '') {
      tracker = this.createMsgTracker()
    }
    const promises = []
    for (const node of nodes) {
      const signedMessage = this._wrapAndTagMessage(message, tracker, node)
      promises.push(this.network.tell([node], route, signedMessage, logged))
    }
    try {
      await Promise.all(promises)
    } catch (err) {
      if (logFlags.debug) this.mainLogger.debug('P2P TELL: failed', err)
    }
  }

  // Our own P2P version of the network ask, with a sign added, and sign verified on other side
  async ask(node, route: string, message = {}, logged = false, tracker = '') {
    if (tracker === '') {
      tracker = this.createMsgTracker()
    }
    const signedMessage = this._wrapAndTagMessage(message, tracker, node)
    let signedResponse
    try {
      signedResponse = await this.network.ask(
        node,
        route,
        signedMessage,
        logged
      )
    } catch (err) {
      this.mainLogger.error('P2P: ask: network.ask: ' + err)
      return false
    }
    if (logFlags.debug) this.mainLogger.debug(
      `Result of network-level ask: ${JSON.stringify(signedResponse)}`
    )
    try {
      const [response] = this._extractPayload(signedResponse, [node])
      if (!response) {
        throw new Error(
          `Unable to verify response to ask request: ${route} -- ${JSON.stringify(
            message
          )} from node: ${node.id}`
        )
      }
      return response
    } catch (err) {
      this.mainLogger.error('P2P: ask: _extractPayload: ' + err)
      return false
    }
  }

  registerInternal(route, handler) {
    // Create function that wraps handler function
    const wrappedHandler = async (wrappedPayload, respond) => {
      this.InternalRecvCounter++
      // We have internal requests turned off until we have the node list
      if (!this.acceptInternal) {
        if (logFlags.debug) this.mainLogger.debug(
          'We are not currently accepting internal requests...'
        )
        return
      }
      let tracker = ''
      // Create wrapped respond function for sending back signed data
      const respondWrapped = async response => {
        const node = this.state.getNode(sender)
        const signedResponse = this._wrapAndTagMessage(response, tracker, node)
        if (logFlags.verbose) {
          this.mainLogger.debug(
            `The signed wrapped response to send back: ${utils.stringifyReduceLimit(
              signedResponse
            )}`
          )
        }
        if (route !== 'gossip') {
          this.logger.playbackLog(
            sender,
            'self',
            'InternalRecvResp',
            route,
            tracker,
            response
          )
        }
        await respond(signedResponse)
      }
      // Checks to see if we can extract the actual payload from the wrapped message
      const payloadArray = this._extractPayload(
        wrappedPayload,
        this.state.getAllNodes(this.id)
      )
      const [payload, sender] = payloadArray
      tracker = payloadArray[2] || ''
      if (!payload) {
        if (logFlags.debug) this.mainLogger.debug(
          'Payload unable to be extracted, possible missing signature...'
        )
        return
      }
      if (route !== 'gossip') {
        this.logger.playbackLog(
          sender,
          'self',
          'InternalRecv',
          route,
          tracker,
          payload
        )
      }
      await handler(payload, respondWrapped, sender, tracker)
    }
    // Include that in the handler function that is passed
    this.network.registerInternal(route, wrappedHandler)
  }

  unregisterInternal(route) {
    this.network.unregisterInternal(route)
  }

  /**
   * Send Gossip to all nodes
   */
  async sendGossip(
    type,
    payload,
    tracker = '',
    sender = null,
    nodes = this.state.getAllNodes(this.id)
  ) {
    if (nodes.length === 0) return

    if (tracker === '') {
      tracker = this.createGossipTracker()
    }

    if (logFlags.verbose) {
      this.mainLogger.debug(
        `Start of sendGossip(${utils.stringifyReduce(payload)})`
      )
    }
    const gossipPayload = { type, data: payload }

    const gossipHash = this.crypto.hash(gossipPayload)
    if (this.gossipedHashesSent.has(gossipHash)) {
      if (logFlags.verbose) {
        this.mainLogger.debug(
          `Gossip already sent: ${gossipHash.substring(0, 5)}`
        )
      }
      return
    }

    // [TODO] pass getRandomGossipIn hash of payload
    let recipients = getRandom(nodes, this.gossipRecipients)
    if (sender != null) {
      recipients = removeNodesByID(recipients, [sender])
    }
    try {
      if (logFlags.verbose) {
        this.mainLogger.debug(
          `Gossiping ${type} request to these nodes: ${utils.stringifyReduce(
            recipients.map(
              node => utils.makeShortHash(node.id) + ':' + node.externalPort
            )
          )}`
        )
      }
      for (const node of recipients) {
        this.logger.playbackLog(
          'self',
          node,
          'GossipSend',
          type,
          tracker,
          gossipPayload
        )
      }
      await this.tell(recipients, 'gossip', gossipPayload, true, tracker)
    } catch (ex) {
      if (logFlags.verbose) {
        this.mainLogger.error(
          `Failed to sendGossip(${utils.stringifyReduce(
            payload
          )}) Exception => ${ex}`
        )
      }
      this.fatalLogger.fatal(
        'sendGossip: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack
      )
    }
    this.gossipedHashesSent.set(gossipHash, false)
    if (logFlags.verbose) {
      this.mainLogger.debug(
        `End of sendGossip(${utils.stringifyReduce(payload)})`
      )
    }
  }

  sortByID(first, second) {
    return utils.sortAscProp(first, second, 'id')
  }

  /**
   * Send Gossip to all nodes, using gossip in
   */
  async sendGossipIn(
    type,
    payload,
    tracker = '',
    sender = null,
    nodes = this.state.getAllNodes()
  ) {
    if (nodes.length === 0) return

    if (tracker === '') {
      tracker = this.createGossipTracker()
    }

    if (logFlags.verbose) {
      this.mainLogger.debug(
        `Start of sendGossipIn(${utils.stringifyReduce(payload)})`
      )
    }
    const gossipPayload = { type, data: payload }

    const gossipHash = this.crypto.hash(gossipPayload)
    if (this.gossipedHashesSent.has(gossipHash)) {
      if (logFlags.verbose) {
        this.mainLogger.debug(
          `Gossip already sent: ${gossipHash.substring(0, 5)}`
        )
      }
      return
    }
    // nodes.sort((first, second) => first.id.localeCompare(second.id, 'en', { sensitivity: 'variant' }))
    nodes.sort(this.sortByID)
    const nodeIdxs = new Array(nodes.length).fill(0).map((curr, idx) => idx)
    // Find out your own index in the nodes array
    const myIdx = nodes.findIndex(node => node.id === this.id)
    if (myIdx < 0) throw new Error('Could not find self in nodes array')
    // Map back recipient idxs to node objects
    const recipientIdxs = getRandomGossipIn(
      nodeIdxs,
      this.gossipRecipients,
      myIdx
    )
    let recipients = recipientIdxs.map(idx => nodes[idx])
    if (sender != null) {
      recipients = removeNodesByID(recipients, [sender])
    }
    try {
      if (logFlags.verbose) {
        this.mainLogger.debug(
          `GossipingIn ${type} request to these nodes: ${utils.stringifyReduce(
            recipients.map(
              node => utils.makeShortHash(node.id) + ':' + node.externalPort
            )
          )}`
        )
      }
      for (const node of recipients) {
        this.logger.playbackLog(
          'self',
          node.id,
          'GossipInSend',
          type,
          tracker,
          gossipPayload
        )
      }
      await this.tell(recipients, 'gossip', gossipPayload, true, tracker)
    } catch (ex) {
      if (logFlags.verbose) {
        this.mainLogger.error(
          `Failed to sendGossip(${utils.stringifyReduce(
            payload
          )}) Exception => ${ex}`
        )
      }
      this.fatalLogger.fatal(
        'sendGossipIn: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack
      )
    }
    this.gossipedHashesSent.set(gossipHash, false)
    if (logFlags.verbose) {
      this.mainLogger.debug(
        `End of sendGossipIn(${utils.stringifyReduce(payload)})`
      )
    }
  }

  /**
   * Send Gossip to all nodes in this list, special case broadcast, never use this for regular gossip.
   */
  async sendGossipAll(
    type,
    payload,
    tracker = '',
    sender = null,
    nodes = this.state.getAllNodes()
  ) {
    if (nodes.length === 0) return

    if (tracker === '') {
      tracker = this.createGossipTracker()
    }

    if (logFlags.verbose) {
      this.mainLogger.debug(
        `Start of sendGossipIn(${utils.stringifyReduce(payload)})`
      )
    }
    const gossipPayload = { type, data: payload }

    const gossipHash = this.crypto.hash(gossipPayload)
    if (this.gossipedHashesSent.has(gossipHash)) {
      if (logFlags.verbose) {
        this.mainLogger.debug(
          `Gossip already sent: ${gossipHash.substring(0, 5)}`
        )
      }
      return
    }
    // Find out your own index in the nodes array
    const myIdx = nodes.findIndex(node => node.id === this.id)
    if (myIdx < 0) throw new Error('Could not find self in nodes array')
    // Map back recipient idxs to node objects
    let recipients = nodes
    if (sender != null) {
      recipients = removeNodesByID(recipients, [sender])
    }
    try {
      if (logFlags.verbose) {
        this.mainLogger.debug(
          `GossipingIn ${type} request to these nodes: ${utils.stringifyReduce(
            recipients.map(
              node => utils.makeShortHash(node.id) + ':' + node.externalPort
            )
          )}`
        )
      }
      for (const node of recipients) {
        this.logger.playbackLog(
          'self',
          node.id,
          'GossipInSendAll',
          type,
          tracker,
          gossipPayload
        )
      }
      await this.tell(recipients, 'gossip', gossipPayload, true, tracker)
    } catch (ex) {
      if (logFlags.verbose) {
        this.mainLogger.error(
          `Failed to sendGossip(${utils.stringifyReduce(
            payload
          )}) Exception => ${ex}`
        )
      }
      this.fatalLogger.fatal(
        'sendGossipIn: ' + ex.name + ': ' + ex.message + ' at ' + ex.stack
      )
    }
    this.gossipedHashesSent.set(gossipHash, false)
    if (logFlags.verbose) {
      this.mainLogger.debug(
        `End of sendGossipIn(${utils.stringifyReduce(payload)})`
      )
    }
  }

  /**
   * Handle Goosip Transactions
   * Payload: {type: ['receipt', 'trustedTransaction'], data: {}}
   */
  async handleGossip(payload, sender, tracker = '') {
    if (logFlags.verbose) {
      this.mainLogger.debug(
        `Start of handleGossip(${utils.stringifyReduce(payload)})`
      )
    }
    const type = payload.type
    const data = payload.data

    const gossipHandler = this.gossipHandlers[type]
    if (!gossipHandler) {
      if (logFlags.debug) this.mainLogger.debug('Gossip Handler not found')
      return
    }

    const gossipHash = this.crypto.hash(payload)
    if (this.gossipedHashesSent.has(gossipHash)) {
      return
    }

    if (this.gossipedHashes.has(gossipHash)) {
      if (logFlags.verbose) {
        this.mainLogger.debug(`Got old gossip: ${gossipHash.substring(0, 5)}`)
      }
      if (!this.gossipedHashes.get(gossipHash)) {
        setTimeout(
          () => this.gossipedHashes.delete(gossipHash),
          this.gossipTimeout
        )
        this.gossipedHashes.set(gossipHash, true)
        if (logFlags.verbose) {
          this.mainLogger.debug(
            `Marked old gossip for deletion: ${gossipHash.substring(0, 5)} in ${
              this.gossipTimeout
            } ms`
          )
        }
      }
      return
    }
    this.gossipedHashes.set(gossipHash, false)
    this.logger.playbackLog(sender, 'self', 'GossipRcv', type, tracker, data)
    await gossipHandler(data, sender, tracker)
    if (logFlags.verbose) {
      this.mainLogger.debug(
        `End of handleGossip(${utils.stringifyReduce(payload)})`
      )
    }
  }

  /**
   * Callback for handling gossip.
   *
   * @callback handleGossipCallback
   * @param {any} data the data response of the callback
   * @param {Node} sender
   * @param {string} tracker the tracking string
   */

  /**
   * @param {string} type
   * @param {handleGossipCallback} handler
   */
  registerGossipHandler(type, handler) {
    this.gossipHandlers[type] = handler
  }

  unregisterGossipHandler(type) {
    if (this.gossipHandlers[type]) {
      delete this.gossipHandlers[type]
    }
  }

  cleanupSync() {
    if (this.state) {
      this.state.stopCycles()
    }
  }

  async restart() {
    console.log('Restarting, then rejoining network...')
    this.acceptInternal = false

    // [AS] exit-handler calls >> p2p.cleanUpSync >> p2p.state.stopCycles

    // Exit process
    process.exit()
  }

  async _reportLostNode(node) {
    return this.lostNodes.reportLost(node)
  }

  setJoinRequestToggle(bool) {
    this.joinRequestToggle = bool
  }
}

// From: https://stackoverflow.com/a/12646864
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[array[i], array[j]] = [array[j], array[i]]
  }
}

function removeNodesByID(nodes, ids) {
  if (!Array.isArray(ids)) {
    return nodes
  }
  return nodes.filter(node => ids.indexOf(node.id) === -1)
}
// From: https://stackoverflow.com/a/19270021
function getRandom(arr, n) {
  let len = arr.length
  const taken = new Array(len)
  if (n > len) {
    n = len
  }
  const result = new Array(n)
  while (n--) {
    const x = Math.floor(Math.random() * len)
    result[n] = arr[x in taken ? taken[x] : x]
    taken[x] = --len in taken ? taken[len] : len
  }
  return result
}

function getRandomGossipIn(nodeIdxs, fanOut, myIdx) {
  const nn = nodeIdxs.length
  if (fanOut >= nn) {
    fanOut = nn - 1
  }
  if (fanOut < 1) {
    return []
  }
  const results = [(myIdx + 1) % nn]
  if (fanOut < 2) {
    return results
  }
  results.push((myIdx + nn - 1) % nn)
  if (fanOut < 3) {
    return results
  }
  while (results.length < fanOut) {
    const r = Math.floor(Math.random() * nn)
    if (r === myIdx) {
      continue
    }
    let k = 0
    for (; k < results.length; k++) {
      if (r === results[k]) {
        break
      }
    }
    if (k === results.length) {
      results.push(r)
    }
  }
  return results
}

// tslint:disable-next-line: no-default-export
export default P2P

module.exports = P2P
