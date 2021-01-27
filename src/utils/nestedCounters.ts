const NS_PER_SEC = 1e9

import { Utils } from 'sequelize/types'
import * as Context from '../p2p/Context'
import * as utils from '../utils'
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

  constructor() {
    // this.sectionTimes = {}
    this.eventCounters = new Map()
    nestedCountersInstance = this
  }

  registerEndpoints() {
    Context.network.registerExternalGet('counts', (req, res) => {

        // let counterMap = utils.deepCopy(this.eventCounters)
        let arrayReport = this.arrayitizeAndSort(this.eventCounters)

        // let reportPath = path.join(scanner.instanceDir, 'histogram.txt')
        // let stream = fs.createWriteStream(reportPath, {
        //   flags: 'w'
        // })
        
        this.printArrayReport(arrayReport, res, 0)
        res.end()

      //res.json(utils.stringifyReduce(this.eventCounters))
    })
  }

  countEvent(category1: string, category2: string) {
    let counterMap:CounterMap = this.eventCounters

    let nextNode:CounterNode = null
    if (counterMap.has(category1) === false) {
      nextNode = { count: 0, subCounters: new Map()}
      counterMap.set(category1, nextNode)
    } else {
      nextNode = counterMap.get(category1)
    }
    nextNode.count++
    counterMap = nextNode.subCounters

    //unrolled loop to avoid memory alloc
    category1 = category2
    if (counterMap.has(category1) === false) {
        nextNode = { count: 0, subCounters: new Map()}
        counterMap.set(category1, nextNode)
      } else {
        nextNode = counterMap.get(category1)
      }
      nextNode.count++
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
      stream.write(
        `${indentText}${key}\tcount:\t${count}\n`
      )

      if (subArray != null && subArray.length > 0) {
        this.printArrayReport(subArray, stream, indent + 1)
      }
    }
  }
}

export default NestedCounters
