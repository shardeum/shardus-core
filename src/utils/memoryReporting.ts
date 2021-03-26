const NS_PER_SEC = 1e9

import { Utils } from 'sequelize/types'
import * as Context from '../p2p/Context'
import * as utils from '../utils'
import Crypto from "../crypto"
import Shardus from '../shardus'
import StateManager from '../state-manager'

const process = require('process');

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

  constructor(shardus:Shardus) {

    this.crypto = null
    memoryReportingInstance = this
    this.report = []
    this.shardus = shardus
  }

  registerEndpoints() {
    Context.network.registerExternalGet('memory', (req, res) => {
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
    Context.network.registerExternalGet('memory-short', (req, res) => {
      
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

      //TODO more detailed reports!!!
    }


  }

}

export default MemoryReporting
