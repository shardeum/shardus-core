const NS_PER_SEC = 1e9

import { Utils } from 'sequelize/types';
import * as Context from '../p2p/Context'
import * as utils from '../utils'
import { nestedCountersInstance } from '../utils/nestedCounters'
// process.hrtime.bigint()
import {logFlags} from '../logger'

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
  sectionTimes: any;
  eventCounters: Map<string, Map<string,number>>;
  stackHeight: number;
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

  registerEndpoints (){
    Context.network.registerExternalGet('perf', (req, res) => {
      let result = this.printAndClearReport(1)
      //res.json({result })

      res.write(result)
      res.end()
    })
  }

  profileSectionStart(sectionName, internal = false) {
    let section = this.sectionTimes[sectionName]

    if (section != null && section.started === true) {

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

    if(internal === false){
      nestedCountersInstance.countEvent('profiler', sectionName)

      this.stackHeight++
      if(this.stackHeight === 1){
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

      nestedCountersInstance.countEvent('profiler-end-error', sectionName)
      return
    }

    section.end = process.hrtime.bigint()

    section.total += section.end - section.start
    section.started = false

    if(internal === false){
      nestedCountersInstance.countEvent('profiler-end', sectionName)

      this.stackHeight--
      if(this.stackHeight === 0){
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

  getTotalBusyInternal() : any {
    nestedCountersInstance.countEvent('profiler-note', 'getTotalBusyInternal')

    this.profileSectionEnd('_internal_total', true)
    let internalTotalBusy = this.sectionTimes['_internal_totalBusy']
    let internalTotal = this.sectionTimes['_internal_total']
    let internalNetInternl = this.sectionTimes['_internal_net-internl']
    let internalNetExternl = this.sectionTimes['_internal_net-externl']
    let duty = BigInt(0)
    let netInternlDuty = BigInt(0)
    let netExternlDuty = BigInt(0)
    if(internalTotalBusy != null && internalTotal != null ) {
      if(internalTotal.total > BigInt(0)){
        duty = (BigInt(100) * internalTotalBusy.total) / internalTotal.total
      }
    }
    if(internalNetInternl != null && internalTotal != null ) {
      if(internalTotal.total > BigInt(0)){
        netInternlDuty = (BigInt(100) * internalNetInternl.total) / internalTotal.total
      }
    }
    if(internalNetExternl != null && internalTotal != null ) {
      if(internalTotal.total > BigInt(0)){
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

  clearTimes(){
    for (let key in this.sectionTimes) {
      if(utils.isStartWith(key, '_internal')) continue

      if (this.sectionTimes.hasOwnProperty(key)) {
        let section = this.sectionTimes[key]
        section.total = BigInt(0)
      }
    }
  }

  printAndClearReport(delta?: number) : string {
    this.profileSectionEnd('_total', true)

    let result = 'Profile Sections:\n'
    let d1 = this.cleanInt(1e6) // will get us ms
    let divider = BigInt(d1)

    let totalSection = this.sectionTimes['_total']
    let totalBusySection = this.sectionTimes['_totalBusy']
    console.log("totalSection from printAndClearReport", totalSection)

    let lines = []
    for (let key in this.sectionTimes) {
      if(utils.isStartWith(key, '_internal')) continue

      if (this.sectionTimes.hasOwnProperty(key)) {
        let section = this.sectionTimes[key]
        
        // result += `${section.name}: total ${section.total /
        //   divider} avg:${section.total / (divider * BigInt(section.c))} ,  ` // ${section.total} :

        let duty = BigInt(0)
        if(totalSection.total > BigInt(0)){
          duty = (BigInt(100) * section.total) / totalSection.total
        }
        let totalMs = section.total / divider
        let dutyStr = `${duty}`.padStart(4)
        let totalStr = `${totalMs}`.padStart(13)
        let line = `${dutyStr}% ${section.name.padEnd(30)}, ${totalStr}ms, #:${section.c}`
        //section.total = BigInt(0)

        lines.push({line, totalMs})
      }
    }

    lines.sort((l1,l2) =>  Number(l2.totalMs - l1.totalMs))

    result = result + lines.map((line)=> line.line).join('\n')

    this.clearTimes()

    this.profileSectionStart('_total', true)
    return result
  }


}



export default Profiler
