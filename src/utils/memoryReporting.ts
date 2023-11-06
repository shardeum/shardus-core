import * as Context from '../p2p/Context'
import * as utils from '../utils'
import Crypto from '../crypto'
import Shardus from '../shardus'
import * as CycleCreator from '../p2p/CycleCreator'
import os from 'os'
import { nestedCountersInstance } from '../utils/nestedCounters'
import process, { resourceUsage } from 'process'
import { isDebugModeMiddleware } from '../network/debugMiddleware'
import * as NodeList from '../p2p/NodeList'
import { spawn } from 'child_process'
import { getNetworkTimeOffset, shardusGetTime } from '../network'

type CounterMap = Map<string, CounterNode>
interface CounterNode {
  count: number
  subCounters: CounterMap
}

export let memoryReportingInstance: MemoryReporting

type MemItem = {
  category: string
  subcat: string
  itemKey: string
  count: number
}

class MemoryReporting {
  crypto: Crypto
  report: MemItem[]
  shardus: Shardus
  lastCPUTimes: object[]

  constructor(shardus: Shardus) {
    this.crypto = null
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    memoryReportingInstance = this
    this.report = []
    this.shardus = shardus

    this.lastCPUTimes = this.getCPUTimes()
  }

  registerEndpoints(): void {
    Context.network.registerExternalGet('memory', isDebugModeMiddleware, (req, res) => {
      const toMB = 1 / 1000000
      const report = process.memoryUsage()
      res.write(`System Memory Report.  Timestamp: ${shardusGetTime()}\n`)
      res.write(`rss: ${(report.rss * toMB).toFixed(2)} MB\n`)
      res.write(`heapTotal: ${(report.heapTotal * toMB).toFixed(2)} MB\n`)
      res.write(`heapUsed: ${(report.heapUsed * toMB).toFixed(2)} MB\n`)
      res.write(`external: ${(report.external * toMB).toFixed(2)} MB\n`)
      res.write(`arrayBuffers: ${(report.arrayBuffers * toMB).toFixed(2)} MB\n\n\n`)

      this.gatherReport()
      this.reportToStream(this.report, res)
      res.end()
    })

    Context.network.registerExternalGet('memory-short', isDebugModeMiddleware, (req, res) => {
      // only here to so we can test the rare event counter system
      nestedCountersInstance.countRareEvent('test', 'memory-short')

      const toMB = 1 / 1000000
      const report = process.memoryUsage()
      res.write(`System Memory Report.  Timestamp: ${shardusGetTime()}\n`)
      res.write(`rss: ${(report.rss * toMB).toFixed(2)} MB\n`)
      res.write(`heapTotal: ${(report.heapTotal * toMB).toFixed(2)} MB\n`)
      res.write(`heapUsed: ${(report.heapUsed * toMB).toFixed(2)} MB\n`)
      res.write(`external: ${(report.external * toMB).toFixed(2)} MB\n`)
      res.write(`arrayBuffers: ${(report.arrayBuffers * toMB).toFixed(2)} MB\n`)
      res.end()
    })

    Context.network.registerExternalGet('nodelist', isDebugModeMiddleware, (req, res) => {
      this.report = []
      this.addNodesToReport()
      res.write('\n')
      this.reportToStream(this.report, res)
      res.write('\n')
      res.end()
    })

    Context.network.registerExternalGet('netstats', isDebugModeMiddleware, (req, res) => {
      this.report = []
      res.write('\n')
      this.addNetStatsToReport()
      this.reportToStream(this.report, res)
      res.write('\n')
      res.end()
    })

    Context.network.registerExternalGet('top', isDebugModeMiddleware, (req, res) => {
      // This would work well in linux OS.
      const top = spawn('top', ['b', '-n', '10', '1'])
      top.stdout.on('data', (dataBuffer) => {
        res.write(dataBuffer)
        top.kill()
        res.end()
      })
      top.on('close', (code) => {
        console.log(`child process exited with code ${code}`)
      })
      top.stderr.on('data', (data) => {
        console.log('top command error', data)
        res.write('top command error')
        top.kill()
        res.end()
      })
    })

    Context.network.registerExternalGet('df', isDebugModeMiddleware, (req, res) => {
      const df = spawn('df')
      df.stdout.on('data', (dataBuffer) => {
        res.write(dataBuffer)
        df.kill()
        res.end()
      })
      df.on('close', (code) => {
        console.log(`child process exited with code ${code}`)
      })
      df.stderr.on('data', (data) => {
        console.log('df command error', data)
        res.write('df command error')
        df.kill()
        res.end()
      })
    })

    Context.network.registerExternalGet('memory-gc', isDebugModeMiddleware, (req, res) => {
      res.write(`System Memory Report.  Timestamp: ${shardusGetTime()}\n`)
      try {
        if (global.gc) {
          global.gc()
          res.write('garbage collected!')
        } else {
          res.write('No access to global.gc.  run with node --expose-gc')
        }
      } catch (e) {
        res.write('ex:No access to global.gc.  run with node --expose-gc')
      }
      res.end()
    })

    Context.network.registerExternalGet('scaleFactor', isDebugModeMiddleware, (req, res) => {
      res.write(`Scale debug  Timestamp: ${shardusGetTime()} offset: ${getNetworkTimeOffset()} \n`)
      try {
        res.write(`CycleAutoScale.  ${CycleCreator.scaleFactor}`)
      } catch (e) {
        res.write(JSON.stringify(e))
      }
      res.end()
    })

    Context.network.registerExternalGet('time-report', isDebugModeMiddleware, (req, res) => {
      const timeReport = { now: Date.now, shardusGetTime: shardusGetTime(), offset: getNetworkTimeOffset() }
      res.write(JSON.stringify(timeReport, null, 2))
      res.end()
    })
  }

  private addNodesToReport(): void {
    if (NodeList.activeByIdOrder) {
      const allNodeIds = []
      for (const node of NodeList.activeByIdOrder) {
        allNodeIds.push(utils.makeShortHash(node.id))
      }
      this.addToReport('P2P', 'Nodelist', `${utils.stringifyReduce(allNodeIds)}`, 1)
    }
  }

  getMemoryStringBasic(): string {
    const toMB = 1 / 1000000
    const report = process.memoryUsage()
    let outStr = `rss: ${(report.rss * toMB).toFixed(2)} MB`
    //todo integrate this into the main stats tsv
    if (this.shardus && this.shardus.stateManager) {
      const numActiveNodes = NodeList.activeByIdOrder.length
      const queueCount = this.shardus.stateManager.transactionQueue._transactionQueue.length
      const archiveQueueCount = this.shardus.stateManager.transactionQueue.archivedQueueEntries.length

      outStr += ` nds:${numActiveNodes} qCt:${queueCount} aAr:${archiveQueueCount}`
    }
    outStr += '\n'
    return outStr
  }

  addToReport(category: string, subcat: string, itemKey: string, count: number): void {
    const obj = { category, subcat, itemKey, count }
    this.report.push(obj)
  }

  reportToStream(report: MemItem[], stream): void {
    for (const item of report) {
      const { category, subcat, itemKey, count } = item
      const countStr = `${count}`
      stream.write(`${countStr.padStart(10)} ${category} ${subcat} ${itemKey}\n`)
    }
  }

  gatherReport(): void {
    this.report = []
    this.gatherStateManagerReport()
    this.systemProcessReport()
    this.addNetStatsToReport()
  }

  gatherStateManagerReport(): void {
    if (this.shardus && this.shardus.stateManager) {
      if (NodeList.activeByIdOrder) {
        const numActiveNodes = NodeList.activeByIdOrder.length
        this.addToReport('P2P', 'Nodelist', 'numActiveNodes', numActiveNodes)
      }

      const cacheDbg = this.shardus.stateManager.accountCache.getDebugStats()
      this.addToReport('StateManager', 'AccountsCache', 'workingAccounts', cacheDbg[0])
      this.addToReport('StateManager', 'AccountsCache', 'mainMap', cacheDbg[1])

      const queueCount = this.shardus.stateManager.transactionQueue._transactionQueue.length
      this.addToReport('StateManager', 'TXQueue', 'queueCount', queueCount)
      const pendingQueueCount = this.shardus.stateManager.transactionQueue.pendingTransactionQueue.length
      this.addToReport('StateManager', 'TXQueue', 'pendingQueueCount', pendingQueueCount)
      const archiveQueueCount = this.shardus.stateManager.transactionQueue.archivedQueueEntries.length
      this.addToReport('StateManager', 'TXQueue', 'archiveQueueCount', archiveQueueCount)
      const executeQueueLength = this.shardus.stateManager.transactionQueue.getExecuteQueueLength()
      this.addToReport('StateManager', 'TXQueue', 'executeQueueLength', executeQueueLength)

      for (const syncTracker of this.shardus.stateManager.accountSync.syncTrackers) {
        const partition = `${utils.stringifyReduce(syncTracker.range?.low)} - ${utils.stringifyReduce(
          syncTracker.range?.high
        )}`
        this.addToReport(
          'StateManager',
          'SyncTracker',
          `isGlobal:${syncTracker.isGlobalSyncTracker} started:${syncTracker.syncStarted} finished:${syncTracker.syncFinished} partition:${partition}`,
          1
        )
      }

      const inSync = !this.shardus.stateManager.accountPatcher.failedLastTrieSync
      this.addToReport('Patcher', 'insync', `${inSync}`, 1)
      this.addToReport(
        'Patcher',
        'history',
        JSON.stringify(this.shardus.stateManager.accountPatcher.syncFailHistory),
        1
      )

      this.addToReport('Patcher', 'insync', `${inSync}`, 1)
    }
  }

  getCPUTimes(): object[] {
    const cpus = os.cpus()
    const times = []

    for (const cpu of cpus) {
      const timeObj = {}
      let total = 0
      for (const [key, value] of Object.entries(cpu.times)) {
        const time = Number(value)
        total += time
        // eslint-disable-next-line security/detect-object-injection
        timeObj[key] = value
      }
      timeObj['total'] = total

      times.push(timeObj)
    }
    return times
  }

  cpuPercent(): number {
    const currentTimes = this.getCPUTimes()

    const deltaTimes = []
    const percentTimes = []

    let percentTotal = 0

    for (let i = 0; i < currentTimes.length; i++) {
      /* eslint-disable security/detect-object-injection */
      const currentTimeEntry = currentTimes[i]
      const lastTimeEntry = this.lastCPUTimes[i]
      const deltaTimeObj = {}
      for (const [key] of Object.entries(currentTimeEntry)) {
        deltaTimeObj[key] = currentTimeEntry[key] - lastTimeEntry[key]
      }
      deltaTimes.push(deltaTimeObj)

      for (const [key] of Object.entries(currentTimeEntry)) {
        percentTimes[key] = deltaTimeObj[key] / deltaTimeObj['total']
      }

      percentTotal += percentTimes['user'] || 0
      percentTotal += percentTimes['nice'] || 0
      percentTotal += percentTimes['sys'] || 0
      /* eslint-enable security/detect-object-injection */
    }

    this.lastCPUTimes = currentTimes
    const percentUsed = percentTotal / currentTimes.length

    return percentUsed
  }

  roundTo3decimals(num: number): number {
    return Math.round((num + Number.EPSILON) * 1000) / 1000
  }

  systemProcessReport(): void {
    this.addToReport('Process', 'CPU', 'cpuPercent', this.roundTo3decimals(this.cpuPercent() * 100))

    const avgCPU = this.shardus.statistics.getAverage('cpuPercent')
    this.addToReport('Process', 'CPU', 'cpuAVGPercent', this.roundTo3decimals(avgCPU * 100))
    const multiStats = this.shardus.statistics.getMultiStatReport('cpuPercent')

    multiStats.allVals.forEach((val, index) => {
      // eslint-disable-next-line security/detect-object-injection
      multiStats.allVals[index] = Math.round(val * 100)
    })
    multiStats.min = this.roundTo3decimals(multiStats.min * 100)
    multiStats.max = this.roundTo3decimals(multiStats.max * 100)
    multiStats.avg = this.roundTo3decimals(multiStats.avg * 100)

    this.addToReport('Process', 'CPU', `cpu: ${JSON.stringify(multiStats)}`, 1)

    const report = resourceUsage()
    for (const [key, value] of Object.entries(report)) {
      this.addToReport('Process', 'Details', key, value)
    }
  }

  getShardusNetReport(): object {
    if (this.shardus == null || this.shardus.network == null || this.shardus.network.sn == null) {
      return null
    }
    if (this.shardus.network.sn.stats != null) {
      const stats = this.shardus.network.sn.stats()
      return stats
    }
    return null
  }

  addNetStatsToReport(): void {
    const stats = this.getShardusNetReport()
    if (stats != null) {
      this.addToReport('NetStats', 'stats', 'stats', (JSON.stringify(stats, null, 4), 1))
    }
  }
}

export default MemoryReporting
