const EventEmitter = require('events')
const Sn = require('shardus-net')
const express = require('express')
const bodyParser = require('body-parser')
const cors = require('cors')

class Network extends EventEmitter {
  constructor (config, logger) {
    super()
    this.app = express()
    this.sn = null
    this.logger = logger
    this.mainLogger = logger.getLogger('main')
    this.netLogger = logger.getLogger('net')
    this.ipInfo = {}
    this.timeout = config.timeout * 1000
    this.internalRoutes = {}
    this.externalRoutes = []
    this.extServer = null
    this.intServer = null

    this.verboseLogsNet = false
    if (this.netLogger && ['TRACE'].includes(this.netLogger.level.levelStr)) {
      this.verboseLogsNet = true
    }
    // console.log('NETWORK LOGGING ' + this.verboseLogsNet + '  ' + this.netLogger.level.levelStr)

    this.InternalTellCounter = 1
    this.InternalAskCounter = 1
  }

  // TODO: Allow for binding to a specified network interface
  _setupExternal () {
    return new Promise((resolve, reject) => {
      const self = this
      const storeRequests = function (req, res, next) {
        if (req.url !== '/test') {
          if (self.verboseLogsNet) {
            self.netLogger.debug('External\t' + JSON.stringify({
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
      this._applyExternal()
      this.extServer = this.app.listen(this.ipInfo.externalPort, () => {
        const msg = `External server running on port ${this.ipInfo.externalPort}...`
        console.log(msg)
        this.mainLogger.info('Network: ' + msg)
        resolve()
      })
    })
  }

  // TODO: Allow for binding to a specified network interface
  async _setupInternal () {
    this.sn = Sn({
      port: this.ipInfo.internalPort
    })
    this.intServer = await this.sn.listen(async (data, remote, respond) => {
      try {
        if (!data) throw new Error('No data provided in request...')
        const { route, payload } = data
        if (!route) {
          this.mainLogger.debug('Network: ' + `Unable to read request, payload of received message: ${JSON.stringify(data)}`)
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
          this.netLogger.debug('Internal\t' + JSON.stringify({
            url: route,
            body: payload
          }))
        }
      } catch (err) {
        this.mainLogger.error('Network: _setupInternal: ' + err)
        respond({ status: 'Internal route error: ' + err })
      }
    })
    console.log(`Internal server running on port ${this.ipInfo.internalPort}...`)
  }

  async tell (nodes, route, message, logged = false) {
    const data = { route, payload: message }
    const promises = []
    let id = ''
    if (message.tracker) {
      id = message.tracker
    }
    for (const node of nodes) {
      if (!logged) this.logger.playbackLog('self', node, 'InternalTell', route, id, message)
      this.InternalTellCounter++
      const promise = this.sn.send(node.internalPort, node.internalIp, data)
      promise.catch(err => {
        this.mainLogger.error('Network: ' + err)
        this.emit('error', node)
      })
      promises.push(promise)
    }
    try {
      await Promise.all(promises)
    } catch (err) {
      this.mainLogger.error('Network: ' + err)
    }
  }

  ask (node, route, message, logged = false) {
    return new Promise(async (resolve, reject) => {
      this.InternalAskCounter++
      let id = ''
      if (message.tracker) {
        id = message.tracker
      }

      const data = { route, payload: message }
      const onRes = (res) => {
        if (!logged) this.logger.playbackLog('self', node, 'InternalAskResp', route, id, res)
        resolve(res)
      }
      const onTimeout = () => {
        const err = new Error('Request timed out.')
        this.mainLogger.error('Network: ' + err)
        this.emit('timeout', node)
        reject(err)
      }
      if (!logged) this.logger.playbackLog('self', node, 'InternalAsk', route, id, message)
      try {
        await this.sn.send(node.internalPort, node.internalIp, data, this.timeout, onRes, onTimeout)
      } catch (err) {
        this.mainLogger.error('Network: ' + err)
        this.emit('error', node)
      }
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
      const promises = []
      if (this.extServer) promises.push(closeServer(this.extServer))
      if (this.sn) promises.push(this.sn.stopListening(this.intServer))
      await Promise.all(promises)
    } catch (e) {
      if (e.code !== 'ERR_SERVER_NOT_RUNNING') throw e
    }
  }

  _registerExternal (method, route, handler) {
    const formattedRoute = `/${route}`

    let self = this
    let wrappedHandler = handler
    if (this.logger.playbackLogEnabled) {
      wrappedHandler = function (req, res) {
        self.logger.playbackLog(req.hostname, 'self', 'ExternalHttpReq', formattedRoute, '', { params: req.params, body: req.body })
        return handler(req, res)
      }
      // handler = wrappedHandler
    }

    switch (method) {
      case 'GET':
        this.externalRoutes.push(app => {
          app.get(formattedRoute, wrappedHandler)
        })
        break
      case 'POST':
        this.externalRoutes.push(app => {
          app.post(formattedRoute, wrappedHandler)
        })
        break
      case 'PUT':
        this.externalRoutes.push(app => {
          app.put(formattedRoute, wrappedHandler)
        })
        break
      case 'DELETE':
        this.externalRoutes.push(app => {
          app.delete(formattedRoute, wrappedHandler)
        })
        break
      case 'PATCH':
        this.externalRoutes.push(app => {
          app.patch(formattedRoute, wrappedHandler)
        })
        break
      default:
        throw new Error('Fatal: Invalid HTTP method for handler.')
    }

    if (this.extServer && this.extServer.listening) {
      this._applyExternal()
    }
  }

  _applyExternal () {
    while (this.externalRoutes.length > 0) {
      const routeFn = this.externalRoutes.pop()
      routeFn(this.app)
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
    if (this.internalRoutes[route]) throw Error('Handler already exists for specified internal route.')
    this.internalRoutes[route] = handler
  }

  unregisterInternal (route) {
    if (this.internalRoutes[route]) {
      delete this.internalRoutes[route]
    }
  }
}

function closeServer (server) {
  return new Promise((resolve) => {
    server.close()
    server.unref()
    resolve()
  })
}

module.exports = Network
