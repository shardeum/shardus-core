import * as Context from '../p2p/Context'
import * as Self from '../p2p/Self'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { memoryReportingInstance } from '../utils/memoryReporting'
import { sleep } from '../utils/functions/time'
import { resolveTxt } from 'dns'
import { isDebugModeMiddleware } from '../network/debugMiddleware'
import { humanFileSize } from '.'

const NS_PER_SEC = 1e9

const cDefaultMin = 1e12
const cDefaultMinBig = BigInt(cDefaultMin)

let profilerSelfReporting = false

interface Profiler {
  sectionTimes: any
  // instance: Profiler
}

export const cNoSizeTrack = -2
export const cUninitializedSize = -1

type NumberStat = {
  total: number
  max: number
  min: number
  avg: number
  c: number
}

type BigNumberStat = {
  total: bigint
  max: bigint
  min: bigint
  avg: bigint
  c: number
}

type SectionStat = BigNumberStat & {
  name: string
  internal: boolean
  req: NumberStat
  resp: NumberStat
  start: bigint
  end: bigint
  started: boolean
  reentryCount: number
  reentryCountEver: number
}

export interface NodeLoad {
  internal: number
  external: number
}

export let profilerInstance: Profiler
class Profiler {
  sectionTimes: any
  scopedSectionTimes: { [name: string]: SectionStat }
  eventCounters: Map<string, Map<string, number>>
  stackHeight: number
  netInternalStackHeight: number
  netExternalStackHeight: number
  statisticsInstance: any

  constructor() {
    this.sectionTimes = {}
    this.scopedSectionTimes = {}
    this.eventCounters = new Map()
    this.stackHeight = 0
    this.netInternalStackHeight = 0
    this.netExternalStackHeight = 0
    this.statisticsInstance = null
    profilerInstance = this

    this.profileSectionStart('_total', true)
    this.profileSectionStart('_internal_total', true)
  }

  setStatisticsInstance(statistics) {
    this.statisticsInstance = statistics
  }

  registerEndpoints() {
    Context.network.registerExternalGet('perf', isDebugModeMiddleware, (req, res) => {
      let result = this.printAndClearReport(1)
      //res.json({result })

      res.write(result)
      res.end()
    })

    Context.network.registerExternalGet('perf-scoped', isDebugModeMiddleware, (req, res) => {
      let result = this.printAndClearScopedReport(1)
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
      this.clearScopedTimes()

      if (this.statisticsInstance) this.statisticsInstance.clearRing('txProcessed')

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
      let toMB = 1 / 1000000
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

      if (this.statisticsInstance) {
        const injectedTpsReport = this.statisticsInstance.getMultiStatReport('txInjected')
        res.write('\n=> Node Injected TPS')
        res.write(`\n Avg: ${injectedTpsReport.avg} `)
        res.write(`\n Max: ${injectedTpsReport.max} `)
        res.write(`\n Vals: ${injectedTpsReport.allVals} \n`)
        this.statisticsInstance.clearRing('txInjected')

        const processedTpsReport = this.statisticsInstance.getMultiStatReport('txApplied')
        res.write('\n=> Node Applied TPS')
        res.write(`\n Avg: ${processedTpsReport.avg} `)
        res.write(`\n Max: ${processedTpsReport.max} `)
        res.write(`\n Vals: ${processedTpsReport.allVals} \n`)
        this.statisticsInstance.clearRing('txApplied')

        const rejectedTpsReport = this.statisticsInstance.getMultiStatReport('txRejected')
        res.write('\n=> Node Rejected TPS')
        res.write(`\n Avg: ${rejectedTpsReport.avg} `)
        res.write(`\n Max: ${rejectedTpsReport.max} `)
        res.write(`\n Vals: ${rejectedTpsReport.allVals} \n`)
        this.statisticsInstance.clearRing('txRejected')

        const networkTimeoutReport = this.statisticsInstance.getMultiStatReport('networkTimeout')
        res.write('\n=> Network Timeout / sec ')
        res.write(`\n Avg: ${networkTimeoutReport.avg} `)
        res.write(`\n Max: ${networkTimeoutReport.max} `)
        res.write(`\n Vals: ${networkTimeoutReport.allVals} \n`)
        this.statisticsInstance.clearRing('networkTimeout')

        const lostNodeTimeoutReport = this.statisticsInstance.getMultiStatReport('lostNodeTimeout')
        res.write('\n=> LostNode Timeout / sec ')
        res.write(`\n Avg: ${lostNodeTimeoutReport.avg} `)
        res.write(`\n Max: ${lostNodeTimeoutReport.max} `)
        res.write(`\n Vals: ${lostNodeTimeoutReport.allVals} \n`)
        this.statisticsInstance.clearRing('lostNodeTimeout')
      }

      // write "perf" results
      let result = this.printAndClearReport(1)
      res.write(`\n=> PERF RESULTS\n`)
      res.write(result)
      res.write(`\n===========================\n`)

      // write scoped-perf results
      let scopedPerfResult = this.printAndClearScopedReport(1)
      res.write(`\n=> SCOPED PERF RESULTS\n`)
      res.write(scopedPerfResult)
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
      if (profilerSelfReporting) nestedCountersInstance.countEvent('profiler-start-error', sectionName)
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
      if (profilerSelfReporting) nestedCountersInstance.countEvent('profiler-end-error', sectionName)
      return
    }

    section.end = process.hrtime.bigint()

    section.total += section.end - section.start
    section.started = false

    if (internal === false) {
      if (profilerSelfReporting) nestedCountersInstance.countEvent('profiler-end', sectionName)

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

  scopedProfileSectionStart(
    sectionName: string,
    internal: boolean = false,
    messageSize: number = cNoSizeTrack
  ) {
    let section: SectionStat = this.scopedSectionTimes[sectionName]

    if (section != null && section.started === true) {
      //need thes because we cant handle recursion, but does it ever happen?
      //could be interesting to track.
      section.reentryCount++
      section.reentryCountEver++
      return
    }

    if (section == null) {
      const t = BigInt(0)
      const max = BigInt(0)
      const min = cDefaultMinBig
      const avg = BigInt(0)
      section = {
        name: sectionName,
        total: t,
        max,
        min,
        avg,
        c: 0,
        internal,
        req: {
          total: 0,
          max: 0,
          min: cDefaultMin,
          avg: 0,
          c: 0,
        },
        resp: {
          total: 0,
          max: 0,
          min: cDefaultMin,
          avg: 0,
          c: 0,
        },
        start: t,
        end: t,
        started: false,
        reentryCount: 0,
        reentryCountEver: 0,
      }
      this.scopedSectionTimes[sectionName] = section
    }

    // update request size stats
    if (messageSize != cNoSizeTrack && messageSize != cUninitializedSize) {
      let stat = section.req
      stat.total += messageSize
      stat.c += 1
      if (messageSize > stat.max) stat.max = messageSize
      if (messageSize < stat.min) stat.min = messageSize
      stat.avg = stat.total / stat.c
    }

    section.start = process.hrtime.bigint()
    section.started = true
    section.c++
  }

  scopedProfileSectionEnd(sectionName: string, messageSize: number = cNoSizeTrack) {
    const section = this.scopedSectionTimes[sectionName]
    if (section == null || section.started === false) {
      if (profilerSelfReporting) return
    }

    section.end = process.hrtime.bigint()

    const duration = section.end - section.start
    section.total += duration
    section.c += 1
    if (duration > section.max) section.max = duration
    if (duration < section.min) section.min = duration
    section.avg = section.total / BigInt(section.c)
    section.started = false

    //if we get a valid size let track stats on it
    if (messageSize != cNoSizeTrack && messageSize != cUninitializedSize) {
      let stat = section.resp
      stat.total += messageSize
      stat.c += 1
      if (messageSize > stat.max) stat.max = messageSize
      if (messageSize < stat.min) stat.min = messageSize
      stat.avg = stat.total / stat.c
    }
  }

  cleanInt(x) {
    x = Number(x)
    return x >= 0 ? Math.floor(x) : Math.ceil(x)
  }

  getTotalBusyInternal(): any {
    if (profilerSelfReporting) nestedCountersInstance.countEvent('profiler-note', 'getTotalBusyInternal')

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
        netInternlDuty = (BigInt(100) * internalNetInternl.total) / internalTotal.total
      }
    }
    if (internalNetExternl != null && internalTotal != null) {
      if (internalTotal.total > BigInt(0)) {
        netExternlDuty = (BigInt(100) * internalNetExternl.total) / internalTotal.total
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
  clearScopedTimes() {
    for (let key in this.scopedSectionTimes) {
      if (this.scopedSectionTimes.hasOwnProperty(key)) {
        let section = this.scopedSectionTimes[key]
        section.total = BigInt(0)
        section.max = BigInt(0)
        section.min = cDefaultMinBig
        section.avg = BigInt(0)
        section.c = 0

        section.reentryCount = 0
        section.req = {
          total: 0,
          max: 0,
          min: cDefaultMin,
          avg: 0,
          c: 0,
        }
        section.resp = {
          total: 0,
          max: 0,
          min: cDefaultMin,
          avg: 0,
          c: 0,
        }
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
    //console.log('totalSection from printAndClearReport', totalSection)

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
        let line = `${dutyStr}% ${section.name.padEnd(30)}, ${totalStr}ms, #:${section.c}`
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

  printAndClearScopedReport(delta?: number): string {
    let result = 'Scoped Profile Sections:\n'
    let d1 = this.cleanInt(1e6) // will get us ms
    let divider = BigInt(d1)

    let lines = []
    for (let key in this.scopedSectionTimes) {
      if (this.scopedSectionTimes.hasOwnProperty(key)) {
        let section = this.scopedSectionTimes[key]
        const percent = BigInt(100)
        const avgMs = Number((section.avg * percent) / divider) / 100
        const maxMs = Number((section.max * percent) / divider) / 100
        let minMs = Number((section.min * percent) / divider) / 100
        const totalMs = Number((section.total * percent) / divider) / 100
        if (section.c === 0) {
          minMs = 0
        }
        let line = `Avg: ${avgMs}ms ${section.name.padEnd(
          30
        )}, Max: ${maxMs}ms,  Min: ${minMs}ms,  Total: ${totalMs}ms, #:${section.c}`

        if (section.resp.c > 0) {
          let dataReport = {
            total: humanFileSize(section.resp.total),
            min: humanFileSize(section.resp.min),
            max: humanFileSize(section.resp.max),
            c: section.resp.c,
            avg: humanFileSize(Math.ceil(section.resp.total / section.resp.c)), //Math.round(100 * section.s.total / section.s.c) / 100
          }
          line += ' resp:' + JSON.stringify(dataReport)
        }
        let numberStat = section.req
        if (numberStat.c > 0) {
          let dataReport = {
            total: humanFileSize(numberStat.total),
            min: humanFileSize(numberStat.min),
            max: humanFileSize(numberStat.max),
            c: numberStat.c,
            avg: humanFileSize(Math.ceil(numberStat.total / numberStat.c)), //Math.round(100 * section.s.total / section.s.c) / 100
          }
          line += ' req:' + JSON.stringify(dataReport)
        }

        lines.push({ line, avgMs })
      }
    }
    lines.sort((l1, l2) => Number(l2.avgMs - l1.avgMs))
    result = result + lines.map((line) => line.line).join('\n')

    this.clearScopedTimes()
    return result
  }

  scopedTimesDataReport(): any {
    let d1 = this.cleanInt(1e6) // will get us ms
    let divider = BigInt(d1)

    let times = []
    for (let key in this.scopedSectionTimes) {
      if (this.scopedSectionTimes.hasOwnProperty(key)) {
        let section = this.scopedSectionTimes[key]
        const percent = BigInt(100)
        const avgMs = Number((section.avg * percent) / divider) / 100
        const maxMs = Number((section.max * percent) / divider) / 100
        let minMs = Number((section.min * percent) / divider) / 100
        const totalMs = Number((section.total * percent) / divider) / 100
        if (section.c === 0) {
          minMs = 0
        }
        let data = {}
        let dataReq = {}
        if (section.resp.c > 0) {
          let dataReport = {
            total: section.resp.total,
            min: section.resp.min,
            max: section.resp.max,
            c: section.resp.c,
            avg: humanFileSize(Math.ceil(section.resp.total / section.resp.c)), //Math.round(100 * section.s.total / section.s.c) / 100
          }
          data = dataReport
        }
        let numberStat = section.req
        if (numberStat.c > 0) {
          let dataReport = {
            total: humanFileSize(numberStat.total),
            min: humanFileSize(numberStat.min),
            max: humanFileSize(numberStat.max),
            c: numberStat.c,
            avg: humanFileSize(Math.ceil(numberStat.total / numberStat.c)), //Math.round(100 * section.s.total / section.s.c) / 100
          }
          dataReq = dataReport
        }

        times.push({ name: section.name, minMs, maxMs, totalMs, avgMs, c: section.c, data, dataReq })
      }
    }
    let scopedTimes = { scopedTimes: times }
    return scopedTimes
  }
}

export default Profiler
