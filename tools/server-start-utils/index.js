const fs = require('fs')
const path = require('path')
const { fork } = require('child_process')
const axios = require('axios')
const merge = require('deepmerge')
const Shardus = require('../../src/shardus')

const LOCAL_ADDRESS = '127.0.0.1'
const NODE_UP_TIMEOUT = process.env.NODE_UP_TIMEOUT || 60000

class ServerStartUtils {
  constructor (config = {}) {
    Object.assign(this, merge(this, config))
    if (!this.baseDir) this.baseDir = '.'
    if (!this.instanceDir) this.instanceDir = path.join(this.baseDir, 'instances')
    if (!this.instanceNames) this.instanceNames = 'shardus-server'
    if (!this.serverPath) this.serverPath = path.join(this.baseDir, 'server.js')
    if (!this.verbose) this.verbose = false
    // Save default server configs
    this.defaultConfigs = _readJsonFiles(path.join(this.baseDir, 'config'))
    // Ensure instance dir exists
    _ensureExists(this.instanceDir)
    // Create an obj to hold the servers we're gonna start
    this.servers = {}
  }

  setInstanceNames (name) {
    this.instanceNames = name
  }

  setDefaultConfig (changes = {}) {
    if (Object.keys(changes).length !== 0) {
      this.defaultConfigs = merge(this.defaultConfigs, changes)
    }
  }

  async setServerConfig (port, changes = {}) {
    if (Object.keys(changes).length === 0) return
    const server = this.servers[port]
    if (!server) return this._log('Could not find server on port', port)
    try {
      await this.stopServer(port)
    } catch (e) {
      throw e
    }
    let serverConfigs = _readJsonFiles(path.join(server.baseDir, 'config'))
    let changedConfigs = merge(serverConfigs, changes)
    _writeJsonFiles(path.join(server.baseDir, 'config'), changedConfigs)
  }

  async startServer (extPort = null, intPort = null, changes = null, outputToFile = true, instance = false) {
    extPort = extPort || _get(changes, 'server.ip.externalPort') || this.defaultConfigs.server.ip.externalPort
    intPort = intPort || _get(changes, 'server.ip.internalPort') || this.defaultConfigs.server.ip.internalPort
    let server = this.servers[extPort] || this.servers[intPort]
    switch (true) {
      // If no server existed on this port...
      case (!_exists(server)): {
        this._log(`Attempting to start server on ports ${extPort}:${intPort}...`)
        // Copy defaultConfigs and edit ports and baseDir
        const configs = changes ? merge(this.defaultConfigs, changes) : this.defaultConfigs
        configs.server.baseDir = path.join(this.instanceDir, `${this.instanceNames}-${extPort}`)
        configs.server.ip.externalPort = extPort
        configs.server.ip.internalPort = intPort
        // Create new baseDir for server and write configs
        await _createBaseDir(configs.server.baseDir, configs)
        // Fork a server process or instance
        let serverProc
        try {
          if (instance) {
            serverProc = await _startInstance(configs)
          } else {
            serverProc = await _forkServer(this.serverPath, configs.server.ip.externalPort, configs.server.baseDir, outputToFile)
          }
        } catch (e) {
          throw e
        }
        // Save it
        server = {
          status: 'running',
          process: serverProc,
          baseDir: configs.server.baseDir,
          extPort: configs.server.ip.externalPort,
          intPort: configs.server.ip.internalPort
        }
        this.servers[server.extPort] = server
        this.servers[server.intPort] = server
        this._log(`Successfully started server on ports ${server.extPort}:${server.intPort}`)
        break
      }
      // If a server once existed on this port...
      case (_exists(server) && _exists(server.baseDir) && !_exists(server.process) && server.status !== 'starting'): {
        this._log(`Attempting to restart server on ports ${server.extPort}:${server.intPort}...`)
        // If changes given, update the servers config
        if (changes) {
          try {
            await this.setServerConfig(server.extPort, changes)
          } catch (e) {
            throw e
          }
        }
        // Fork a server process from the existing baseDir
        let serverProc
        try {
          server.status = 'starting'
          serverProc = await _forkServer(this.serverPath, server.extPort, server.baseDir, outputToFile)
          server.status = 'running'
        } catch (e) {
          server.status = 'stopped'
          throw e
        }
        // Save the process
        server.process = serverProc
        this._log(`Successfully restarted server on ports ${server.extPort}:${server.intPort}`)
        break
      }
      // If a server is running on this port...
      case (_exists(server) && _exists(server.baseDir) && _exists(server.process)): {
        this._log(`Did not start server on ports ${extPort}:${intPort}; Server already running on ports ${server.extPort}:${server.intPort}`)
        server = null
        break
      }
    }
    return server
  }

  async startServerInstance (extPort = null, intPort = null, changes = null, outputToFile = true) {
    let server = await this.startServer(extPort, intPort, changes, outputToFile, true)
    return server.process
  }

  async stopServer (port) {
    const server = this.servers[port]
    if (!server) return this._log('Could not find server on port', port)
    if (server.status === 'stopped') return this._log('Server is already stopped on port', port)
    if (server.status !== 'running') return
    server.status = 'stopping'
    if (server.process instanceof Shardus) {
      try {
        await server.process.shutdown(false)
        server.process = null
        server.status = 'stopped'
      } catch (e) {
        server.status = 'running'
        throw e
      }
    } else {
      server.process.kill()
      const success = await _awaitCondition(`http://${LOCAL_ADDRESS}:${port}/cyclemarker`, data => _exists(data.currentCycleMarker), false)
      if (!success) {
        server.status = 'running'
        throw new Error('Failed to stop server on port ' + port)
      }
      server.process = null
      server.status = 'stopped'
    }
    this._log('Stopped server on port', port)
    return server
  }

  async deleteServer (port) {
    const server = this.servers[port]
    if (!server) return this._log('Could not find server on port', port)
    if (!['running', 'stopped'].includes(server.status)) return
    try {
      await this.stopServer(port)
    } catch (e) {
      throw e
    }
    delete this.servers[server.extPort]
    delete this.servers[server.intPort]
    _rimraf(server.baseDir)
    this._log('Deleted server that was on port', port)
  }

  async startServers (num, extPort = null, intPort = null, changes = null, outputToFile = true, instance = false, wait = 0) {
    if (!extPort) extPort = this.defaultConfigs.server.ip.externalPort
    if (!intPort) intPort = this.defaultConfigs.server.ip.internalPort
    this._log(`Starting ${num} nodes from port ${extPort}:${intPort}...`)
    await this.startServer(extPort, intPort, changes, outputToFile, instance)

    await _sleep(wait)

    let promises = []
    for (let i = 1; i < num; i++) {
      promises.push(this.startServer(extPort + i, intPort + i, changes, outputToFile, instance))
    }

    try {
      await Promise.all(promises)
    } catch (e) {
      this._log(e)
    }

    return this.servers
  }

  async startAllStoppedServers (changes = null, outputToFile = true, instance = false) {
    const promises = Object.keys(this.servers).map(port => this.startServer(port))
    try {
      await Promise.all(promises)
    } catch (e) {
      throw new Error('Failed to start all stopped servers', e)
    }
  }

  async stopAllServers () {
    const promises = Object.keys(this.servers).map(extPort => this.stopServer(extPort))
    try {
      await Promise.all(promises)
    } catch (e) {
      throw new Error('Failed to stop all servers', e)
    }
  }

  async deleteAllServers () {
    const promises = Object.keys(this.servers).map(port => this.deleteServer(port))
    try {
      await Promise.all(promises)
    } catch (e) {
      throw new Error('Failed to delete all servers', e)
    }
  }

  async getRequests (port) {
    const server = this.servers[port]
    if (!server) return this._log('Could not find server on port', port)
    const response = await axios.get(`http://${LOCAL_ADDRESS}:${port}/test`)
    if (!response) throw new Error('Failed to get test data from server on port ' + port)
    return response.data.requests
  }

  async getState (port) {
    const server = this.servers[port]
    if (!server) return this._log('Could not find server on port', port)
    const response = await axios.get(`http://${LOCAL_ADDRESS}:${port}/test`)
    if (!response) throw new Error('Failed to get test data from server on port ' + port)
    return response.data.state
  }

  _log (...params) {
    if (this.verbose) console.log(...params)
  }
}

async function _forkServer (serverPath, extPort, baseDir, outputToFile = true) {
  let serverProc
  if (outputToFile) {
    let timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    let output = fs.openSync(path.join(baseDir, `output-${timestamp}.txt`), 'w')
    serverProc = fork(serverPath, [baseDir], { stdio: ['inherit', output, output, 'ipc'] })
  } else {
    serverProc = fork(serverPath, [baseDir])
  }
  serverProc.on('error', err => { throw new Error(`Server at ${extPort} failed to start: error ${err}`) })
  serverProc.on('exit', code => { throw new Error(`Server at ${extPort} failed to start: exit code ${code}`) })
  const success = await _awaitCondition(`http://${LOCAL_ADDRESS}:${extPort}/nodeinfo`, data => _exists(data.nodeInfo.id))
  if (!success) throw new Error(`Server at ${extPort} failed to start.`)
  serverProc.removeAllListeners()
  return serverProc
}

async function _startInstance (configs) {
  const instance = new Shardus(configs.server)
  instance.start(false)
  const success = await _awaitCondition(`http://${LOCAL_ADDRESS}:${configs.server.ip.externalPort}/nodeinfo`, data => _exists(data.nodeInfo.id))
  if (!success) throw new Error(`Server at ${configs.server.ip.externalPort} failed to start.`)
  return instance
}

async function _sleep (ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function _awaitCondition (host, successFn, available = true) {
  const startTime = new Date().valueOf()

  let success = true

  while (true) {
    if (new Date().valueOf() - startTime > NODE_UP_TIMEOUT) {
      // The condition timed out
      success = false
      break
    }

    // try the condition
    try {
      const resp = await axios(host)
      let successful
      try { successful = successFn(resp.data) } catch (e) { throw e }
      if (available && successful) break
    } catch (e) {
      if (!available) break
    }

    // arbitrary number, minimally relevant. How long between polls.
    await _sleep(500)
  }

  return success
}

function _readJsonFiles (dir) { // => filesObj
  let filesObj = {}
  fs.readdirSync(dir).forEach(fileName => {
    let name = fileName.split('.')[0]
    filesObj[name] = require(path.join(dir, fileName))
  })
  return filesObj
}

function _writeJsonFiles (dir, filesObj) {
  for (const file in filesObj) {
    let filePath = path.join(dir, file + '.json')
    let fileContents = JSON.stringify(filesObj[file], null, 2)
    fs.writeFileSync(filePath, fileContents, 'utf8')
  }
}

async function _createBaseDir (baseDirPath, configs) {
  // Create baseDir
  await _ensureExists(baseDirPath)
  // Create config dir
  let configPath = path.join(baseDirPath, 'config')
  await _ensureExists(configPath)
  // Write config files
  _writeJsonFiles(configPath, configs)
}

// From: https://stackoverflow.com/a/21196961
async function _ensureExists (dir) {
  return new Promise((resolve, reject) => {
    fs.mkdir(dir, { recursive: true }, (err) => {
      if (err) {
        // Ignore err if folder exists
        if (err.code === 'EEXIST') resolve()
        // Something else went wrong
        else reject(err)
      } else {
        // Successfully created folder
        resolve()
      }
    })
  })
}

/**
 * Remove directory recursively
 * @param {string} dir_path
 * @see https://stackoverflow.com/a/42505874/3027390
 */
function _rimraf (dir) {
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).forEach(function (entry) {
      var entryPath = path.join(dir, entry)
      if (fs.lstatSync(entryPath).isDirectory()) {
        _rimraf(entryPath)
      } else {
        fs.unlinkSync(entryPath)
      }
    })
    fs.rmdirSync(dir)
  }
}

function _exists (thing) {
  return (typeof thing !== 'undefined' && thing !== null)
}

function _get (obj, nestedProp) {
  const props = nestedProp.split('.')
  for (const prop of props) {
    if (!obj || !obj.hasOwnProperty(prop)) {
      return undefined
    }
    obj = obj[prop]
  }
  return obj
}

module.exports = function (config = {}) {
  const relBaseDir = config.baseDir || '.'
  const relInstanceDir = config.instanceDir || path.join(relBaseDir, 'instances')
  const parentModuleDirname = path.parse(module.parent.filename).dir
  config.baseDir = path.resolve(path.join(parentModuleDirname, relBaseDir))
  config.instanceDir = path.resolve(path.join(parentModuleDirname, relInstanceDir))
  return new ServerStartUtils(config)
}
