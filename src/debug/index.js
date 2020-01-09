const fs = require('fs')
const { fork } = require('child_process')
const path = require('path')

class Debug {
  constructor (baseDir, network) {
    this.debugProc = this.forkDebugProc(baseDir, network)
  }

  forkDebugProc (baseDir, network) {
    const pidFile = path.join(baseDir, 'debug-pid')
    if (fs.existsSync(pidFile)) {
      console.log('DEBUG: debug proc already running')
      return
    }
    const debugProc = fork(path.join(__dirname, 'endpoint.js'), [ baseDir, JSON.stringify(network.ipInfo) ], { detached: true })
    fs.writeFileSync(pidFile, debugProc.pid)
    return debugProc
  }

  addToArchive (src, dest) {
    if (!this.debugProc) {
      console.log('DEBUG: addToArchive failed: no IPC channel with running debug proc')
      return
    }
    this.debugProc.send({ src, dest })
  }
}

module.exports = Debug
