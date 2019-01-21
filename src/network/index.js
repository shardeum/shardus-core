const Qn = require('shardus-quic-net')
const express = require('express')
const bodyParser = require('body-parser')
const cors = require('cors')

class Network {
  constructor (config, logger) {
    this.app = express()
    this.qn = null
    this.logger = logger
    this.mainLogger = logger.getLogger('main')
    this.netLogger = logger.getLogger('net')
    this.ipInfo = {}
    this.timeout = config.timeout * 1000
    this.internalRoutes = {}
    this.extServer = null
    this.intServers = null

    this.verboseLogsNet = false
    if (this.netLogger && ['TRACE'].includes(this.netLogger.level.levelStr)) {
      this.verboseLogsNet = true
    }
    // console.log('NETWORK LOGGING ' + this.verboseLogsNet + '  ' + this.netLogger.level.levelStr)
  }

  // TODO: Allow for binding to a specified network interface
  _setupExternal () {
    return new Promise((resolve, reject) => {
      const self = this
      const storeRequests = function (req, res, next) {
        if (req.url !== '/test') {
          if (self.verboseLogsNet) {
            self.netLogger.debug(JSON.stringify({
              url: req.url,
              method: req.method,
              body: req.body
            }))
          }
        }
        next()
      }
      this.app.use(bodyParser.json())
      this.app.use(cors())
      this.app.use(storeRequests)
      this.extServer = this.app.listen(this.ipInfo.externalPort, () => {
        const msg = `External server running on port ${this.ipInfo.externalPort}...`
        console.log(msg)
        this.mainLogger.info(msg)
        resolve()
      })
    })
  }

  // TODO: Allow for binding to a specified network interface
  async _setupInternal () {
    this.qn = Qn({
      port: this.ipInfo.internalPort
    })
    this.intServers = await this.qn.listen(async (data, remote, protocol, respond) => {
      if (!data) throw new Error('No data provided in request...')
      const { route, payload } = data
      if (!route) {
        this.mainLogger.debug(`Unable to read request, payload of received message: ${JSON.stringify(data)}`)
        throw new Error('Unable to read request, no route specified.')
      }
      if (!this.internalRoutes[route]) throw new Error('Unable to handle request, invalid route.')
      const handler = this.internalRoutes[route]
      if (!payload) {
        await handler(null, respond)
        return
      }
      await handler(payload, respond)
      if (this.verboseLogsNet) {
        this.netLogger.debug(JSON.stringify({
          url: route,
          body: payload
        }))
      }
    })
    console.log(`Internal server running on port ${this.ipInfo.internalPort}...`)
  }

  async tell (nodes, route, message, logged = false) {
    const data = { route, payload: message }
    const promises = []
    for (const node of nodes) {
      if (!logged) this.logger.playbackLog('self', node, 'InternalTell', route, '', message)
      const promise = this.qn.send(node.internalPort, node.internalIp, data)
      promises.push(promise)
    }
    await Promise.all(promises)
  }

  ask (node, route, message, logged = false) {
    return new Promise(async (resolve, reject) => {
      const data = { route, payload: message }
      const onRes = (res) => {
        if (!logged) this.logger.playbackLog('self', node, 'InternalAskResp', route, '', res)
        resolve(res)
      }
      const onTimeout = () => {
        const err = new Error('Request timed out.')
        this.mainLogger.error(err)
        reject(err)
      }
      if (!logged) this.logger.playbackLog('self', node, 'InternalAsk', route, '', message)
      await this.qn.send(node.internalPort, node.internalIp, data, this.timeout, onRes, onTimeout)
    })
  }

  async setup (ipInfo) {
    if (!ipInfo.externalIp) throw new Error('Fatal: network module requires externalIp')
    if (!ipInfo.externalPort) throw new Error('Fatal: network module requires externalPort')
    if (!ipInfo.internalIp) throw new Error('Fatal: network module requires internalIp')
    if (!ipInfo.internalPort) throw new Error('Fatal: network module requires internalPort')

    this.ipInfo = ipInfo

    this.logger.setPlaybackIPInfo(ipInfo)

    await this._setupExternal()
    this._setupInternal()
  }

  async shutdown () {
    try {
      await Promise.all([
        closeServer(this.extServer),
        this.qn.stopListening(this.intServers)
      ])
    } catch (e) {
      throw e
    }
  }

  _registerExternal (method, route, handler) {
    const formattedRoute = `/${route}`

    let self = this
    let wrappedHandler = handler
    if (this.logger.playbackLogEnabled) {
      wrappedHandler = function (req, res) {
        self.logger.playbackLog(req.hostname, 'self', 'ExternalRecv', route, '', { params: req.params, body: req.body })
        return handler(req, res)
      }
      // handler = wrappedHandler
    }

    switch (method) {
      case 'GET':
        this.app.get(formattedRoute, wrappedHandler)
        break
      case 'POST':
        this.app.post(formattedRoute, wrappedHandler)
        break
      case 'PUT':
        this.app.put(formattedRoute, wrappedHandler)
        break
      case 'DELETE':
        this.app.delete(formattedRoute, wrappedHandler)
        break
      case 'PATCH':
        this.app.patch(formattedRoute, wrappedHandler)
        break
      default:
        throw new Error('Fatal: Invalid HTTP method for handler.')
    }
  }

  setExternalCatchAll (handler) {
    this.externalCatchAll = handler
  }

  registerExternalGet (route, handler) {
    this._registerExternal('GET', route, handler)
  }

  registerExternalPost (route, handler) {
    this._registerExternal('POST', route, handler)
  }

  registerExternalPut (route, handler) {
    this._registerExternal('PUT', route, handler)
  }

  registerExternalDelete (route, handler) {
    this._registerExternal('DELETE', route, handler)
  }

  registerExternalPatch (route, handler) {
    this._registerExternal('PATCH', route, handler)
  }

  registerInternal (route, handler) {
    this.internalRoutes[route] = handler
  }
}

function closeServer (server) {
  return new Promise((resolve, reject) => {
    server.close(err => err ? reject(err) : resolve())
  })
}

module.exports = Network
