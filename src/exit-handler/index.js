class ExitHandler {
  constructor () {
    this.syncFuncs = {}
    this.asyncFuncs = {}
  }

  // Modules can use this to register synchronous cleanup functions
  registerSync (who, func) {
    this.syncFuncs[who] = func
  }

  // Modules can use this to register asynchronous cleanup functions
  registerAsync (who, func) {
    this.asyncFuncs[who] = func
  }

  // Cleans up all modules with registered async functions
  async _cleanupAsync () {
    const promises = []
    for (const func of Object.values(this.asyncFuncs)) {
      promises.push(func())
    }
    await Promise.all(promises)
  }

  // Cleans up all modules with registered sync functions
  _cleanupSync () {
    for (const func of Object.values(this.syncFuncs)) {
      func()
    }
  }

  // Exits after cleaning up with all registered functions
  async exitCleanly () {
    this._cleanupSync()
    await this._cleanupAsync()
    process.exit()
  }

  // Used for adding event listeners for the SIGINT and SIGTERM signals
  addSigListeners (sigint = true, sigterm = true) {
    if (sigint) {
      process.on('SIGINT', () => {
        this.exitCleanly()
      })
    }
    if (sigterm) {
      process.on('SIGTERM', () => {
        this.exitCleanly()
      })
    }
  }
}

module.exports = ExitHandler
