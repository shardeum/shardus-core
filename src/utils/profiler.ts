import * as Self from '../p2p/Self'
import Statistics from '../statistics'
import * as Context from '../p2p/Context'

import { sleep } from '../utils/functions/time'
import { humanFileSize } from '.'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { isDebugModeMiddleware, isDebugModeMiddlewareLow } from '../network/debugMiddleware'
import { memoryReportingInstance } from '../utils/memoryReporting'
import { shardusGetTime, getNetworkTimeOffset } from '../network'

const cDefaultMin = 1e12
const cDefaultMinBig = BigInt(cDefaultMin)

const profilerSelfReporting = false

interface Profiler {
  sectionTimes: { [name: string]: SectionStat }
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

type TimesDataReport = {
  name: string
  minMs: number
  maxMs: number
  totalMs: number
  avgMs: number
  c: number
  data: NumberStat | Record<string, unknown>
  dataReq: NumberStat | Record<string, unknown>
}

type ScopedTimesDataReport = {
  scopedTimes: TimesDataReport[]
  cycle?: number
  node?: string
  id?: string
}

export interface NodeLoad {
  internal: number
  external: number
}

export let profilerInstance: Profiler
class Profiler {
  sectionTimes: { [name: string]: SectionStat }
  scopedSectionTimes: { [name: string]: SectionStat }
  eventCounters: Map<string, Map<string, number>>
  stackHeight: number
  netInternalStackHeight: number
  netExternalStackHeight: number
  statisticsInstance: Statistics

  constructor() {
    this.sectionTimes = {}
    this.scopedSectionTimes = {}
    this.eventCounters = new Map()
    this.stackHeight = 0
    this.netInternalStackHeight = 0
    this.netExternalStackHeight = 0
    this.statisticsInstance = null
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    profilerInstance = this

    this.profileSectionStart('_total', true)
    this.profileSectionStart('_internal_total', true)
  }

  setStatisticsInstance(statistics: Statistics): void {
    this.statisticsInstance = statistics
  }

  registerEndpoints(): void {
    Context.network.registerExternalGet('perf', isDebugModeMiddleware, (req, res) => {
      const result = this.printAndClearReport()
      //res.json({result })

      res.write(result)
      res.end()
    })

    Context.network.registerExternalGet('perf-scoped', isDebugModeMiddleware, (req, res) => {
      const result = this.printAndClearScopedReport()
      //res.json({result })

      res.write(result)
      res.end()
    })

    Context.network.registerExternalGet('combined-debug', isDebugModeMiddlewareLow, async (req, res) => {
      const waitTime = Number.parseInt(req.query.wait as string, 10) || 60

      // hit "counts-reset" endpoint
      this.eventCounters = new Map()
      res.write(`counts reset at ${new Date()}\n`)

      // hit "perf" endpoint to clear perf stats
      this.printAndClearReport()
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
      const toMB = 1 / 1000000
      const report = process.memoryUsage()
      res.write(`\n=> MEMORY RESULTS\n`)
      res.write(`System Memory Report.  Timestamp: ${shardusGetTime()} offset: ${getNetworkTimeOffset()} \n`)
      res.write(`rss: ${(report.rss * toMB).toFixed(2)} MB\n`)
      res.write(`heapTotal: ${(report.heapTotal * toMB).toFixed(2)} MB\n`)
      res.write(`heapUsed: ${(report.heapUsed * toMB).toFixed(2)} MB\n`)
      res.write(`external: ${(report.external * toMB).toFixed(2)} MB\n`)
      res.write(`arrayBuffers: ${(report.arrayBuffers * toMB).toFixed(2)} MB\n\n\n`)
      memoryReportingInstance.gatherReport()
      memoryReportingInstance.reportToStream(memoryReportingInstance.report, res)

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
      const result = this.printAndClearReport()
      res.write(`\n=> PERF RESULTS\n`)
      res.write(result)
      res.write(`\n===========================\n`)

      // write scoped-perf results
      const scopedPerfResult = this.printAndClearScopedReport()
      res.write(`\n=> SCOPED PERF RESULTS\n`)
      res.write(scopedPerfResult)
      res.write(`\n===========================\n`)

      // write "counts" results
      const arrayReport = nestedCountersInstance.arrayitizeAndSort(nestedCountersInstance.eventCounters)
      res.write(`\n=> COUNTS RESULTS\n`)
      res.write(`${shardusGetTime()}\n`)
      nestedCountersInstance.printArrayReport(arrayReport, res, 0)
      res.write(`\n===========================\n`)

      res.end()
    })
  }

  profileSectionStart(sectionName: string, internal = false): void {
    // eslint-disable-next-line security/detect-object-injection
    let section = this.sectionTimes[sectionName]

    if (section != null && section.started === true) {
      if (profilerSelfReporting) nestedCountersInstance.countEvent('profiler-start-error', sectionName)
      return
    }

    if (section == null) {
      const t = BigInt(0)
      // The type assertion used below is done because we know that the remaining fields of SectionStat will be added to the section variable as the execution progresses.
      section = { name: sectionName, total: t, c: 0, internal } as SectionStat
      // eslint-disable-next-line security/detect-object-injection
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

  profileSectionEnd(sectionName: string, internal = false): void {
    // eslint-disable-next-line security/detect-object-injection
    const section: SectionStat = this.sectionTimes[sectionName]
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

  scopedProfileSectionStart(sectionName: string, internal = false, messageSize: number = cNoSizeTrack): void {
    // eslint-disable-next-line security/detect-object-injection
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
      // eslint-disable-next-line security/detect-object-injection
      this.scopedSectionTimes[sectionName] = section
    }

    // update request size stats
    if (messageSize != cNoSizeTrack && messageSize != cUninitializedSize) {
      const stat = section.req
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

  scopedProfileSectionEnd(sectionName: string, messageSize: number = cNoSizeTrack): void {
    // eslint-disable-next-line security/detect-object-injection
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
      const stat = section.resp
      stat.total += messageSize
      stat.c += 1
      if (messageSize > stat.max) stat.max = messageSize
      if (messageSize < stat.min) stat.min = messageSize
      stat.avg = stat.total / stat.c
    }
  }

  cleanInt(x: number): number {
    x = Number(x)
    return x >= 0 ? Math.floor(x) : Math.ceil(x)
  }

  getTotalBusyInternal(): { duty: number; netInternlDuty: number; netExternlDuty: number } {
    if (profilerSelfReporting) nestedCountersInstance.countEvent('profiler-note', 'getTotalBusyInternal')

    this.profileSectionEnd('_internal_total', true)
    const internalTotalBusy = this.sectionTimes['_internal_totalBusy']
    const internalTotal = this.sectionTimes['_internal_total']
    const internalNetInternl = this.sectionTimes['_internal_net-internl']
    const internalNetExternl = this.sectionTimes['_internal_net-externl']
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

  clearTimes(): void {
    for (const key in this.sectionTimes) {
      if (key.startsWith('_internal')) continue

      if (Object.prototype.hasOwnProperty.call(this.sectionTimes, key)) {
        // eslint-disable-next-line security/detect-object-injection
        const section = this.sectionTimes[key]
        section.total = BigInt(0)
        section.c = 0
      }
    }
  }
  clearScopedTimes(): void {
    for (const key in this.scopedSectionTimes) {
      if (Object.prototype.hasOwnProperty.call(this.scopedSectionTimes, key)) {
        // eslint-disable-next-line security/detect-object-injection
        const section = this.scopedSectionTimes[key]
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

  printAndClearReport(): string {
    this.profileSectionEnd('_total', true)
    let result = 'Profile Sections:\n'
    const d1 = this.cleanInt(1e6) // will get us ms
    const divider = BigInt(d1)

    const totalSection = this.sectionTimes['_total']

    const lines = []
    for (const key in this.sectionTimes) {
      if (key.startsWith('_internal')) continue

      if (Object.prototype.hasOwnProperty.call(this.sectionTimes, key)) {
        // eslint-disable-next-line security/detect-object-injection
        const section = this.sectionTimes[key]

        // result += `${section.name}: total ${section.total /
        //   divider} avg:${section.total / (divider * BigInt(section.c))} ,  ` // ${section.total} :

        let duty = BigInt(0)
        if (totalSection.total > BigInt(0)) {
          duty = (BigInt(100) * section.total) / totalSection.total
        }
        const totalMs = section.total / divider
        const dutyStr = `${duty}`.padStart(4)
        const totalStr = `${totalMs}`.padStart(13)
        const line = `${dutyStr}% ${section.name.padEnd(30)}, ${totalStr}ms, #:${section.c}`
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

  printAndClearScopedReport(): string {
    let result = 'Scoped Profile Sections:\n'
    const d1 = this.cleanInt(1e6) // will get us ms
    const divider = BigInt(d1)

    const lines = []
    for (const key in this.scopedSectionTimes) {
      if (Object.prototype.hasOwnProperty.call(this.scopedSectionTimes, key)) {
        // eslint-disable-next-line security/detect-object-injection
        const section = this.scopedSectionTimes[key]
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
          const dataReport = {
            total: humanFileSize(section.resp.total),
            min: humanFileSize(section.resp.min),
            max: humanFileSize(section.resp.max),
            c: section.resp.c,
            avg: humanFileSize(Math.ceil(section.resp.total / section.resp.c)), //Math.round(100 * section.s.total / section.s.c) / 100
          }
          line += ' resp:' + JSON.stringify(dataReport)
        }
        const numberStat = section.req
        if (numberStat.c > 0) {
          const dataReport = {
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

  scopedTimesDataReport(): ScopedTimesDataReport {
    const d1 = this.cleanInt(1e6) // will get us ms
    const divider = BigInt(d1)

    const times: TimesDataReport[] = []
    for (const key in this.scopedSectionTimes) {
      if (Object.prototype.hasOwnProperty.call(this.scopedSectionTimes, key)) {
        // eslint-disable-next-line security/detect-object-injection
        const section = this.scopedSectionTimes[key]
        const percent = BigInt(100)
        const avgMs = Number((section.avg * percent) / divider) / 100
        const maxMs = Number((section.max * percent) / divider) / 100
        let minMs = Number((section.min * percent) / divider) / 100
        const totalMs = Number((section.total * percent) / divider) / 100
        if (section.c === 0) {
          minMs = 0
        }
        let data: NumberStat | Record<string, unknown> = {}
        let dataReq: NumberStat | Record<string, unknown> = {}
        if (section.resp.c > 0) {
          const dataReport = {
            total: section.resp.total,
            min: section.resp.min,
            max: section.resp.max,
            c: section.resp.c,
            avg: humanFileSize(Math.ceil(section.resp.total / section.resp.c)), //Math.round(100 * section.s.total / section.s.c) / 100
          }
          data = dataReport
        }
        const numberStat = section.req
        if (numberStat.c > 0) {
          const dataReport = {
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
    return { scopedTimes: times }
  }
}

export default Profiler
