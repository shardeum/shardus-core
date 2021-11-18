import { profilerInstance } from './profiler'

const NS_PER_SEC = 1e9

import { Utils } from 'sequelize/types'
import * as Context from '../p2p/Context'
import * as utils from '../utils'
import Crypto from "../crypto"
import { isDebugModeMiddleware } from '../network/debugMiddleware'

// process.hrtime.bigint()

interface NestedCounters {}

type CounterMap = Map<string, CounterNode>
interface CounterNode {
    count: number
    subCounters: CounterMap

}

export let nestedCountersInstance: NestedCounters

class NestedCounters {
  eventCounters: Map<string, CounterNode>
  rareEventCounters: Map<string, CounterNode>
  crypto: Crypto
  infLoopDebug: boolean

  constructor() {
    // this.sectionTimes = {}
    this.eventCounters = new Map()
    this.rareEventCounters = new Map()
    this.crypto = null
    nestedCountersInstance = this
    this.infLoopDebug = false

  }

  registerEndpoints() {
    Context.network.registerExternalGet('counts', isDebugModeMiddleware, (req, res) => {

      profilerInstance.scopedProfileSectionStart('counts')
        // let counterMap = utils.deepCopy(this.eventCounters)
        let arrayReport = this.arrayitizeAndSort(this.eventCounters)

        // let reportPath = path.join(scanner.instanceDir, 'histogram.txt')
        // let stream = fs.createWriteStream(reportPath, {
        //   flags: 'w'
        // })

        res.write(`${Date.now()}\n`)

        this.printArrayReport(arrayReport, res, 0)
        res.end()
      profilerInstance.scopedProfileSectionEnd('counts')

      //res.json(utils.stringifyReduce(this.eventCounters))
    })
    Context.network.registerExternalGet('counts-reset', isDebugModeMiddleware, (req, res) => {

      this.eventCounters = new Map()
      res.write(`counts reset ${Date.now()}`)
      res.end()

  })
    Context.network.registerExternalGet('rare-counts-reset', isDebugModeMiddleware, (req, res) => {
      this.rareEventCounters = new Map()
      res.write(`Rare counts reset ${Date.now()}`)
      res.end()
    })

    Context.network.registerExternalGet('debug-inf-loop', isDebugModeMiddleware, (req, res) => {
        res.write('starting inf loop, goodbye')
        res.end()
        let counter = 1
        this.infLoopDebug = true
        while(this.infLoopDebug) {
            let s = "asdf"
            let s2 = utils.stringifyReduce({test:[s,s,s,s,s,s,s]})
            let s3 = utils.stringifyReduce({test:[s2,s2,s2,s2,s2,s2,s2]})
            if(this.crypto != null){
                this.crypto.hash(s3)
            }
            counter++
        }

    })

    Context.network.registerExternalGet('debug-inf-loop-off', isDebugModeMiddleware, (req, res) => {
        this.infLoopDebug = false
        res.write('stopping inf loop, who knows if this is possible')
        res.end()
    })

  }

  countEvent(category1: string, category2: string, count:number = 1) {
    let counterMap:CounterMap = this.eventCounters

    let nextNode:CounterNode = null
    if (counterMap.has(category1) === false) {
      nextNode = { count: 0, subCounters: new Map()}
      counterMap.set(category1, nextNode)
    } else {
      nextNode = counterMap.get(category1)
    }
    nextNode.count += count
    counterMap = nextNode.subCounters

    //unrolled loop to avoid memory alloc
    category1 = category2
    if (counterMap.has(category1) === false) {
        nextNode = { count: 0, subCounters: new Map()}
        counterMap.set(category1, nextNode)
      } else {
        nextNode = counterMap.get(category1)
      }
      nextNode.count += count
      counterMap = nextNode.subCounters
  }

  countRareEvent(category1: string, category2: string, count:number = 1) {
    // trigger normal event counter
    this.countEvent(category1, category2, count)

    // start counting rare event
    let counterMap: CounterMap = this.rareEventCounters

    let nextNode:CounterNode = null
    if (counterMap.has(category1) === false) {
      nextNode = { count: 0, subCounters: new Map()}
      counterMap.set(category1, nextNode)
    } else {
      nextNode = counterMap.get(category1)
    }
    nextNode.count += count
    counterMap = nextNode.subCounters

    //unrolled loop to avoid memory alloc
    category1 = category2
    if (counterMap.has(category1) === false) {
      nextNode = { count: 0, subCounters: new Map() }
      counterMap.set(category1, nextNode)
    } else {
      nextNode = counterMap.get(category1)
    }
    nextNode.count += count
    counterMap = nextNode.subCounters
  }

  arrayitizeAndSort(counterMap) {
    let array = []
    for (let key of counterMap.keys()) {
      let valueObj = counterMap.get(key)

      let newValueObj = {key, count: valueObj.count, subArray: null}
      // newValueObj.key = key
      array.push(newValueObj)

      let subArray = []
      if (valueObj.subCounters != null) {
        subArray = this.arrayitizeAndSort(valueObj.subCounters)
      }

      // if (valueObj.count != null && valueObj.logLen != null) {
      //   valueObj.avgLen = valueObj.logLen / valueObj.count
      // }

      newValueObj.subArray = subArray
      // delete valueObj['subCounters']
    }

    array.sort((a, b) => b.count - a.count)
    return array
  }

  printArrayReport(arrayReport, stream, indent = 0) {
    let indentText = '___'.repeat(indent)
    for (let item of arrayReport) {
      let { key, count, subArray, avgLen, logLen } = item
      let countStr = `${count}`
      stream.write(
        //`${indentText}${key.padEnd(40)}\tcount:\t${countStr}\n`
        `${countStr.padStart(10)} ${indentText} ${key}\n`
      )

      if (subArray != null && subArray.length > 0) {
        this.printArrayReport(subArray, stream, indent + 1)
      }
    }
  }

  resetCounters(){
    this.eventCounters = new Map()
  }
  resetRareCounters(){
    this.rareEventCounters = new Map()
  }
}

export default NestedCounters
