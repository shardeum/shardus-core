import Sntp from '@hapi/sntp'
import { Sn } from '@shardus/net'
import { AppHeader } from '@shardus/net/build/src/types'
import bodyParser from 'body-parser'
import cors from 'cors'
import { EventEmitter } from 'events'
import express, { Application, Handler } from 'express'
import Log4js from 'log4js'
import * as net from 'net'
import { promisify } from 'util'
import { isDebugMode } from '../debug'
import * as httpModule from '../http'
import Logger, { logFlags } from '../logger'
import { config, defaultConfigs, logger } from '../p2p/Context'
import { generateUUID } from '../p2p/Utils'
import * as Shardus from '../shardus/shardus-types'
import * as utils from '../utils'
import { formatErrorMessage } from '../utils'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { profilerInstance } from '../utils/profiler'
import NatAPI = require('nat-api')
import { Utils } from '@shardus/types'

/** TYPES */
export interface IPInfo {
  internalPort: number
  internalIp: string
  externalPort: number
  externalIp: string
}

/** STATE */

let mainLogger: Log4js.Logger

let natClient: any

export let ipInfo: IPInfo

let ntpOffsetMs: number = 0

let lastNTPTimeObj = {}

/** CLASS */

export class NetworkClass extends EventEmitter {
  app: Application
  io: SocketIO.Server
  sn: any
  logger: Logger
  mainLogger: Log4js.Logger
  netLogger: Log4js.Logger
  timeout: number
  internalRoutes: {}
  externalRoutes: Array<(app: Application) => void>
  extServer: any
  intServer: any
  verboseLogsNet: boolean
  InternalTellCounter: number
  InternalAskCounter: number
  ipInfo: any
  signingSecretKeyHex: string
  shardusCryptoHashKey: string
  externalCatchAll: any
  debugNetworkDelay: number
  statisticsInstance: any
  useLruCacheForSocketMgmt: boolean
  lruCacheSizeForSocketMgmt: number

  constructor(
    config: Shardus.StrictServerConfiguration,
    logger: Logger,
  ) {
    super()
    this.app = express()
    this.sn = null
    this.logger = logger
    this.mainLogger = logger.getLogger('main')
    this.netLogger = logger.getLogger('net')
    this.timeout = config.network.timeout * 1000
    this.internalRoutes = {}
    this.externalRoutes = []
    this.extServer = null
    this.intServer = null

    this.InternalTellCounter = 1
    this.InternalAskCounter = 1
    this.debugNetworkDelay = 0
    this.statisticsInstance = null
    ntpOffsetMs = 0

    if (config && config.debug && config.debug.fakeNetworkDelay) {
      this.debugNetworkDelay = config.debug.fakeNetworkDelay
    }

    nestedCountersInstance.countEvent('network', 'init')
    this.useLruCacheForSocketMgmt = config.p2p.useLruCacheForSocketMgmt
    this.lruCacheSizeForSocketMgmt = config.p2p.lruCacheSizeForSocketMgmt
    this.shardusCryptoHashKey = config.crypto.hashKey
  }

  setDebugNetworkDelay(delay: number) {
    this.debugNetworkDelay = delay
  }

  setStatisticsInstance(statistics) {
    this.statisticsInstance = statistics
  }

  // TODO: Allow for binding to a specified network interface
  _setupExternal() {
    return new Promise((resolve, reject) => {
      const self = this
      const storeRequests = function (req, res, next) {
        if (req.url !== '/test') {
          if (self.verboseLogsNet) {
            self.netLogger.debug(
              'External\t' +
                Utils.safeStringify({
                  url: req.url,
                  method: req.method,
                  body: req.body,
                })
            )
          }
        }
        next()
      }
      this.app.use(bodyParser.json({ limit: '50mb' }))
      this.app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }))
      this.app.use(cors())
      this.app.use(storeRequests)
      this._applyExternal()
      this.extServer = this.app.listen(this.ipInfo.externalPort, () => {
        const msg = `External server running on port ${this.ipInfo.externalPort}...`
        console.log(msg)
        this.mainLogger.info('Network: ' + msg)
      })

      this.io = require('socket.io')(this.extServer)
      resolve(this.io)
    })
  }

  // TODO: Allow for binding to a specified network interface
  async _setupInternal() {
    this.sn = Sn({
      port: this.ipInfo.internalPort,
      senderOpts: {
        useLruCache: this.useLruCacheForSocketMgmt,
        lruSize: this.lruCacheSizeForSocketMgmt,
      },
      headerOpts: {
        sendHeaderVersion: 1,
      },
      customStringifier: Utils.safeStringify,
      customJsonParser: Utils.safeJsonParse,
      crypto: {
        hashKey: this.shardusCryptoHashKey,
        signingSecretKeyHex: this.signingSecretKeyHex,
      },
    })
    this.intServer = await this.sn.listen(async (data, remote, respond, header, sign) => {
      let routeName
      try {
        if (!data) throw new Error('No data provided in request...')
        const { route, payload } = data

        routeName = route
        if (!route && payload) {
          if (logFlags.debug)
            this.mainLogger.debug('Received response data without any specified route', payload)
          return
        }

        if (!route && data.error) {
          if (logFlags.debug) this.mainLogger.debug('Received a hang prevention dummy payload')
          return
        }

        if (!route) {
          /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug( 'Network: ' + `Unable to read request, payload of received message: ${Utils.safeStringify(data)}` )
          throw new Error('Unable to read request, no route specified.')
        }
        if (!this.internalRoutes[route]) throw new Error('Unable to handle request, invalid route.')

        if (this.debugNetworkDelay > 0) {
          await utils.sleep(this.debugNetworkDelay)
        }
        profilerInstance.profileSectionStart('net-internl')
        profilerInstance.profileSectionStart(`net-internl-${route}`)

        const handler = this.internalRoutes[route]
        if (!payload) {
          await handler(null, respond, header, sign)
          return
        }
        await handler(payload, respond, header, sign)
        if (logFlags.net_trace) {
          this.netLogger.debug(
            'Internal\t' +
              Utils.safeStringify({
                url: route,
                body: payload,
              })
          )
        }
      } catch (err) {
        if (logFlags.error) this.mainLogger.error('Network: _setupInternal: ', err)
        if (logFlags.error)
          this.mainLogger.error('DBG', 'Network: _setupInternal > sn.listen > callback > data', data)
        if (logFlags.error)
          this.mainLogger.error('DBG', 'Network: _setupInternal > sn.listen > callback > remote', remote)
      } finally {
        profilerInstance.profileSectionEnd('net-internl')
        profilerInstance.profileSectionEnd(`net-internl-${routeName}`)
      }
    })
    console.log(`Internal server running on port ${this.ipInfo.internalPort}...`)

    //pass logflags to shardus network
    this.sn.setLogFlags(logFlags)
  }

  /**
   *
   * @param nodes
   * @param route
   * @param message
   * @param alreadyLogged this is so that gossip system can indicate that we already have recorded playback logs
   */
  async tell(nodes: Shardus.Node[], route: string, message, alreadyLogged = false, subRoute = '') {
    const data = { route, payload: message }
    const promises = []
    let id = ''
    if (message.tracker) {
      id = message.tracker
    }
    if (!nodes || nodes.length == 0) {
      /* prettier-ignore */ if (logFlags.net_verbose) console.log("returning tell because the node list is empty for route:" , route)
      return
    }
    for (const node of nodes) {
      /* prettier-ignore */ if (logFlags.playback && alreadyLogged === false) this.logger.playbackLog('self', node, 'InternalTell', route, id, message)
      const requestId = generateUUID()
      /* prettier-ignore */ if (logFlags.net_verbose) mainLogger.info(`Initiating tell request with requestId: ${requestId}`)
      /* prettier-ignore */ if (logFlags.net_verbose) mainLogger.info(`requestId: ${requestId}, node: ${utils.logNode(node)}`)
      /* prettier-ignore */ if (logFlags.net_verbose) mainLogger.info(`route: ${route} ${subRoute}, message: ${message} requestId: ${requestId}`)
      this.InternalTellCounter++
      const promise = this.sn.send(node.internalPort, node.internalIp, data)
      promise.catch((err) => {
        /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`Network error (tell) on ${route} ${subRoute}: ${formatErrorMessage(err)}` )
        let errorGroup = ('' + err).slice(0, 20)
        nestedCountersInstance.countEvent('network', `error2-tell ${route} ${subRoute}`)
        this.emit('error', node, requestId, 'tell', errorGroup, route, subRoute)
      })
      promises.push(promise)
    }
    try {
      await Promise.all(promises)
    } catch (err) {
      nestedCountersInstance.countEvent('network', `error-tell ${route} ${subRoute}`)
      /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`Network error (tell-err) on ${route} ${subRoute}: ${formatErrorMessage(err)}`)
    }
  }

  async tellBinary(
    nodes: Shardus.Node[],
    route: string,
    message: Buffer,
    appHeader: AppHeader,
    trackerId: string,
    alreadyLogged = false
  ) {
    const data = { route, payload: message }
    const promises = []

    if (!nodes || nodes.length == 0) {
      /* prettier-ignore */ if (logFlags.net_verbose) console.log("returning from tellBinary because the node list is empty for route:" , route)
      return
    }
    if (config.p2p.useCombinedTellBinary) {
      const ports = []
      const addresses = []
      const requestId = generateUUID()
      for (const node of nodes) {
        /* prettier-ignore */ if (logFlags.playback && alreadyLogged === false) this.logger.playbackLog('self', node, 'InternalTellBinary', route, trackerId, message)
        /* prettier-ignore */ if (logFlags.net_verbose) this.mainLogger.info(`tellBinary: initiating tell request with useCombinedTellBinary enabled on requestId: ${requestId}`)
        /* prettier-ignore */ if (logFlags.net_verbose) this.mainLogger.info(`tellBinary: requestId: ${requestId}, node: ${utils.logNode(node)}`)
        /* prettier-ignore */ if (logFlags.net_verbose) this.mainLogger.info(`tellBinary: route: ${route}, message: ${message} requestId: ${requestId}`)
        this.InternalTellCounter++
        ports.push(node.internalPort)
        addresses.push(node.internalIp)
      }

      try {
        await this.sn.multiSendWithHeader(ports, addresses, data, appHeader)
      } catch (err) {
        let errorGroup = ('' + err).slice(0, 20)
        nestedCountersInstance.countEvent('network', `error2-tellBinary ${route}`)
        //commenting out to temp fix GOLD-46 and GOLD-52
        // this.emit('error', nodes, requestId, 'tellBinary', errorGroup, route)
        /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`Network error (tellBinary) on ${route}: ${formatErrorMessage(err)}`)
      }
    } else {
      for (const node of nodes) {
        /* prettier-ignore */ if (logFlags.playback && alreadyLogged === false) this.logger.playbackLog('self', node, 'InternalTellBinary', route, trackerId, message)
        const requestId = generateUUID()
        /* prettier-ignore */ if (logFlags.net_verbose) this.mainLogger.info(`tellBinary: initiating tell request with useCombinedTellBinary disabled on requestId: ${requestId}`)
        /* prettier-ignore */ if (logFlags.net_verbose) this.mainLogger.info(`tellBinary: requestId: ${requestId}, node: ${utils.logNode(node)}`)
        /* prettier-ignore */ if (logFlags.net_verbose) this.mainLogger.info(`tellBinary: route: ${route}, message: ${message} requestId: ${requestId}`)
        this.InternalTellCounter++
        const promise = this.sn.sendWithHeader(node.internalPort, node.internalIp, data, appHeader)
        promise.catch((err) => {
          /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`Network error (tellBinary) on ${route}: ${formatErrorMessage(err)}`)
          let errorGroup = ('' + err).slice(0, 20)
          nestedCountersInstance.countEvent('network', `error2-tellBinary ${route}`)
          this.emit('error', node, requestId, 'tellBinary', errorGroup, route)
        })
        promises.push(promise)
      }
      try {
        await Promise.all(promises)
      } catch (err) {
        nestedCountersInstance.countEvent('network', `error-tellBinary ${route}`)
        /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`Network error (tellBinary-promise) on ${route}: ${formatErrorMessage(err)}`)
      }
    }
  }

  ask(node, route, message, alreadyLogged = false, extraTime = 0) {
    return new Promise(async (resolve, reject) => {
      this.InternalAskCounter++
      let id = ''
      if (message.tracker) {
        id = message.tracker
      }

      const requestId = generateUUID()
      /* prettier-ignore */ if (logFlags.net_verbose) mainLogger.info(`Initiating ask request with requestId: ${requestId}`)
      /* prettier-ignore */ if (logFlags.net_verbose) mainLogger.info(`requestId: ${requestId}, node: ${utils.logNode(node)}`)
      /* prettier-ignore */ if (logFlags.net_verbose) mainLogger.info(`route: ${route}, message: ${message} requestId: ${requestId}`)

      try {
        if (this.debugNetworkDelay > 0) {
          await utils.sleep(this.debugNetworkDelay)
        }
        profilerInstance.profileSectionStart('net-ask')
        profilerInstance.profileSectionStart(`net-ask-${route}`)

        const data = { route, payload: message }
        const onRes = (res) => {
          /* prettier-ignore */ if (logFlags.playback && alreadyLogged === false) this.logger.playbackLog('self', node, 'InternalAskResp', route, id, res)
          resolve(res)
        }
        const onTimeout = () => {
          nestedCountersInstance.countEvent('network', 'timeout')
          if (this.statisticsInstance) this.statisticsInstance.incrementCounter('networkTimeout')
          const err = new Error(`Request timed out. ${utils.stringifyReduce(id)}`)
          nestedCountersInstance.countRareEvent('network', 'timeout ' + route)
          /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`Network timeout (ask) on ${route}: ${formatErrorMessage(err)}`)
          this.emit('timeout', node, requestId, 'ask')
          reject(err)
        }
        /* prettier-ignore */ if (logFlags.playback && alreadyLogged === false) this.logger.playbackLog('self', node, 'InternalAsk', route, id, message)
        try {
          await this.sn.send(
            node.internalPort,
            node.internalIp,
            data,
            this.timeout + extraTime,
            onRes,
            onTimeout
          )
        } catch (err) {
          nestedCountersInstance.countEvent('network', `error-ask ${route}`)
          /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`Network error (ask-err) on ${route}: ${formatErrorMessage(err)}`)
          let errorGroup = ('' + err).slice(0, 20)
          this.emit('error', node, requestId, 'ask', errorGroup, route, '')
        }
      } finally {
        profilerInstance.profileSectionEnd('net-ask')
        profilerInstance.profileSectionEnd(`net-ask-${route}`)
      }
    })
  }

  askBinary(
    node,
    route: string,
    message: Buffer,
    appHeader: AppHeader,
    trackerId: string,
    alreadyLogged = false,
    extraTime = 0
  ) {
    return new Promise<{ res: Buffer; header?: AppHeader; sign?: Shardus.Sign }>(async (resolve, reject) => {
      this.InternalAskCounter++

      const requestId = generateUUID()
      /* prettier-ignore */ if (logFlags.net_verbose) this.mainLogger.info(`askBinary: initiating ask request with requestId: ${requestId}`)
      /* prettier-ignore */ if (logFlags.net_verbose) this.mainLogger.info(`askBinary: requestId: ${requestId}, node: ${utils.logNode(node)}`)
      /* prettier-ignore */ if (logFlags.net_verbose) this.mainLogger.info(`askBinary: route: ${route}, message: ${message} requestId: ${requestId}`)

      try {
        if (this.debugNetworkDelay > 0) {
          await utils.sleep(this.debugNetworkDelay)
        }
        profilerInstance.profileSectionStart('net-askBinary')
        profilerInstance.profileSectionStart(`net-askBinary-${route}`)

        const data = { route, payload: message }
        const onRes = (res, header, sign) => {
          /* prettier-ignore */ if (logFlags.playback && alreadyLogged === false) this.logger.playbackLog('self', node, 'InternalAskResp', route, trackerId, res)
          resolve({ res, header, sign })
        }
        const onTimeout = () => {
          nestedCountersInstance.countEvent('network', 'timeout')
          if (this.statisticsInstance) this.statisticsInstance.incrementCounter('networkTimeout')
          const err = new Error(`askBinary: request timed out. ${utils.stringifyReduce(trackerId)}`)
          nestedCountersInstance.countRareEvent('network', 'timeout ' + route)
          /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`Network timeout (askBinary) on ${route}: ${formatErrorMessage(err)} node: ${utils.logNode(node)}`)
          this.emit('timeout', node, requestId, 'askBinary')
          reject(err)
        }
        /* prettier-ignore */ if (logFlags.playback && alreadyLogged === false) this.logger.playbackLog('self', node, 'InternalAsk', route, trackerId, message)
        try {
          await this.sn.sendWithHeader(
            node.internalPort,
            node.internalIp,
            data,
            appHeader,
            this.timeout + extraTime,
            onRes,
            onTimeout
          )
        } catch (err) {
          nestedCountersInstance.countEvent('network', `error-askBinary ${route}`)
          /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`Network error (askBinary) on ${route}: ${formatErrorMessage(err)}`)
          let errorGroup = ('' + err).slice(0, 20)
          //this.mainLogger.info(`askBinary: sendWithHeader: error: ${err}`)
          this.emit('error', node, requestId, 'ask', errorGroup, route, '')
        }
      } finally {
        profilerInstance.profileSectionEnd('net-askBinary')
        profilerInstance.profileSectionEnd(`net-askBinary-${route}`)
      }
    })
  }

  evictCachedSockets(nodes: Shardus.Node[]) {
    if (!this.sn) return
    for (const node of nodes) {
      try {
        profilerInstance.profileSectionStart('net-evictCachedSockets')
        /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`Evicting socket for node ${node.id}, (ip: ${node.internalIp}, port: ${node.internalPort})`)
        this.sn.evictSocket(node.internalPort, node.internalIp)
        nestedCountersInstance.countEvent('network', 'evict-cached-sockets')
      } catch (err) {
        /* prettier-ignore */ if (logFlags.error) this.mainLogger.error(`Error evicting socket for node ${node.id}: ${err}, (ip: ${node.internalIp}, port: ${node.internalPort})`)
      } finally {
        /* prettier-ignore */ if (logFlags.debug) this.mainLogger.debug(`Evicted socket for node ${node.id}, (ip: ${node.internalIp}, port: ${node.internalPort})`)
        profilerInstance.profileSectionEnd('net-evictCachedSockets')
      }
    }
  }

  async setup(ipInfo: IPInfo, signingSecretKeyHex: string) {
    if (!ipInfo.externalIp) throw new Error('Fatal: network module requires externalIp')
    if (!ipInfo.externalPort) throw new Error('Fatal: network module requires externalPort')
    if (!ipInfo.internalIp) throw new Error('Fatal: network module requires internalIp')
    if (!ipInfo.internalPort) throw new Error('Fatal: network module requires internalPort')

    this.ipInfo = ipInfo
    this.signingSecretKeyHex = signingSecretKeyHex

    this.logger.setPlaybackIPInfo(ipInfo)

    this._setupInternal()
    return await this._setupExternal()
  }

  async shutdown() {
    try {
      const promises = []
      if (this.extServer) promises.push(closeServer(this.extServer))
      // [TODO] - need to see why it is taking minutes for stopListening promises to return; for now Omar decided to comment this out
      //      if (this.sn) promises.push(this.sn.stopListening(this.intServer))
      if (natClient) promises.push(natClient.es6.destroy())
      await Promise.all(promises)
    } catch (e) {
      if (e.code !== 'ERR_SERVER_NOT_RUNNING') throw e
    }
  }

  _registerExternal(method: string, route: string, responseHandler: Handler)
  _registerExternal(method: string, route: string, authHandler: Handler, responseHandler: Handler)
  _registerExternal(method: string, route: string, authHandler: Handler, responseHandler?: Handler) {
    const formattedRoute = `/${route}`
    const handlers = []

    // This logic normalizes the optional parameter of the method signature.
    // If the responseHandler is null, then the value set as the authHandler param is actually the responseHandler.
    if (!responseHandler) {
      responseHandler = authHandler
      authHandler = null
    }

    if (logFlags.playback) {
      const playbackHandler = (req, res, next) => {
        this.logger.playbackLog(req.hostname, 'self', 'ExternalHttpReq', formattedRoute, '', {
          params: req.params,
          body: req.body,
        })

        next()
      }

      handlers.push(playbackHandler)
    }

    if (authHandler) {
      handlers.push(authHandler)
    }

    if (isDebugMode() && ['GET', 'POST'].includes(method)) {
      const wrappedHandler = async (req, res, next) => {
        profilerInstance.profileSectionStart('net-externl', false)
        profilerInstance.profileSectionStart(`net-externl-${route}`, false)
        profilerInstance.scopedProfileSectionStart(`net-externl-${route}`, false)

        let result
        try {
          result = await responseHandler(req, res, next)
        } finally {
          profilerInstance.scopedProfileSectionEnd(`net-externl-${route}`)
          profilerInstance.profileSectionEnd(`net-externl-${route}`, false)
          profilerInstance.profileSectionEnd('net-externl', false)
        }

        return result
      }

      handlers.push(wrappedHandler)
    } else {
      handlers.push(responseHandler)
    }

    let expressMethod = {
      GET: 'get',
      POST: 'post',
      PUT: 'put',
      DELETE: 'delete',
      PATCH: 'patch',
    }[method]

    if (!expressMethod) {
      throw new Error(`Fatal: Invalid HTTP method for handler ${method}.`)
    }

    this.externalRoutes.push((app) => {
      app[expressMethod](formattedRoute, handlers)
    })

    if (this.extServer && this.extServer.listening) {
      this._applyExternal()
    }
  }

  _applyExternal() {
    while (this.externalRoutes.length > 0) {
      const routeFn = this.externalRoutes.pop()
      routeFn(this.app)
    }
  }

  setExternalCatchAll(handler) {
    this.externalCatchAll = handler
  }

  registerExternalGet(route: string, responseHandler: Handler)
  registerExternalGet(route: string, authHandler: Handler, responseHandler: Handler)
  registerExternalGet(route: string, authHandler: Handler, responseHandler?: Handler) {
    this._registerExternal('GET', route, authHandler, responseHandler)
  }

  registerExternalPost(route: string, responseHandler: Handler)
  registerExternalPost(route: string, authHandler: Handler, responseHandler: Handler)
  registerExternalPost(route: string, authHandler: Handler, responseHandler?: Handler) {
    this._registerExternal('POST', route, authHandler, responseHandler)
  }

  registerExternalPut(route: string, responseHandler: Handler)
  registerExternalPut(route: string, authHandler: Handler, responseHandler: Handler)
  registerExternalPut(route: string, authHandler: Handler, responseHandler?: Handler) {
    this._registerExternal('PUT', route, authHandler, responseHandler)
  }

  registerExternalDelete(route: string, responseHandler: Handler)
  registerExternalDelete(route: string, authHandler: Handler, responseHandler: Handler)
  registerExternalDelete(route: string, authHandler: Handler, responseHandler?: Handler) {
    this._registerExternal('DELETE', route, authHandler, responseHandler)
  }

  registerExternalPatch(route: string, responseHandler: Handler)
  registerExternalPatch(route: string, authHandler: Handler, responseHandler: Handler)
  registerExternalPatch(route: string, authHandler: Handler, responseHandler?: Handler) {
    this._registerExternal('PATCH', route, authHandler, responseHandler)
  }

  registerInternal(route: string, handler) {
    if (this.internalRoutes[route]) throw Error('Handler already exists for specified internal route.')
    this.internalRoutes[route] = handler
  }

  unregisterInternal(route) {
    if (this.internalRoutes[route]) {
      delete this.internalRoutes[route]
    }
  }
}

/** FUNCTIONS */

// export async function init() {
//   mainLogger = logger.getLogger('main')

//   // Make sure we know our IP configuration
//   ipInfo = {
//     externalIp:
//       config.ip.externalIp || (await discoverExternalIp(config.p2p.ipServer)),
//     externalPort: config.ip.externalPort,
//     internalIp: config.ip.internalIp,
//     internalPort: config.ip.internalPort,
//   }
// }

export async function init() {
  // Get main logger
  mainLogger = logger.getLogger('main')

  // Get default values for IP config
  const defaults = defaultConfigs['server']['ip'] as IPInfo

  // Set ipInfo to passed config, automtically if passed 'auto', or to default
  const externalIp =
    (config.ip.externalIp === 'auto' ? await getExternalIp() : config.ip.externalIp) || defaults['externalIp']

  const externalPort =
    (config.ip.externalPort === 'auto' ? await getNextExternalPort(externalIp) : config.ip.externalPort) ||
    defaults['externalPort']

  const internalIp =
    (config.ip.internalIp === 'auto' ? externalIp : config.ip.internalIp) || defaults['internalIp']

  const internalPort =
    (config.ip.internalPort === 'auto' ? await getNextExternalPort(internalIp) : config.ip.internalPort) ||
    defaults['internalPort']

  ipInfo = {
    externalIp,
    externalPort,
    internalIp,
    internalPort,
  }

  if (logFlags.info) {
    mainLogger.info('This nodes ipInfo:')
    mainLogger.info(JSON.stringify(ipInfo, null, 2))
  }
}

function initNatClient() {
  // Initialize 'nat-api' client if not initialized
  if (!natClient) {
    natClient = new NatAPI()
    natClient['es6'] = {}
    natClient['es6']['externalIp'] = promisify(natClient.externalIp.bind(natClient))
    natClient['es6']['map'] = promisify(natClient.map.bind(natClient))
    natClient['es6']['destroy'] = promisify(natClient.destroy.bind(natClient))
  }
}

async function getExternalIp() {
  initNatClient()

  try {
    const ip = await natClient.es6.externalIp()
    return ip
  } catch (err) {
    mainLogger.warn('Failed to get external IP from gateway:', err.message ? err.message : err)

    try {
      const ip = await discoverExternalIp(config.p2p.ipServers)
      return ip
    } catch (err) {
      mainLogger.warn('Failed to get external IP from IP server:', err.message ? err.message : err)
    }
  }
}

async function getNextExternalPort(ip: string) {
  initNatClient()

  // Get the next available port from the OS and test it
  let [reachable, port] = await wrapTest(new ConnectTest(ip))

  // If port is unreachable attempt to forward it with UPnP, then PMP
  if (reachable === false) {
    const attempts = [{ enablePMP: false }, { enablePMP: true }]

    for (const opts of attempts) {
      if (logFlags.info) mainLogger.info(`Forwarding ${port} via ${opts.enablePMP ? 'PMP' : 'UPnP'}...`)

      try {
        await natClient.es6.map(Object.assign({ publicPort: port, privatePort: port, protocol: 'TCP' }, opts))
        if (logFlags.info) mainLogger.info('  Success!')
        break
      } catch (err) {
        if (logFlags.info) mainLogger.info('  Error:', err.message)
      }
    }
  }

  // Test it again
  ;[reachable] = await wrapTest(new ConnectTest(ip, port))
  if (reachable) {
    return port
  } else {
    mainLogger.warn('Failed to get next external port')
  }
}

async function wrapTest(test: ConnectTest) {
  if (logFlags.info) mainLogger.info(`Testing ${test.ip}...`)

  test.once('port', (port) => {
    if (logFlags.info) mainLogger.info(`  Listening on ${port}. Connecting...`)
  })

  let result: [boolean, number]

  try {
    const success = await test.start()
    result = [success, test.port]
    if (logFlags.info) mainLogger.info('  Success!')
  } catch (err) {
    if (logFlags.info) mainLogger.info('  Failed:', err.message ? err.message : err)
    result = [false, test.port]
  }

  return result
}

class ConnectTest extends EventEmitter {
  ip: string
  port: number
  constructor(ip: string, port?: number) {
    super()
    this.ip = ip
    this.port = port || -1
  }
  start() {
    return new Promise<true>((resolve, reject) => {
      // Open a port on 0.0.0.0 (any IP)
      const server = net.createServer(() => {})
      server.unref()
      server.on('error', reject)
      const listenPort = this.port > -1 ? this.port : 0
      server.listen(listenPort, () => {
        // Get opened port
        const address = server.address() as net.AddressInfo
        this.port = address.port
        this.emit('port', this.port)

        // Try to connect to given IP at opened port
        const socket = net.createConnection(this.port, this.ip, () => {
          socket.destroy()
          server.close(() => resolve(true))
        })
        socket.unref()
        socket.setTimeout(2000)
        socket.on('error', (err) => {
          socket.destroy()
          server.close()
          reject(err)
        })
        socket.on('timeout', () => {
          socket.destroy()
          server.close()
          reject('Connection timed out')
        })
      })
    })
  }
}

/**
 * Gets and offset time from NTP servers.  Returns false if not within
 * config.p2p.syncLimit although this is tuned wrong (too high)
 * and not used
 *
 * @param timeServers
 * @returns
 */
export async function checkAndUpdateTimeSyncedOffset(timeServers) {
  // Ignore time check if debug flag is set
  if (config.debug.ignoreTimeCheck === true) return true

  // Check if local time is within 5 minutes of time servers
  for (const host of timeServers) {
    try {
      const time = await Sntp.time({
        host,
        timeout: 10000,
      })
      //update our offset convert from seconds to MS
      //docs are wrong... time.t seems to be in ms
      ntpOffsetMs = Math.floor(time.t)
      const isInRange = time.t <= config.p2p.syncLimit * 1000 //convert config to ms

      lastNTPTimeObj = time
      //check if ntpOffsetMs is a number
      if (isNaN(ntpOffsetMs)) {
        mainLogger.warn(`NTP Error time.t is NaN ${ntpOffsetMs}`)
        ntpOffsetMs = 0
      }

      /* prettier-ignore */ console.log(`ntpOffset ${ntpOffsetMs} Offset is in range: ${isInRange} time:${Utils.safeStringify(time)} host:${host}}`)
      return isInRange
    } catch (e) {
      mainLogger.warn(`Couldn't fetch ntp time from server at ${host}`)
      ntpOffsetMs = 0
    }
  }
  throw Error('Unable to check local time against time servers.')
}

export function shardusGetTime(): number {
  if (config.p2p.useNTPOffsets === true) {
    return Date.now() + ntpOffsetMs
  }
  return Date.now()
}

export function getNetworkTimeOffset(): number {
  if (config.p2p.useNTPOffsets === true) {
    return ntpOffsetMs
  }
  return ntpOffsetMs
}

export function getLastNTPObject(): any {
  return lastNTPTimeObj
}

async function discoverExternalIp(servers: string[]) {
  // Figure out if we're behind a NAT
  // Attempt NAT traversal with UPnP

  //
  for (const server of servers) {
    try {
      const { ip }: { ip: string } = await httpModule.get(server)
      return ip
    } catch (err) {
      mainLogger.warn(
        `p2p/Self:discoverExternalIp: Could not discover IP from external IP server ${server}: ` + err.message
      )
    }
  }
}

function closeServer(server) {
  return new Promise<void>((resolve) => {
    server.close()
    server.unref()
    resolve()
  })
}
