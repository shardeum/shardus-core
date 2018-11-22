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

  async setServerConfig (port, changes) {
    const server = this.servers[port]
    if (!server) return console.log('Could not find server on port', port)
    await this.stopServer(server.port)
    let serverConfigs = _readJsonFiles(path.join(server.baseDir, 'config'))
    let changedConfigs = merge(serverConfigs, changes)
    _writeJsonFiles(path.join(server.baseDir, 'config'), changedConfigs)
  }

  async startServer (port) {
    let server = this.servers[port]
    switch (true) {
      // If no server existed on this port...
      case (!server): {
        // Copy defaultConfigs and set port
        let configs = JSON.parse(JSON.stringify(this.defaultConfigs))
        configs.server.externalPort = port
        // Create new baseDir for server and write configs
        let newBaseDirPath = path.join(this.instDirPath, `${this.name}-${port}`)
        configs.server.baseDir = newBaseDirPath
        await _createBaseDir(newBaseDirPath, configs)
        // Fork a server process
        let serverProc = fork(this.serverPath, [newBaseDirPath])
        const success = await _awaitCondition(`http://${LOCAL_ADDRESS}:${port}/cyclemarker`)
        if (!success) throw new Error(`Server at ${port} failed to start.`)
        // Save it
        server = {
          process: serverProc,
          baseDir: newBaseDirPath,
          port: port
        }
        this.servers[port] = server
        console.log('Successfully started server on port', port)
        break
      }
      // If a server once existed on this port...
      case (server && server.baseDir && !server.process): {
        // Fork a server process from the existing baseDir
        let serverProc = fork(this.serverPath, [server.baseDir])
        const success = await _awaitCondition(`http://${LOCAL_ADDRESS}:${port}/cyclemarker`)
        if (!success) throw new Error(`Server at ${port} failed to start.`)
        // Save the process
        server.process = serverProc
        console.log('Successfully restarted server on port', port)
        break
      }
    }
    return server.process
  }

  async stopServer (port) {
    const server = this.servers[port]
    if (!server) return console.log('Could not find server on port', port)
    if (server.process === null) return console.log('Server is already stopped on port', port)
    server.process.kill()
    const success = await _awaitCondition(`http://${LOCAL_ADDRESS}:${port}/cyclemarker`, false)
    if (!success) throw new Error('Failed to stop server on port ' + port)
    server.process = null
    console.log('Stopped server on port', port)
  }

  async deleteServer (port) {
    const server = this.servers[port]
    if (!server) return console.log('Could not find server on port', port)
    await this.stopServer(server.port)
    _rimraf(server.baseDir)
    delete this.servers[port]
    console.log('Deleted server that was on port', port)
  }

  async startServers (port, num, wait = 3500) {
    console.log(`Starting ${num} nodes from port ${port}...`)
    await this.startServer(port)

    let promises = []
    for (let i = 1; i < num; i++) {
      promises.push(this.startServer(port + i))
    }

    try {
      await Promise.all(promises)
    } catch (e) {
      console.log(e)
    }

    await _sleep(wait)

    return this.servers
  }

  async startAllStoppedServers () {
    let promises = []
    for (const port in this.servers) {
      const server = this.servers[port]
      if (server.process === null) {
        promises.push(this.startServer(port))
      }
    }
    await Promise.all(promises)
  }

  async stopAllServers () {
    const promises = Object.keys(this.servers).map(port => this.stopServer(port))
    await Promise.all(promises)
  }

  async deleteAllServers () {
    const promises = Object.keys(this.servers).map(port => this.deleteServer(port))
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
