import { profilerInstance } from './profiler'
import * as Context from '../p2p/Context'
import * as utils from '../utils'
import Crypto from '../crypto'
import { isDebugModeMiddleware } from '../network/debugMiddleware'
import { getNetworkTimeOffset, shardusGetTime } from '../network'

type CounterMap = Map<string, CounterNode>
interface CounterNode {
  count: number
  subCounters: CounterMap
}

type CounterArray = {
  key: string
  count: number
  subArray: CounterArray
}[]

class NestedCounters {
  eventCounters: Map<string, CounterNode>
  rareEventCounters: Map<string, CounterNode>
  crypto: Crypto
  infLoopDebug: boolean

  constructor() {
    this.eventCounters = new Map()
    this.rareEventCounters = new Map()
    this.crypto = null
    this.infLoopDebug = false
  }

  registerEndpoints(): void {
    Context.network.registerExternalGet('counts', isDebugModeMiddleware, (req, res) => {
      profilerInstance.scopedProfileSectionStart('counts')

      const arrayReport = this.arrayitizeAndSort(this.eventCounters)

      if (req.headers.accept === 'application/json') {
        // Send JSON response
        res.setHeader('Content-Type', 'application/json')
        res.json({
          timestamp: Date.now(),
          report: arrayReport
        })
      } else {
        // TODO: This doesn't return the counts to the caller
      	res.write(`Counts at time: ${shardusGetTime()} offset: ${getNetworkTimeOffset()}\n`)
        this.printArrayReport(arrayReport, res, 0)
        res.end()
      }
      

      profilerInstance.scopedProfileSectionEnd('counts')
    })

    Context.network.registerExternalGet('counts-reset', isDebugModeMiddleware, (req, res) => {
      this.eventCounters = new Map()
      res.write(`counts reset ${shardusGetTime()} offset: ${getNetworkTimeOffset()}`)
      res.end()
    })

    Context.network.registerExternalGet('rare-counts-reset', isDebugModeMiddleware, (req, res) => {
      this.rareEventCounters = new Map()
      res.write(`Rare counts reset ${shardusGetTime()} offset: ${getNetworkTimeOffset()}`)
      res.end()
    })

    Context.network.registerExternalGet('debug-inf-loop', isDebugModeMiddleware, (req, res) => {
      res.write('starting inf loop, goodbye')
      res.end()
      this.infLoopDebug = true
      while (this.infLoopDebug) {
        const s = 'asdf'
        const s2 = utils.stringifyReduce({ test: [s, s, s, s, s, s, s] })
        const s3 = utils.stringifyReduce({ test: [s2, s2, s2, s2, s2, s2, s2] })
        if (this.crypto != null) {
          this.crypto.hash(s3)
        }
      }
    })

    Context.network.registerExternalGet('debug-inf-loop-off', isDebugModeMiddleware, (req, res) => {
      this.infLoopDebug = false
      res.write('stopping inf loop, who knows if this is possible')
      res.end()
    })
  }

  /**
   * Increments event counter map for a specified category and sub category
   * @param category1 Primary category to be updated
   * @param category2 Sub counter category
   * @param count Amount to increment primary and sub counter by. Defaults to 1
   */
  countEvent(category1: string, category2: string, count = 1): void {
    let counterMap: CounterMap = this.eventCounters

    let nextNode: CounterNode = null
    if (counterMap.has(category1) === false) {
      nextNode = { count: 0, subCounters: new Map() }
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

  /**
   * Increments event counter map and rare event counter map for a specified category and sub category
   * @param category1 Primary category to be updated
   * @param category2 Sub counter category
   * @param count Amount to increment primary and sub counter by. Defaults to 1
   */
  countRareEvent(category1: string, category2: string, count = 1): void {
    // trigger normal event counter
    this.countEvent(category1, category2, count)

    // start counting rare event
    let counterMap: CounterMap = this.rareEventCounters

    let nextNode: CounterNode = null
    if (counterMap.has(category1) === false) {
      nextNode = { count: 0, subCounters: new Map() }
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

  /**
   * Recursively convert the counterMap to an array and sort by the count property
   * @param counterMap
   * @returns sorted array of counts
   */
  arrayitizeAndSort(counterMap: CounterMap): CounterArray {
    const array: CounterArray = []
    for (const key of counterMap.keys()) {
      const valueObj = counterMap.get(key)

      const newValueObj = { key, count: valueObj.count, subArray: null }
      array.push(newValueObj)

      let subArray: CounterArray = []
      if (valueObj.subCounters != null) {
        subArray = this.arrayitizeAndSort(valueObj.subCounters)
      }

      newValueObj.subArray = subArray
    }

    array.sort((a, b) => b.count - a.count)
    return array
  }

  /**
   * Generates a formatted response and recursively prints it to the response stream
   * @param arrayReport
   * @param stream
   * @param indent
   */
  printArrayReport(arrayReport: CounterArray, stream, indent = 0): void {
    const indentText = '___'.repeat(indent)
    for (const item of arrayReport) {
      const { key, count, subArray } = item
      const countStr = `${count}`
      stream.write(`${countStr.padStart(10)} ${indentText} ${key}\n`)

      if (subArray != null && subArray.length > 0) {
        this.printArrayReport(subArray, stream, indent + 1)
      }
    }
  }

  resetCounters(): void {
    this.eventCounters = new Map()
  }

  resetRareCounters(): void {
    this.rareEventCounters = new Map()
  }
}

export const nestedCountersInstance = new NestedCounters()
export default NestedCounters
