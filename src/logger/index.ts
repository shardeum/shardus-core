import log4js from 'log4js'
import { existsSync, mkdirSync } from 'fs'
import * as utils from '../utils'
import os from 'os'
import * as http from '../http'
import * as Shardus from '../shardus/shardus-types'
import { profilerInstance } from '../utils/profiler'
import { nestedCountersInstance } from '../utils/nestedCounters'
const stringify = require('fast-stable-stringify')
const log4jsExtend = require('log4js-extend')
import got from 'got'
import { parse as parseUrl } from 'url'
import { isDebugModeMiddleware } from '../network/debugMiddleware'

interface Logger {
  baseDir: string
  config: Shardus.LogsConfiguration
  logDir: string
  log4Conf: any
  // playbackLogEnabled: boolean
  _playbackLogger: any
  // _playbackTrace: boolean
  // _playbackDebug: boolean
  _seenAddresses: any
  _shortStrings: any
  _playbackOwner_host: any
  _playbackOwner: any
  _playbackIPInfo: any
  _nodeInfos: any
  _playbackNodeID: string
}

// default: { appenders: ['out'], level: 'fatal' },
// app: { appenders: ['app', 'errors'], level: 'trace' },
// main: { appenders: ['main', 'errors'], level: 'trace' },
// fatal: { appenders: ['fatal'], level: 'fatal' },
// net: { appenders: ['net'], level: 'trace' },
// playback: { appenders: ['playback'], level: 'trace' },
// shardDump: { appenders: ['shardDump'], level: 'trace' },
// statsDump: { appenders: ['statsDump'], level: 'trace' },

// OFF	0
// FATAL	100
// ERROR	200
// WARN	300
// INFO	400
// DEBUG	500
// TRACE	600
// ALL	Integer.MAX_VALUE

/**
 * The point of LogFlags it to gain max performance when we need to reduce logging, and be able to ajust this in a simple
 * way when inside of a test.
 *
 * This does not not need to have a super amount of detail or permutations, because if logging is enabled to a medium amount
 * for debugging there will not be much gains or performance to fine grained details.
 *
 * verbose flag is still usefull for heavy logs, and playback seems to beneift from levels, so we could expand as needed
 */
export type LogFlags = {
  verbose: boolean
  fatal: boolean
  debug: boolean
  info: boolean // optional to use this. many info lines seem good to keep and minimal in stringify/frequency
  error: boolean

  console: boolean

  playback: boolean
  playback_trace: boolean
  playback_debug: boolean

  net_trace: boolean
  // main:boolean;
  // main_error:boolean;
  // main_debug:boolean;
  // main_trace:boolean;

  // playback:boolean;
  // playback_verbose:boolean

  p2pNonFatal:boolean;
  // //p2p_info:boolean;

  // snapshot:boolean;
}

export let logFlags: LogFlags = {
  debug: true,
  fatal: true,
  verbose: true,
  info: true,
  console: true,
  error: true,

  playback: false,
  playback_trace: false,
  playback_debug: false,
  net_trace: false,
  // main:true,
  // main_error:true,
  // main_debug:true,
  // main_trace:true,

  // playback:true,
  // playback_verbose:true,

  p2pNonFatal:true,

  // snapshot:true,
} 


class Logger {
  backupLogFlags: LogFlags

  constructor(baseDir: string, config: Shardus.LogsConfiguration, dynamicLogMode:string) {
    this.baseDir = baseDir
    this.config = config
    this.logDir = null
    this.log4Conf = null
    this._setupLogs(dynamicLogMode)

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
  _setupLogs(dynamicLogMode:string) {
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

    this._playbackLogger = this.getLogger('playback')

    this.setupLogControlValues()

    if(dynamicLogMode.toLowerCase() === 'fatal' || dynamicLogMode.toLowerCase() === 'fatals'){
      console.log('startInFatalsLogMode=true!')
      this.setFatalFlags()
    } else if(dynamicLogMode.toLowerCase() === 'error' || dynamicLogMode.toLowerCase() === 'errors'){
      console.log('startInErrorLogMode=true!')
      this.setErrorFlags()
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
    return new Promise((resolve) => {
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
    if (!logFlags.playback) {
      return
    }   

    nestedCountersInstance.countEvent(type, endpoint)

    let ts = Date.now()

    from = this.identifyNode(from)
    to = this.identifyNode(to)

    if (utils.isObject(id)) {
      id = stringify(id)
    } else {
      id = utils.makeShortHash(id)
    }

    if (logFlags.playback_trace) {
      desc = this.processDesc(desc)
      this._playbackLogger.trace(
        `\t${ts}\t${this._playbackOwner}\t${from}\t${to}\t${type}\t${endpoint}\t${id}\t${desc}`
      )
    }
    if (logFlags.playback_debug) {
      this._playbackLogger.debug(
        `\t${ts}\t${this._playbackOwner}\t${from}\t${to}\t${type}\t${endpoint}\t${id}`
      )
    }
  }
  playbackLogState(newState, id, desc) {
    this.playbackLog('', '', 'StateChange', newState, id, desc)
  }

  playbackLogNote(noteCategory, id, desc = null) {
    this.playbackLog('', '', 'Note', noteCategory, id, desc)
  }


  setFatalFlags(){
      for (const [key, value] of Object.entries(logFlags)) {
        logFlags[key] = false
      }
      logFlags.fatal = true

      logFlags.playback = false
  }

  setErrorFlags(){
    for (const [key, value] of Object.entries(logFlags)) {
      logFlags[key] = false
    }
    logFlags.fatal = true
    logFlags.error = true

    logFlags.playback = false
}

  setDefaultFlags(){
    for (const [key, value] of Object.entries(logFlags)) {
      logFlags[key] = this.backupLogFlags[key]
    }

    if (logFlags.playback_trace || logFlags.playback_debug) {
      logFlags.playback = true
    } else {
      logFlags.playback = false
    }
  }


  registerEndpoints(Context) {
    Context.network.registerExternalGet('log-fatal', isDebugModeMiddleware, (req, res) => {
      this.setFatalFlags()
      for (const [key, value] of Object.entries(logFlags)) {
        res.write(`${key}: ${value}\n`)
      }
      res.end()
    })
    Context.network.registerExternalGet('log-error', isDebugModeMiddleware, (req, res) => {
      this.setErrorFlags()
      for (const [key, value] of Object.entries(logFlags)) {
        res.write(`${key}: ${value}\n`)
      }
      res.end()
    })
    Context.network.registerExternalGet('log-default', isDebugModeMiddleware, (req, res) => {
      this.setDefaultFlags()
      for (const [key, value] of Object.entries(logFlags)) {
        res.write(`${key}: ${value}\n`)
      }      
      res.end()
    })


    // DO NOT USE IN LIVE NETWORK
    Context.network.registerExternalGet('log-default-all', isDebugModeMiddleware, (req, res) => {
      this.setDefaultFlags()

      try{
        let activeNodes = Context.p2p.state.getNodes()
        if(activeNodes){
          for(let node of activeNodes.values()){
            this._internalHackGet(`${node.externalIp}:${node.externalPort}/log-default`)
            res.write(`${node.externalIp}:${node.externalPort}/log-default\n`)
          }        
        }
        res.write(`joining nodes...\n`)  
        let joiningNodes = Context.p2p.state.getNodesRequestingJoin()
        if(joiningNodes){
          for(let node of joiningNodes.values()){
            this._internalHackGet(`${node.externalIp}:${node.externalPort}/log-default`)
            res.write(`${node.externalIp}:${node.externalPort}/log-default\n`)
          }        
        }

        res.write(`sending default logs to all nodes\n`)        
      } catch(e){
        res.write(`${e}\n`) 
      }

      res.end()
    })

    // DO NOT USE IN LIVE NETWORK
    Context.network.registerExternalGet('log-fatal-all', isDebugModeMiddleware, (req, res) => {
      this.setFatalFlags()
      try{
        let activeNodes = Context.p2p.state.getNodes()
        if(activeNodes){
          for(let node of activeNodes.values()){
            this._internalHackGet(`${node.externalIp}:${node.externalPort}/log-fatal`)
            res.write(`${node.externalIp}:${node.externalPort}/log-fatal\n`)
          }        
        }
        res.write(`joining nodes...\n`)  
        let joiningNodes = Context.p2p.state.getNodesRequestingJoin()
        if(joiningNodes){
          for(let node of joiningNodes.values()){
            this._internalHackGet(`${node.externalIp}:${node.externalPort}/log-fatal`)
            res.write(`${node.externalIp}:${node.externalPort}/log-fatal\n`)
          }  
        }
        res.write(`sending fatal logs to all nodes\n`)   
      } catch(e){
        res.write(`${e}\n`) 
      }
      res.end()
    })    

  }

  _containsProtocol(url: string) {
    if (!url.match('https?://*')) return false
    return true
  }
  
  _normalizeUrl(url: string) {
    let normalized = url
    if (!this._containsProtocol(url)) normalized = 'http://' + url
    return normalized
  }
  async _internalHackGet(url:string){
    let normalized = this._normalizeUrl(url)
    let host = parseUrl(normalized, true)
    try{
      await got.get(host, {
        timeout: 1000,   
        retry: 0,  
        throwHttpErrors: false,
        //parseJson: (text:string)=>{},
        //json: false, // the whole reason for _internalHackGet was because we dont want the text response to mess things up
                     //  and as a debug non shipping endpoint did not want to add optional parameters to http module
      })   
      
    } catch(e) {

    }

  }
  async _internalHackGetWithResp(url:string){
    let normalized = this._normalizeUrl(url)
    let host = parseUrl(normalized, true)
    try{
      const res = await got.get(host, {
        timeout: 7000,   
        retry: 0,  
        throwHttpErrors: false,
        //parseJson: (text:string)=>{},
        //json: false, // the whole reason for _internalHackGet was because we dont want the text response to mess things up
                     //  and as a debug non shipping endpoint did not want to add optional parameters to http module
      })   
      
      return res
    } catch(e) {
      return null
    }

  }

  setupLogControlValues() {
    logFlags.fatal = true

    let mainLogger = this.getLogger('main')
    // @ts-ignore
    if (mainLogger && ['TRACE','trace'].includes(mainLogger.level.levelStr)) {
      logFlags.verbose = true
      logFlags.debug = true
      logFlags.info = true
      logFlags.error = true
      // @ts-ignore
    } else if (mainLogger && ['DEBUG','debug'].includes(mainLogger.level.levelStr)) {
      logFlags.verbose = false
      logFlags.debug = true
      logFlags.info = true
      logFlags.error = true
      // @ts-ignore
    } else if (mainLogger && ['INFO','info'].includes(mainLogger.level.levelStr)) {
      logFlags.verbose = false
      logFlags.debug = false
      logFlags.info = true
      logFlags.error = true
      // @ts-ignore
    } else if (mainLogger && ['ERROR','error','WARN','warn'].includes(mainLogger.level.levelStr)) {
      logFlags.verbose = false
      logFlags.debug = false
      logFlags.info = true
      logFlags.error = true     
    } else {
      logFlags.verbose = false
      logFlags.debug = false
      logFlags.info = false
      logFlags.error = false
      //would still get warn..
    }

    let playbackLogger = this.getLogger('playback')
    logFlags.playback = false
    if(playbackLogger){
      // @ts-ignore
      logFlags.playback_trace = ['TRACE'].includes(playbackLogger.level.levelStr)
      // @ts-ignore
      logFlags.playback_debug = ['DEBUG'].includes(playbackLogger.level.levelStr)
      if (logFlags.playback_trace || logFlags.playback_debug) {
        logFlags.playback = true
      } else {
        logFlags.playback = false
      }  
    }
  
    let netLogger = this.getLogger('net')
    // @ts-ignore
    if (netLogger && ['TRACE','trace'].includes(netLogger.level.levelStr)) {
      logFlags.net_trace = true
    }

    let p2pLogger = this.getLogger('p2p')
    // @ts-ignore
    if (p2pLogger && ['FATAL','fatal'].includes(netLogger.level.levelStr)) {
      logFlags.p2pNonFatal = false
    } else {
      logFlags.p2pNonFatal = true
    }

    this.backupLogFlags = utils.deepCopy(logFlags)

    console.log(`logFlags: ` + stringify(logFlags))
  }
}

export default Logger
