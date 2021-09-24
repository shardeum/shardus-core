import * as Context from '../p2p/Context'
import * as Self from '../p2p/Self'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { memoryReportingInstance } from '../utils/memoryReporting'
import { sleep } from '../utils/functions/time'
import { resolveTxt } from 'dns'
import { isDebugModeMiddleware } from '../network/debugMiddleware'

const NS_PER_SEC = 1e9

let profilerSelfReporting = false

interface Profiler {
  sectionTimes: any
  // instance: Profiler
}

export interface NodeLoad {
  internal: number
  external: number
}

export let profilerInstance: Profiler
class Profiler {
  sectionTimes: any
  eventCounters: Map<string, Map<string, number>>
  stackHeight: number
  netInternalStackHeight: number
  netExternalStackHeight: number

  constructor() {
    this.sectionTimes = {}
    this.eventCounters = new Map()
    this.stackHeight = 0
    this.netInternalStackHeight = 0
    this.netExternalStackHeight = 0
    profilerInstance = this

    this.profileSectionStart('_total', true)
    this.profileSectionStart('_internal_total', true)
  }

  registerEndpoints() {
    Context.network.registerExternalGet('perf', isDebugModeMiddleware, (req, res) => {
      let result = this.printAndClearReport(1)
      //res.json({result })

      res.write(result)
      res.end()
    })

    Context.network.registerExternalGet('combined-debug', isDebugModeMiddleware, async (req, res) => {
      const waitTime = Number.parseInt(req.query.wait as string, 10) || 60

      // hit "counts-reset" endpoint
      this.eventCounters = new Map()
      res.write(`counts reset at ${new Date()}\n`)

      // hit "perf" endpoint to clear perf stats
      this.printAndClearReport(1)

      // wait X seconds
      await sleep(waitTime * 1000)
      res.write(`Results for ${waitTime} sec of sampling...`)
      res.write(`\n===========================\n`)

      // write nodeId, ip and port
      res.write(`\n=> NODE DETAIL\n`)
      res.write(`NODE ID: ${Self.id}\n`)
      res.write(`IP: ${Self.ip}\n`)
      res.write(`PORT: ${Self.port}\n`)

      // write "memory" results
      let toMB = 1/1000000
      let report = process.memoryUsage()
      res.write(`\n=> MEMORY RESULTS\n`)
      res.write(`System Memory Report.  Timestamp: ${Date.now()}\n`)
      res.write(`rss: ${(report.rss * toMB).toFixed(2)} MB\n`)
      res.write(`heapTotal: ${(report.heapTotal * toMB).toFixed(2)} MB\n`)
      res.write(`heapUsed: ${(report.heapUsed * toMB).toFixed(2)} MB\n`)
      res.write(`external: ${(report.external * toMB).toFixed(2)} MB\n`)
      res.write(`arrayBuffers: ${(report.arrayBuffers * toMB).toFixed(2)} MB\n\n\n`)
      memoryReportingInstance.gatherReport()
      memoryReportingInstance.reportToStream(memoryReportingInstance.report, res, 0)

      // write "perf" results
      let result = this.printAndClearReport(1)
      res.write(`\n=> PERF RESULTS\n`)
      res.write(result)
      res.write(`\n===========================\n`)

      // write "counts" results
      let arrayReport = nestedCountersInstance.arrayitizeAndSort(nestedCountersInstance.eventCounters)
      res.write(`\n=> COUNTS RESULTS\n`)
      res.write(`${Date.now()}\n`)
      nestedCountersInstance.printArrayReport(arrayReport, res, 0)
      res.write(`\n===========================\n`)

      res.end()
    })
  }

  profileSectionStart(sectionName, internal = false) {
    let section = this.sectionTimes[sectionName]

    if (section != null && section.started === true) {
      if (profilerSelfReporting)
        nestedCountersInstance.countEvent('profiler-start-error', sectionName)
      return
    }

    if (section == null) {
      let t = BigInt(0)
      section = { name: sectionName, total: t, c: 0, internal }
      this.sectionTimes[sectionName] = section
    }

    section.start = process.hrtime.bigint()
    section.started = true
    section.c++

    if (internal === false) {
      nestedCountersInstance.countEvent('profiler', sectionName)

      this.stackHeight++
      if (this.stackHeight === 1) {
        this.profileSectionStart('_totalBusy', true)
        this.profileSectionStart('_internal_totalBusy', true)
      }
      if (sectionName === 'net-internl') {
        this.netInternalStackHeight++
        if (this.netInternalStackHeight === 1) {
          this.profileSectionStart('_internal_net-internl', true)
        }
      }
      if (sectionName === 'net-externl') {
        this.netExternalStackHeight++
        if (this.netExternalStackHeight === 1) {
          this.profileSectionStart('_internal_net-externl', true)
        }
      }
    }
  }

  profileSectionEnd(sectionName, internal = false) {
    let section = this.sectionTimes[sectionName]
    if (section == null || section.started === false) {
      if (profilerSelfReporting)
        nestedCountersInstance.countEvent('profiler-end-error', sectionName)
      return
    }

    section.end = process.hrtime.bigint()

    section.total += section.end - section.start
    section.started = false

    if (internal === false) {
      if (profilerSelfReporting)
        nestedCountersInstance.countEvent('profiler-end', sectionName)

      this.stackHeight--
      if (this.stackHeight === 0) {
        this.profileSectionEnd('_totalBusy', true)
        this.profileSectionEnd('_internal_totalBusy', true)
      }
      if (sectionName === 'net-internl') {
        this.netInternalStackHeight--
        if (this.netInternalStackHeight === 0) {
          this.profileSectionEnd('_internal_net-internl', true)
        }
      }
      if (sectionName === 'net-externl') {
        this.netExternalStackHeight--
        if (this.netExternalStackHeight === 0) {
          this.profileSectionEnd('_internal_net-externl', true)
        }
      }
    }
  }

  cleanInt(x) {
    x = Number(x)
    return x >= 0 ? Math.floor(x) : Math.ceil(x)
  }

  getTotalBusyInternal(): any {
    if (profilerSelfReporting)
      nestedCountersInstance.countEvent('profiler-note', 'getTotalBusyInternal')

    this.profileSectionEnd('_internal_total', true)
    let internalTotalBusy = this.sectionTimes['_internal_totalBusy']
    let internalTotal = this.sectionTimes['_internal_total']
    let internalNetInternl = this.sectionTimes['_internal_net-internl']
    let internalNetExternl = this.sectionTimes['_internal_net-externl']
    let duty = BigInt(0)
    let netInternlDuty = BigInt(0)
    let netExternlDuty = BigInt(0)
    if (internalTotalBusy != null && internalTotal != null) {
      if (internalTotal.total > BigInt(0)) {
        duty = (BigInt(100) * internalTotalBusy.total) / internalTotal.total
      }
    }
    if (internalNetInternl != null && internalTotal != null) {
      if (internalTotal.total > BigInt(0)) {
        netInternlDuty =
          (BigInt(100) * internalNetInternl.total) / internalTotal.total
      }
    }
    if (internalNetExternl != null && internalTotal != null) {
      if (internalTotal.total > BigInt(0)) {
        netExternlDuty =
          (BigInt(100) * internalNetExternl.total) / internalTotal.total
      }
    }
    this.profileSectionStart('_internal_total', true)

    //clear these timers
    internalTotal.total = BigInt(0)
    internalTotalBusy.total = BigInt(0)
    if (internalNetInternl) internalNetInternl.total = BigInt(0)
    if (internalNetExternl) internalNetExternl.total = BigInt(0)

    return {
      duty: Number(duty) * 0.01,
      netInternlDuty: Number(netInternlDuty) * 0.01,
      netExternlDuty: Number(netExternlDuty) * 0.01,
    }
  }

  clearTimes() {
    for (let key in this.sectionTimes) {
      if (key.startsWith('_internal')) continue

      if (this.sectionTimes.hasOwnProperty(key)) {
        let section = this.sectionTimes[key]
        section.total = BigInt(0)
      }
    }
  }

  printAndClearReport(delta?: number): string {
    this.profileSectionEnd('_total', true)

    let result = 'Profile Sections:\n'
    let d1 = this.cleanInt(1e6) // will get us ms
    let divider = BigInt(d1)

    let totalSection = this.sectionTimes['_total']
    let totalBusySection = this.sectionTimes['_totalBusy']
    console.log('totalSection from printAndClearReport', totalSection)

    let lines = []
    for (let key in this.sectionTimes) {
      if (key.startsWith('_internal')) continue

      if (this.sectionTimes.hasOwnProperty(key)) {
        let section = this.sectionTimes[key]

        // result += `${section.name}: total ${section.total /
        //   divider} avg:${section.total / (divider * BigInt(section.c))} ,  ` // ${section.total} :

        let duty = BigInt(0)
        if (totalSection.total > BigInt(0)) {
          duty = (BigInt(100) * section.total) / totalSection.total
        }
        let totalMs = section.total / divider
        let dutyStr = `${duty}`.padStart(4)
        let totalStr = `${totalMs}`.padStart(13)
        let line = `${dutyStr}% ${section.name.padEnd(30)}, ${totalStr}ms, #:${
          section.c
        }`
        //section.total = BigInt(0)

        lines.push({ line, totalMs })
      }
    }

    lines.sort((l1, l2) => Number(l2.totalMs - l1.totalMs))

    result = result + lines.map((line) => line.line).join('\n')

    this.clearTimes()

    this.profileSectionStart('_total', true)
    return result
  }
}

export default Profiler
