const path = require('path')
const fs = require('fs')
const { Readable } = require('stream')

class Statistics {
  constructor (baseDir, config, acceptedTxQueue, { counterNames = [] }) {
    this.interval = config.interval * 1000
    this.timer = null
    this.acceptedTxQueue = acceptedTxQueue
    this.counters = {}
    for (const name of counterNames) {
      this.counters[name] = new CounterRing(60)
    }
    this.queueLengthRing = new Ring(60)
    this.stream = null
    this.streamIsPushable = false
    if (config.save) {
      // Pipe stream to file
      const file = path.join(baseDir, 'statistics.tsv')
      const fileWriteStream = fs.createWriteStream(file)
      const statsReadStream = this.getStream()
      statsReadStream.pipe(fileWriteStream)
    }
  }

  getStream () {
    this.stream = new Readable()
    this.stream._read = () => { this.streamIsPushable = true }
    return this.stream
  }

  startSnapshots () {
    const tabSeperatedHeaders = 'Name\tValue\tTime\n'
    this._pushToStream(tabSeperatedHeaders)
    if (!this.timer) this.timer = setInterval(this._takeSnapshot.bind(this), this.interval)
  }

  stopSnapshots () {
    clearInterval(this.timer)
    this.timer = null
  }

  increment (name) {
    this.counters[name].increment()
  }

  count (name) {
    return this.counters[name].count
  }

  average (name) {
    return this.counters[name].ring.average()
  }

  previous (name) {
    return this.counters[name].ring.previous()
  }

  averageQueueLength () {
    return this.queueLengthRing.average()
  }

  _takeSnapshot () {
    const time = Date.now()
    let tabSeperatedValues = ''

    for (const name in this.counters) {
      this.counters[name].snapshot()
      tabSeperatedValues += `${name}-count\t${this.count(name)}\t${time}\n`
      tabSeperatedValues += `${name}-average\t${this.average(name)}\t${time}\n`
      tabSeperatedValues += `${name}-previous\t${this.previous(name)}\t${time}\n`
    }
    this.queueLengthRing.save(this.acceptedTxQueue.length)
    tabSeperatedValues += `queueLength-average\t${this.averageQueueLength()}\t${time}\n`
    tabSeperatedValues += `queueLength-previous\t${this.averageQueueLength()}\t${time}\n`

    this._pushToStream(tabSeperatedValues)
  }

  _pushToStream (data) {
    if (this.stream && this.streamIsPushable) {
      this.streamIsPushable = this.stream.push(data)
    }
  }
}

class Ring {
  constructor (length) {
    this.elements = new Array(length)
    this.index = 0
  }
  save (value) {
    this.elements[this.index] = value
    this.index = ++this.index % this.elements.length
  }
  average () {
    let sum = 0
    let total = 0
    for (const element of this.elements) {
      if (element) {
        sum += element
        total++
      }
    }
    return total > 0 ? sum / total : 0
  }
  previous () {
    const prevIndex = (this.index < 1 ? this.elements.length : this.index) - 1
    return this.elements[prevIndex] || 0
  }
}

class CounterRing {
  constructor (length) {
    this.count = 0
    this.ring = new Ring(length)
  }
  increment () {
    ++this.count
  }
  snapshot () {
    this.ring.save(this.count)
    this.count = 0
  }
}

module.exports = Statistics
