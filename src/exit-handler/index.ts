import Log4js from 'log4js'
import * as Context from '../p2p/Context'

interface ExitHandler {
  exited: boolean
  syncFuncs: Map<string, Function>
  asyncFuncs: Map<string, Function>
  exitLogger: Log4js.Logger
}

class ExitHandler {
  constructor() {
    this.exited = false
    this.syncFuncs = new Map()
    this.asyncFuncs = new Map()

    this.exitLogger = Context.logger.getLogger('exit')
  }

  // Modules can use this to register synchronous cleanup functions
  registerSync(who, func) {
    this.syncFuncs.set(who, func)
  }

  // Modules can use this to register asynchronous cleanup functions
  registerAsync(who, func) {
    this.asyncFuncs.set(who, func)
  }

  // Cleans up all modules with registered async functions
  async _cleanupAsync() {
    for (const [, func] of this.asyncFuncs) {
      await func()
    }
  }

  // Cleans up all modules with registered sync functions
  _cleanupSync() {
    for (const [, func] of this.syncFuncs) {
      func()
    }
  }

  // Exits after cleaning up with all registered functions
  async exitCleanly(exitProcess = true) {
    if (this.exited) return
    this.exited = true
    this._cleanupSync()
    try {
      this.exitLogger.fatal('EXIT LOGGER WORKING !!!!')
      await this._cleanupAsync()
    } catch (e) {
      console.error(e)
    }
    // eslint-disable-next-line no-process-exit
    if (exitProcess) process.exit()
  }

  async exitUncleanly(SIG_TYPE?: string) {
    if (this.exited) return
    this.exited = true
    this._cleanupSync()

    try {
      this.exitLogger.fatal('EXIT LOGGER WORKING !!!!')
      await this._cleanupAsync()
    } catch (e) {
      console.error(e)
    }
    // eslint-disable-next-line no-process-exit
    process.exit(1) // exiting with status 1 causes our modified PM2 to not restart the process
  }

  // Used for adding event listeners for the SIGINT and SIGTERM signals
  addSigListeners(sigint = true, sigterm = true) {
    if (sigint) {
      process.on('SIGINT', async () => {
        // await this.exitCleanly()
        await this.exitUncleanly('SIGINT')
      })
    }
    if (sigterm) {
      process.on('SIGTERM', async () => {
        // await this.exitCleanly()
        await this.exitUncleanly('SIGTERM')
      })
    }
  }
}

export default ExitHandler
