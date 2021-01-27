import log4js from 'log4js'
import { existsSync, mkdirSync } from 'fs'
import * as utils from '../utils'
import os from 'os'
import * as http from '../http'
import Shardus = require('../shardus/shardus-types')
import { profilerInstance } from '../utils/profiler'
import { nestedCountersInstance } from '../utils/nestedCounters'
const stringify = require('fast-stable-stringify')
const log4jsExtend = require('log4js-extend')

interface Logger {
  baseDir: string
  config: Shardus.LogsConfiguration
  logDir: string
  log4Conf: any
  playbackLogEnabled: boolean
  _playbackLogger: any
  _playbackTrace: boolean
  _playbackDebug: boolean
  _seenAddresses: any
  _shortStrings: any
  _playbackOwner_host: any
  _playbackOwner: any
  _playbackIPInfo: any
  _nodeInfos: any
  _playbackNodeID: string
}

class Logger {
  constructor(baseDir: string, config: Shardus.LogsConfiguration) {
    this.baseDir = baseDir
    this.config = config
    this.logDir = null
    this.log4Conf = null
    this._setupLogs()
  }

  // Checks if the configuration has the required components
  _checkValidConfig() {
    const config = this.config
    if (!config.dir) throw Error('Fatal Error: Log directory not defined.')
    if (!config.files || typeof config.files !== 'object')
      throw Error('Fatal Error: Valid log file locations not provided.')
  }

  // Add filenames to each appender of type 'file'
  _addFileNamesToAppenders() {
    const conf = this.log4Conf
    for (const key in conf.appenders) {
      const appender = conf.appenders[key]
      if (appender.type !== 'file') continue
      appender.filename = `${this.logDir}/${key}.log`
    }
  }

  _configureLogs() {
    return log4js.configure(this.log4Conf)
  }

  // Get the specified logger
  getLogger(logger: string) {
    return log4js.getLogger(logger)
  }

  // Setup the logs with the provided configuration using the base directory provided for relative paths
  _setupLogs() {
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

    this.playbackLogEnabled = false
    this._playbackLogger = this.getLogger('playback')
    // @ts-ignore
    this._playbackTrace = ['TRACE'].includes(
      this._playbackLogger.level.levelStr
    )
    // @ts-ignore
    this._playbackDebug = ['DEBUG'].includes(
      this._playbackLogger.level.levelStr
    )
    if (this._playbackTrace || this._playbackDebug) {
      this.playbackLogEnabled = true
    }
    this._seenAddresses = {}
    this._shortStrings = {}
    this._playbackOwner_host = os.hostname()
    this._playbackOwner = 'temp_' + this._playbackOwner_host
    this._playbackIPInfo = null
    this._nodeInfos = {}
    http.setLogger(this)
  }

  // Tells this module that the server is shutting down, returns a Promise that resolves when all logs have been written to file, sockets are closed, etc.
  shutdown() {
    return new Promise(resolve => {
      log4js.shutdown(() => {
        resolve('done')
      })
    })
  }

  setPlaybackIPInfo(ipInfo) {
    this._playbackIPInfo = ipInfo
    let newName =
      'temp_' +
      this._playbackOwner_host +
      ':' +
      this._playbackIPInfo.externalPort
    this.playbackLogNote('logHostNameUpdate', '', { newName })
    this._playbackOwner = newName
  }

  setPlaybackID(nodeID) {
    this._playbackNodeID = nodeID
    let newName =
      utils.makeShortHash(this._playbackNodeID) +
      ':' +
      this._playbackIPInfo.externalPort
    this.playbackLogNote('logHostNameUpdate', '', {
      newName,
      nodeID: nodeID + ' ',
    })
    this._playbackOwner = newName
  }

  identifyNode(input) {
    if (utils.isString(input)) {
      if (input.length === 64) {
        let seenNode = this._nodeInfos[input]
        if (seenNode) {
          return seenNode.out
        }
        return utils.makeShortHash(input)
      } else {
        return input
      }
    }

    if (utils.isObject(input)) {
      if (input.id) {
        let seenNode = this._nodeInfos[input.id]
        if (seenNode) {
          return seenNode.out
        }
        let shorthash = utils.makeShortHash(input.id)
        let out = shorthash + ':' + input.externalPort
        this._nodeInfos[input.id] = { node: input, out, shorthash }
        return out
      }
      return stringify(input)
    }
  }

  processDesc(desc) {
    if (utils.isObject(desc)) {
      desc = utils.stringifyReduce(desc)
    }

    return desc
  }

  playbackLog(from, to, type, endpoint, id, desc) {

    nestedCountersInstance.countEvent(type, endpoint)

    // only log desc if trace..
    // dont log it if debug
    if (!this._playbackTrace && !this._playbackDebug) {
      return
    }

    let ts = Date.now()

    from = this.identifyNode(from)
    to = this.identifyNode(to)

    if (utils.isObject(id)) {
      id = stringify(id)
    } else {
      id = utils.makeShortHash(id)
    }

    if (this._playbackTrace) {
      desc = this.processDesc(desc)
      this._playbackLogger.trace(
        `\t${ts}\t${this._playbackOwner}\t${from}\t${to}\t${type}\t${endpoint}\t${id}\t${desc}`
      )
    }
    if (this._playbackDebug) {
      this._playbackLogger.debug(
        `\t${ts}\t${this._playbackOwner}\t${from}\t${to}\t${type}\t${endpoint}\t${id}`
      )
    }
  }
  playbackLogState(newState, id, desc) {
    this.playbackLog('', '', 'StateChange', newState, id, desc)
  }

  playbackLogNote(noteCategory, id, desc=null) {
    this.playbackLog('', '', 'Note', noteCategory, id, desc)
  }
}

export default Logger
