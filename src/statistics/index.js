const path = require('path')
const fs = require('fs')
const { Readable } = require('stream')

class Statistics {
  constructor (baseDir, config, { counters = [], watchers = {} }) {
    this.interval = config.interval * 1000
    this.timer = null
    this.watchers = {}
    for (const name in watchers) {
      const watchFn = watchers[name]
      this.watchers[name] = new WatcherRing(60, watchFn)
    }
    this.counters = {}
    for (const name of counters) {
      this.counters[name] = new CounterRing(60)
    }
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

  // Increments the given CounterRing's count
  incrementCounter (counterName) {
    const counter = this.counters[counterName]
    if (!counter) throw new Error(`Counter '${counterName}' is undefined.`)
    counter.increment()
  }

  // Returns the current count of the given CounterRing
  getCurrentCount (counterName) {
    const counter = this.counters[counterName]
    if (!counter) throw new Error(`Counter '${counterName}' is undefined.`)
    return counter.count
  }

  // Returns the current total of the given CounterRing
  getCounterTotal (counterName) {
    const counter = this.counters[counterName]
    if (!counter) throw new Error(`Counter '${counterName}' is undefined.`)
    return counter.total
  }

  // Returns the result of the given WatcherRings watchFn
  getWatcherValue (watcherName) {
    const watcher = this.watchers[watcherName]
    if (!watcher) throw new Error(`Watcher '${watcherName}' is undefined.`)
    return watcher.watchFn()
  }

  // Returns the current average of all elements in the given WatcherRing or CounterRing
  getAverage (name) {
    const ringHolder = this.counters[name] || this.watchers[name]
    if (!ringHolder.ring) throw new Error(`Ring holder '${name}' is undefined.`)
    return ringHolder.ring.average()
  }

  // Returns the value of the last element of the given WatcherRing or CounterRing
  getPreviousElement (name) {
    const ringHolder = this.counters[name] || this.watchers[name]
    if (!ringHolder.ring) throw new Error(`Ring holder '${name}' is undefined.`)
    return ringHolder.ring.previous()
  }

  _takeSnapshot () {
    const time = new Date().toISOString()
    let tabSeperatedValues = ''

    for (const counter in this.counters) {
      this.counters[counter].snapshot()
      tabSeperatedValues += `${counter}-total\t${this.getCounterTotal(counter)}\t${time}\n`
      tabSeperatedValues += `${counter}-average\t${this.getAverage(counter)}\t${time}\n`
      tabSeperatedValues += `${counter}-previous\t${this.getPreviousElement(counter)}\t${time}\n`
    }
    for (const watcher in this.watchers) {
      this.watchers[watcher].snapshot()
      tabSeperatedValues += `${watcher}-value\t${this.getWatcherValue(watcher)}\t${time}\n`
      tabSeperatedValues += `${watcher}-average\t${this.getAverage(watcher)}\t${time}\n`
      tabSeperatedValues += `${watcher}-previous\t${this.getPreviousElement(watcher)}\t${time}\n`
    }

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
    this.total = 0
    this.ring = new Ring(length)
  }
  increment () {
    ++this.count
    ++this.total
  }
  snapshot () {
    this.ring.save(this.count)
    this.count = 0
  }
}

class WatcherRing {
  constructor (length, watchFn) {
    this.watchFn = watchFn
    this.ring = new Ring(length)
  }
  snapshot () {
    this.ring.save(this.watchFn())
  }
}

module.exports = Statistics
