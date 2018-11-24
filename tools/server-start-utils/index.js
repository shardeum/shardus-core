const fs = require('fs')
const path = require('path')
const { fork } = require('child_process')
const axios = require('axios')
const merge = require('deepmerge')

const LOCAL_ADDRESS = '127.0.0.1'
const NODE_UP_TIMEOUT = process.env.NODE_UP_TIMEOUT || 5000

class ServerStartUtils {
  constructor (baseDirPath, instDirPath) {
    this.name = 'shardus-server'
    this.baseDirPath = baseDirPath
    this.instDirPath = instDirPath
    this.serverPath = path.join(baseDirPath, 'server.js')
    this.servers = {}
    // Save default configs
    this.defaultConfigs = _readJsonFiles(path.join(baseDirPath, 'config'))
    // Create instance dir
    _ensureExists(instDirPath)
  }

  setInstanceNames (name) {
    this.name = name
  }

  setDefaultConfig (changes) {
    this.defaultConfigs = merge(this.defaultConfigs, changes)
  }

  async setServerConfig (extPort, changes) {
    const server = this.servers[extPort]
    if (!server) return console.log('Could not find server on port', extPort)
    await this.stopServer(server.extPort)
    let serverConfigs = _readJsonFiles(path.join(server.baseDir, 'config'))
    let changedConfigs = merge(serverConfigs, changes)
    _writeJsonFiles(path.join(server.baseDir, 'config'), changedConfigs)
  }

  async startServer (extPort = null, intPort = null, outputToFile = true) {
    if (!extPort) extPort = this.defaultConfigs.server.ip.externalPort
    if (!intPort) intPort = this.defaultConfigs.server.ip.internalPort
    let server = this.servers[extPort]
    switch (true) {
      // If no server existed on this port...
      case (!_exists(server)): {
        // Copy defaultConfigs and edit ports and baseDir
        let configs = JSON.parse(JSON.stringify(this.defaultConfigs))
        configs.server.baseDir = path.join(this.instDirPath, `${this.name}-${extPort}`)
        configs.server.ip.externalPort = extPort
        configs.server.ip.internalPort = intPort
        // Create new baseDir for server and write configs
        await _createBaseDir(configs.server.baseDir, configs)
        // Fork a server process
        let serverProc = await _forkServer(this.serverPath, configs.server.ip.externalPort, configs.server.baseDir, outputToFile)
        // Save it
        server = {
          process: serverProc,
          baseDir: configs.server.baseDir,
          extPort: configs.server.ip.externalPort,
          intPort: configs.server.ip.internalPort
        }
        this.servers[server.extPort] = server
        console.log(`Successfully started server on ext:int ports ${server.extPort}:${server.intPort}`)
        break
      }
      // If a server once existed on this port...
      case (_exists(server) && _exists(server.baseDir) && !_exists(server.process)): {
        // Fork a server process from the existing baseDir
        let serverProc = await _forkServer(this.serverPath, extPort, server.baseDir, outputToFile)
        // Save the process
        server.process = serverProc
        console.log(`Successfully restarted server on ext:int ports ${server.extPort}:${server.intPort}`)
        break
      }
      // If a server is running on this port...
      case (_exists(server) && _exists(server.baseDir) && _exists(server.process)): {
        console.log(`Server already running on ext:int ports ${server.extPort}:${server.intPort}`)
        server = null
        break
      }
    }
    return server
  }

  async stopServer (extPort) {
    const server = this.servers[extPort]
    if (!server) return console.log('Could not find server on port', extPort)
    if (server.process === null) return console.log('Server is already stopped on port', extPort)
    server.process.kill()
    const success = await _awaitCondition(`http://${LOCAL_ADDRESS}:${extPort}/cyclemarker`, false)
    if (!success) throw new Error('Failed to stop server on port ' + extPort)
    server.process = null
    console.log('Stopped server on ext port', extPort)
    return server
  }

  async deleteServer (extPort) {
    const server = this.servers[extPort]
    if (!server) return console.log('Could not find server on ext port', extPort)
    await this.stopServer(server.extPort)
    _rimraf(server.baseDir)
    delete this.servers[extPort]
    console.log('Deleted server that was on ext port', extPort)
  }

  async startServers (num, extPort = null, intPort = null, wait = 3500) {
    if (!extPort) extPort = this.defaultConfigs.server.ip.externalPort
    if (!intPort) intPort = this.defaultConfigs.server.ip.internalPort
    console.log(`Starting ${num} nodes from ext:int port ${extPort}:${intPort}...`)
    await this.startServer(extPort, intPort)

    let promises = []
    for (let i = 1; i < num; i++) {
      promises.push(this.startServer(extPort + i, intPort + i))
    }

    try {
      await Promise.all(promises)
    } catch (e) {
      console.log(e)
    }

    await _sleep(wait)

    return this.servers
  }

  async startAllStoppedServers (outputToFile = true) {
    let promises = []
    for (const extPort in this.servers) {
      const server = this.servers[extPort]
      if (server.process === null) {
        promises.push(this.startServer(server.extPort, server.intPort, outputToFile))
      }
    }
    await Promise.all(promises)
  }

  async stopAllServers () {
    const promises = Object.keys(this.servers).map(extPort => this.stopServer(extPort))
    await Promise.all(promises)
  }

  async deleteAllServers () {
    const promises = Object.keys(this.servers).map(extPort => this.deleteServer(extPort))
    await Promise.all(promises)
  }
}

module.exports = function (relBaseDirPath, relInstDirPath) {
  if (!relInstDirPath) relInstDirPath = path.join(relBaseDirPath, 'instances')
  let parentModuleDirname = path.parse(module.parent.filename).dir
  let absBaseDirPath = path.resolve(path.join(parentModuleDirname, relBaseDirPath))
  let absInstDirPath = path.resolve(path.join(parentModuleDirname, relInstDirPath))
  return new ServerStartUtils(absBaseDirPath, absInstDirPath)
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
  const success = await _awaitCondition(`http://${LOCAL_ADDRESS}:${extPort}/cyclemarker`)
  if (!success) throw new Error(`Server at ${extPort} failed to start.`)
  return serverProc
}

async function _sleep (ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function _awaitCondition (host, available = true) {
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
      await axios(host)
      if (available) break
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
