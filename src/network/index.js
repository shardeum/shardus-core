const Qn = require('shardus-quic-net')
const express = require('express')

class Network {
  constructor (logger) {
    this.app = express()
    this.mainLogger = logger.getLogger('main')
    this.ipInfo = {}
    this.internalRoutes = {}
  }

  _setupExternal () {
    return new Promise((resolve, reject) => {
      this.app.listen(this.ipInfo.externalPort, this.ipInfo.externalIp, () => {
        const msg = `Server running on port ${this.ipInfo.externalPort}...`
        console.log(msg)
        this.mainLogger.info(msg)
        resolve()
      })
    })
  }

  _setupInternal () {
    this.qn = Qn({
      port: this.ipInfo.internalPort,
      address: this.ipInfo.internalIp
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
        throw Error('FATAL: Invalid HTTP method for handler.')
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
