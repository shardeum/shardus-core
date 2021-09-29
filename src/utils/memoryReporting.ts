const NS_PER_SEC = 1e9

import { Utils } from 'sequelize/types'
import * as Context from '../p2p/Context'
import * as utils from '../utils'
import Crypto from "../crypto"
import Shardus from '../shardus'
import StateManager from '../state-manager'
import * as CycleCreator from '../p2p/CycleCreator'
const os = require('os');
import { nestedCountersInstance } from '../utils/nestedCounters'
const process = require('process');
import { resourceUsage } from 'process';
import { isDebugModeMiddleware } from '../network/debugMiddleware'

// process.hrtime.bigint()

interface MemoryReporting {}

type CounterMap = Map<string, CounterNode>
interface CounterNode {
    count: number
    subCounters: CounterMap

}

export let memoryReportingInstance: MemoryReporting

type MemItem = {
  category:string
  subcat:string
  itemKey:string
  count:number
}

class MemoryReporting {
  
  crypto: Crypto
  report: MemItem[]
  shardus: Shardus
  lastCPUTimes: any[]

  constructor(shardus:Shardus) {

    this.crypto = null
    memoryReportingInstance = this
    this.report = []
    this.shardus = shardus

    this.lastCPUTimes = this.getCPUTimes()
  }

  registerEndpoints() {
    Context.network.registerExternalGet('memory', isDebugModeMiddleware, (req, res) => {
        let toMB = 1/1000000
        let report = process.memoryUsage()
        res.write(`System Memory Report.  Timestamp: ${Date.now()}\n`)
        res.write(`rss: ${(report.rss * toMB).toFixed(2)} MB\n`)
        res.write(`heapTotal: ${(report.heapTotal * toMB).toFixed(2)} MB\n`)
        res.write(`heapUsed: ${(report.heapUsed * toMB).toFixed(2)} MB\n`)
        res.write(`external: ${(report.external * toMB).toFixed(2)} MB\n`)
        res.write(`arrayBuffers: ${(report.arrayBuffers * toMB).toFixed(2)} MB\n\n\n`)

        this.gatherReport()
        this.reportToStream(this.report, res, 0)
        res.end()

    })
    Context.network.registerExternalGet('memory-short', isDebugModeMiddleware, (req, res) => {
      nestedCountersInstance.countRareEvent('test', `memory-short`) // only here to so we can test the rare event counter system

      let toMB = 1/1000000
      let report = process.memoryUsage()
      res.write(`System Memory Report.  Timestamp: ${Date.now()}\n`)
      res.write(`rss: ${(report.rss * toMB).toFixed(2)} MB\n`)
      res.write(`heapTotal: ${(report.heapTotal * toMB).toFixed(2)} MB\n`)
      res.write(`heapUsed: ${(report.heapUsed * toMB).toFixed(2)} MB\n`)
      res.write(`external: ${(report.external * toMB).toFixed(2)} MB\n`)
      res.write(`arrayBuffers: ${(report.arrayBuffers * toMB).toFixed(2)} MB\n`)
      res.end()
    })

    Context.network.registerExternalGet('memory-gc', isDebugModeMiddleware, (req, res) => {

      res.write(`System Memory Report.  Timestamp: ${Date.now()}\n`)
      try {
        if (global.gc) {
          global.gc();
          res.write('garbage collected!');
        } else {
          res.write('No access to global.gc.  run with node --expose-gc');
        }
      } catch (e) {
        res.write('ex:No access to global.gc.  run with node --expose-gc');
      }
      res.end()
    })

    Context.network.registerExternalGet('scaleFactor', isDebugModeMiddleware, (req, res) => {
      
      res.write(`Scale debug  Timestamp: ${Date.now()}\n`)
      try {
        res.write(`CycleAutoScale.  ${CycleCreator.scaleFactor}`)
      } catch (e) {
        res.write(JSON.stringify(e));
      }
      res.end()
    })

  }


  getMemoryStringBasic(){
    let toMB = 1/1000000
    let report = process.memoryUsage()
    return `rss: ${(report.rss * toMB).toFixed(2)} MB\n`
  }


  addToReport(category:string, subcat:string, itemKey:string, count:number){
    let obj = {category, subcat, itemKey, count}
    this.report.push(obj)
  }

  reportToStream(report:MemItem[], stream, indent){
    
    let indentText = '___'.repeat(indent)
    for (let item of report) {
      let {category, subcat, itemKey, count} = item
      let countStr = `${count}`
      stream.write(
      `${countStr.padStart(10)} ${category} ${subcat} ${itemKey}\n`
      )

      // if (subArray != null && subArray.length > 0) {
      //   this.printArrayReport(subArray, stream, indent + 1)
      // }
    }
  }

  gatherReport(){
    this.report = []
    this.gatherStateManagerReport()
    this.systemProcessReport()
  }

  gatherStateManagerReport(){
    if(this.shardus && this.shardus.stateManager){

      let cacheCount = this.shardus.stateManager.accountCache.accountsHashCache3.workingHistoryList.accountIDs.length
      this.addToReport('StateManager','AccountsCache', 'workingAccounts', cacheCount )
      let cacheCount2 = this.shardus.stateManager.accountCache.accountsHashCache3.accountHashMap.size
      this.addToReport('StateManager','AccountsCache', 'mainMap', cacheCount2 )
      
      let queueCount = this.shardus.stateManager.transactionQueue.newAcceptedTxQueue.length
      this.addToReport('StateManager','TXQueue', 'queueCount', queueCount )
      let pendingQueueCount = this.shardus.stateManager.transactionQueue.newAcceptedTxQueueTempInjest.length
      this.addToReport('StateManager','TXQueue', 'pendingQueueCount', pendingQueueCount )
      let archiveQueueCount = this.shardus.stateManager.transactionQueue.archivedQueueEntries.length
      this.addToReport('StateManager','TXQueue', 'archiveQueueCount', archiveQueueCount )

      
      for(let syncTracker of this.shardus.stateManager.accountSync.syncTrackers){
        let partition = `${utils.stringifyReduce(syncTracker.range.low)} - ${utils.stringifyReduce(syncTracker.range.high)}`
        this.addToReport('StateManager','SyncTracker', `isGlobal:${syncTracker.isGlobalSyncTracker} started:${syncTracker.syncStarted} finished:${syncTracker.syncFinished} partition:${partition}`, 1 )
      }

    }
  }


  getCPUTimes(){
    const cpus = os.cpus();
    let times = []
    
    for(let cpu of cpus){
      let timeObj = {}
      let total = 0
      for(const [key, value] of Object.entries(cpu.times)){
        let time = Number(value)
        total += time
        timeObj[key] = value
      }  
      timeObj['total'] = total

      times.push(timeObj)
    }
    return times
  }

  cpuPercent(){
 
    let currentTimes = this.getCPUTimes()

    let deltaTimes = []
    let percentTimes = []
    
    let percentTotal = 0
    
    for(let i=0; i< currentTimes.length; i++) {
      const currentTimeEntry = currentTimes[i];
      const lastTimeEntry = this.lastCPUTimes[i]
      let deltaTimeObj = {}
      for(const [key, value] of Object.entries(currentTimeEntry)){
        deltaTimeObj[key] = currentTimeEntry[key] - lastTimeEntry[key]
      }  
      deltaTimes.push(deltaTimeObj)

      for(const [key, value] of Object.entries(currentTimeEntry)){
        percentTimes[key] = deltaTimeObj[key] / deltaTimeObj['total']
      } 
      
      percentTotal += (percentTimes['user'] || 0)
      percentTotal += (percentTimes['nice'] || 0)
      percentTotal += (percentTimes['sys'] || 0)

    }

    this.lastCPUTimes = currentTimes
    let percentUsed = percentTotal / currentTimes.length

    // const usage = process.cpuUsage();
    // const currentCPUUsage = (usage.user + usage.system) * 1000; //micro seconds to ms
    // const percentUsed = currentCPUUsage / total * 100

    return percentUsed 
  }


  systemProcessReport(){

    this.addToReport('Process','CPU', 'cpuPercent', this.cpuPercent() )

    let avgCPU = this.shardus.statistics.getAverage('cpuPercent')
    this.addToReport('Process','CPU', 'cpuAVGPercent', avgCPU )

    let report = resourceUsage()
    for (const [key, value] of Object.entries(report)) {
      this.addToReport('Process','Details', key, value )
    }

  }

}

export default MemoryReporting
