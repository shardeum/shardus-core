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
    for (const func of Object.values(this.asyncFuncs)) {
      await func()
    }
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
    try {
      await this._cleanupAsync()
    } catch (e) {
      console.error(e)
    }
    process.exit()
  }

  // Used for adding event listeners for the SIGINT and SIGTERM signals
  addSigListeners (sigint = true, sigterm = true) {
    if (sigint) {
      process.on('SIGINT', async () => {
        await this.exitCleanly()
      })
    }
    if (sigterm) {
      process.on('SIGTERM', async () => {
        await this.exitCleanly()
      })
    }
  }
}

module.exports = ExitHandler
