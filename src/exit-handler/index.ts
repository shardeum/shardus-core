import Log4js from 'log4js'
import * as Context from '../p2p/Context'
import { profilerInstance } from '../utils/profiler'
import { getPublicNodeInfo, NodeInfo } from '../p2p/Self'
import path from 'path'
import fs from 'fs'
import * as NodeList from '../p2p/NodeList'
import * as Self from '../p2p/Self'

interface ExitSummary {
  message: string
  exitTime: number
  totalActiveTime: number
  nodeInfo: NodeInfo
  lastRotationIndex: { idx: number; total: number }
  activeNodes: number
  lastActiveTime: number
}
interface ExitHandler {
  exited: boolean
  syncFuncs: Map<string, Function>
  asyncFuncs: Map<string, Function>
  exitLogger: Log4js.Logger
  memStats: any
  counters: any
  logDir: string
  activeStartTime: number
  lastActiveTime: number
  lastRotationIndex: { idx: number; total: number }
}

class ExitHandler {
  constructor(logDir: string, _memoryReporting: any, _nestedCounters: any) {
    this.exited = false
    this.syncFuncs = new Map()
    this.asyncFuncs = new Map()
    this.memStats = _memoryReporting
    this.counters = _nestedCounters
    this.exitLogger = Context.logger.getLogger('exit')
    this.logDir = logDir

    Self.emitter.once('active', () => {
      let cycles = Context.p2p.getLatestCycles(1)
      if (cycles.length > 0) {
        this.activeStartTime = cycles[0].start * 1000
      }
    })

    Self.emitter.on('cycle_q1_start', () => {
      if (Self.isActive) {
        let rotatationIndex = NodeList.getAgeIndex()
        if (rotatationIndex.idx >= 0) {
          this.lastRotationIndex = rotatationIndex
        }
        let cycles = Context.p2p.getLatestCycles(1)
        if (cycles.length > 0) {
          this.lastActiveTime = cycles[0].start * 1000
        }
      }
      this.writeNodeProgress()
    })
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
      this.runExitLog('Being exited cleanly')
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
      this.runExitLog(`Being exited uncleanly with signal type: ${SIG_TYPE}`)
      await this._cleanupAsync()
    } catch (e) {
      console.error(e)
    }
    // eslint-disable-next-line no-process-exit
    process.exit(1) // exiting with status 1 causes our modified PM2 to not restart the process
  }

  runExitLog(msg: string) {
    this.exitLogger.fatal(msg)
    let log: string[] = []
    const fakeStream = {
      write: (data: string) => {
        log.push(data)
      },
    }
    const toMB = 1 / 1000000
    const report = process.memoryUsage()

    log.push(`System Memory Report.  Timestamp: ${Date.now()}\n`)
    log.push(`rss: ${(report.rss * toMB).toFixed(2)} MB\n`)
    log.push(`heapTotal: ${(report.heapTotal * toMB).toFixed(2)} MB\n`)
    log.push(`heapUsed: ${(report.heapUsed * toMB).toFixed(2)} MB\n`)
    log.push(`external: ${(report.external * toMB).toFixed(2)} MB\n`)
    log.push(`arrayBuffers: ${(report.arrayBuffers * toMB).toFixed(2)} MB\n\n\n`)

    this.memStats.gatherReport()
    this.memStats.reportToStream(this.memStats.report, fakeStream, 0)
    this.exitLogger.fatal(log.join(''))

    log = []
    profilerInstance.scopedProfileSectionStart('counts')
    const arrayReport = this.counters.arrayitizeAndSort(this.counters.eventCounters)

    this.counters.printArrayReport(arrayReport, fakeStream, 0)
    profilerInstance.scopedProfileSectionEnd('counts')
    this.exitLogger.fatal(log.join(''))

    this.writeExitSummary(msg)
  }

  //not exactly an exit statement but is similar to our exit report
  //will overwrite with the latest info
  writeNodeProgress() {
    let nodeProgress = {
      nodeInfo: null,
      lastRotationIndex: this.lastRotationIndex,
      activeNodes: NodeList.activeByIdOrder.length,
      lastActiveTime: this.lastActiveTime,
    }

    try {
      nodeProgress.nodeInfo = getPublicNodeInfo()
    } catch (er) {}

    try {
      let filePath = path.join(this.logDir, 'node-progress.json')
      let content = JSON.stringify(nodeProgress, null, 2)
      fs.writeFileSync(filePath, content, { encoding: 'utf8', flag: 'w' })
    } catch (er) {}
  }

  writeExitSummary(msg: string) {
    let exitSummary: ExitSummary = {
      message: msg,
      exitTime: Date.now(),
      totalActiveTime: 0,
      nodeInfo: null,
      lastRotationIndex: this.lastRotationIndex,
      activeNodes: NodeList.activeByIdOrder.length,
      lastActiveTime: this.lastActiveTime,
    }

    if (this.activeStartTime > 0 && this.lastActiveTime > 0) {
      exitSummary.totalActiveTime = this.lastActiveTime - this.activeStartTime
    }

    try {
      exitSummary.nodeInfo = getPublicNodeInfo()
    } catch (er) {}

    try {
      exitSummary.nodeInfo = getPublicNodeInfo()
    } catch (er) {}

    try {
      let filePath = path.join(this.logDir, 'exit-summary.json')
      let content = JSON.stringify(exitSummary, null, 2)
      fs.writeFileSync(filePath, content, { encoding: 'utf8', flag: 'w' })
    } catch (er) {}
  }

  // Used for adding event listeners for the SIGINT and SIGTERM signals
  addSigListeners(sigint = true, sigterm = true) {
    if (sigint) {
      process.on('SIGINT', async () => {
        // await this.exitCleanly()
        await this.exitUncleanly('SIGINT')
      })
      //gracefull shutdown suppport in windows. should mirror what SIGINT does in linux
      process.on('message', async (msg) => {
        if (msg == 'shutdown') {
          await this.exitUncleanly('message:shutdown')
        }
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
