// const Qn = require('shardus-quic-net')
const express = require('express')

class Network {
  constructor (logger) {
    this.app = express()
    this.mainLogger = logger.getLogger('main')
    this.ipInfo = {}
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

  async setup (ipInfo) {
    if (!ipInfo.externalIp) throw new Error('Fatal: network module requires externalIp')
    if (!ipInfo.externalPort) throw new Error('Fatal: network module requires externalPort')
    if (!ipInfo.internalIp) throw new Error('Fatal: network module requires internalIp')
    if (!ipInfo.internalPort) throw new Error('Fatal: network module requires internalPort')

    this.ipInfo = ipInfo
    await this._setupExternal()
    // instantiate the shardus quic net library
    /* const qn = Qn({
      port: ipInfo.internalPort,
      address: ipInfo.internalIp
    }) */
  }
}

module.exports = Network
