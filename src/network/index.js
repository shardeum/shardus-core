const Qn = require('shardus-quic-net')
const express = require('express')
const bodyParser = require('body-parser')

class Network {
  constructor (config, logger) {
    this.app = express()
    this.mainLogger = logger.getLogger('main')
    this.netLogger = logger.getLogger('net')
    this.ipInfo = {}
    this.timeout = config.timeout * 1000
    this.internalRoutes = {}
  }

  _setupExternal () {
    return new Promise((resolve, reject) => {
      this.app.use(bodyParser.json())
      this.app.listen(this.ipInfo.externalPort, this.ipInfo.externalIp, () => {
        const msg = `Server running on port ${this.ipInfo.externalPort}...`
        console.log(msg)
        this.mainLogger.info(msg)
        resolve()
      })
    })
  }

  async _setupInternal () {
    this.qn = Qn({
      port: this.ipInfo.internalPort,
      address: this.ipInfo.internalIp
    })

    await this.qn.listen(async (data, remote, protocol, respond) => {
      if (!data) throw Error('No data provided in request...')
      const { route, payload } = data
      if (!route) throw Error('Unable to read request, no route specified.')
      if (!this.internalRoutes[route]) throw Error('Unable to handle request, invalid route.')
      const handler = this.internalRoutes[route]
      if (!data.payload) {
        await handler(respond)
        return
      }
      await handler(payload, respond)
    })
  }

  async tell (nodes, route, message) {
    const data = { route, payload: message }
    const promises = []
    for (const node of nodes) {
      const promise = this.qn.send(node.internalPort, node.internalIp, data)
      promises.push(promise)
    }
    await Promise.all(promises)
  }

  ask (node, route, message) {
    return new Promise(async (resolve, reject) => {
      const data = { route, payload: message }
      const onRes = (res) => {
        resolve(res)
      }
      const onTimeout = () => {
        const err = new Error('Request timed out.')
        this.mainLogger.error(err)
        reject(err)
      }
      await this.qn.send(node.internalPort, node.internalIp, data, this.timeout, onRes, onTimeout)
    })
  }

  async setup (ipInfo) {
    if (!ipInfo.externalIp) throw new Error('Fatal: network module requires externalIp')
    if (!ipInfo.externalPort) throw new Error('Fatal: network module requires externalPort')
    if (!ipInfo.internalIp) throw new Error('Fatal: network module requires internalIp')
    if (!ipInfo.internalPort) throw new Error('Fatal: network module requires internalPort')

    this.ipInfo = ipInfo
    await this._setupExternal()
    this._setupInternal()
  }

  _registerExternal (method, route, handler) {
    const formattedRoute = `/${route}`
    switch (method) {
      case 'GET':
        this.app.get(formattedRoute, handler)
        break
      case 'POST':
        this.app.post(formattedRoute, handler)
        break
      default:
        throw Error('Fatal: Invalid HTTP method for handler.')
    }
  }

  registerExternalGet (route, handler) {
    this._registerExternal('GET', route, handler)
  }

  registerExternalPost (route, handler) {
    this._registerExternal('POST', route, handler)
  }

  registerInternal (route, handler) {
    this.internalRoutes[route] = handler
  }

  // TODO: Upon getting a request, we should check to see if a such a route exists,
  // Then call the appropriate corresponding callback and pass the payload object
}

module.exports = Network
