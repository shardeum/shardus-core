const log4js = require('log4js')
const { existsSync, mkdirSync } = require('fs')

class Logger {
  constructor (baseDir, config) {
    this.logs = {}
    this._setupLogs(baseDir, config)
  }

  // Checks if the configuration has the required components
  _checkValidConfig (config) {
    if (!config.dir) throw Error('Fatal Error: Log directory not defined.')
    if (!config.confFile || typeof config.confFile !== 'string') throw Error('Fatal Error: Valid log configuration filename not provided.')
    if (!config.files || typeof config.files !== 'object') throw Error('Fatal Error: Valid log file locations not provided.')
  }

  // Read the log configuration file specified within the provided configuration and configure log4js with it
  _readLogConfig (confFile) {
    if (!existsSync(confFile)) throw Error('Fatal Error: Provided log configuration file does not exist.')
    log4js.configure(confFile)
  }

  // Get the specified logger
  getLogger (logger) {
    return log4js.getLogger(logger)
  }

  // Setup the logs with the provided configuration using the base directory provided for relative paths
  _setupLogs (baseDir, config) {
    if (!baseDir) throw Error('Fatal Error: Base directory not defined.')
    if (!config) throw Error('Fatal Error: No configuration provided.')
    this._checkValidConfig(config)

    // Makes specified directory if it doesn't exist
    const dir = `${baseDir}/${config.dir}`
    if (!existsSync(dir)) mkdirSync(dir)

    this._readLogConfig(`${baseDir}/${config.confFile}`)
    this.getLogger('main').info('Logger initialized.')
  }

  // Tells this module that the server is shutting down, returns a Promise that resolves when all logs have been written to file, sockets are closed, etc.
  shutdown () {
    return new Promise((resolve) => {
      this.getLogger('main').info('Logger shutting down cleanly...')
      log4js.shutdown(() => {
        resolve('done')
      })
    })
  }
}

module.exports = Logger
