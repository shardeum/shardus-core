const log4js = require('log4js')
const { existsSync, mkdirSync } = require('fs')
const log4jsExtend = require('log4js-extend')

class Logger {
  constructor (baseDir, config) {
    this.baseDir = baseDir
    this.config = config
    this.logs = {}
    this.logDir = null
    this.log4Conf = null
    this._setupLogs()
  }

  // Checks if the configuration has the required components
  _checkValidConfig () {
    const config = this.config
    if (!config.dir) throw Error('Fatal Error: Log directory not defined.')
    if (!config.files || typeof config.files !== 'object') throw Error('Fatal Error: Valid log file locations not provided.')
  }

  // Add filenames to each appender of type 'file'
  _addFileNamesToAppenders () {
    const conf = this.log4Conf
    for (const key in conf.appenders) {
      const appender = conf.appenders[key]
      if (appender.type !== 'file') continue
      appender.filename = `${this.logDir}/${key}.log`
    }
  }

  _configureLogs () {
    return log4js.configure(this.log4Conf)
  }

  // Get the specified logger
  getLogger (logger) {
    return log4js.getLogger(logger)
  }

  // Setup the logs with the provided configuration using the base directory provided for relative paths
  _setupLogs () {
    const baseDir = this.baseDir
    const config = this.config

    if (!baseDir) throw Error('Fatal Error: Base directory not defined.')
    if (!config) throw Error('Fatal Error: No configuration provided.')
    this._checkValidConfig()

    // Makes specified directory if it doesn't exist
    this.logDir = `${baseDir}/${config.dir}`
    if (!existsSync(this.logDir)) mkdirSync(this.logDir)

    // Read the log config from log config file
    this.log4Conf = config.options
    log4jsExtend(log4js)
    this._addFileNamesToAppenders()
    this._configureLogs()
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
