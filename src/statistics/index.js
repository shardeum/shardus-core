const path = require('path')
const fs = require('fs')
const { Readable } = require('stream')

class Statistics {
  constructor (baseDir, config, { counters = [], watchers = {}, timers = [] }, context) {
    this.intervalDuration = config.interval * 1000
    this.interval = null
    this.counters = {}
    for (const name of counters) {
      this.counters[name] = new CounterRing(60)
    }
    this.watchers = {}
    for (const name in watchers) {
      const watchFn = watchers[name]
      this.watchers[name] = new WatcherRing(60, watchFn, context)
    }
    this.timers = {}
    for (const name of timers) {
      this.timers[name] = new TimerRing(60)
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
    if (!this.interval) this.interval = setInterval(this._takeSnapshot.bind(this), this.intervalDuration)
  }

  stopSnapshots () {
    clearInterval(this.interval)
    this.interval = null
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

  // Starts an entry for the given id in the given TimerRing
  startTimer (timerName, id) {
    const timer = this.timers[timerName]
    if (!timer) throw new Error(`Timer '${timerName}' is undefined.`)
    timer.start(id)
  }

  // Stops an entry for the given id in the given TimerRing
  stopTimer (timerName, id) {
    const timer = this.timers[timerName]
    if (!timer) throw new Error(`Timer '${timerName}' is undefined.`)
    timer.stop(id)
  }

  // Returns the current average of all elements in the given WatcherRing or CounterRing
  getAverage (name) {
    const ringHolder = this.counters[name] || this.watchers[name] || this.timers[name]
    if (!ringHolder.ring) throw new Error(`Ring holder '${name}' is undefined.`)
    return ringHolder.ring.average()
  }

  // Returns the value of the last element of the given WatcherRing or CounterRing
  getPreviousElement (name) {
    const ringHolder = this.counters[name] || this.watchers[name] || this.timers[name]
    if (!ringHolder.ring) throw new Error(`Ring holder '${name}' is undefined.`)
    return ringHolder.ring.previous()
  }

  _takeSnapshot () {
    const time = new Date().toISOString()
    let tabSeperatedValues = ''

    for (const counter in this.counters) {
      this.counters[counter].snapshot()
      tabSeperatedValues += `${counter}-average\t${this.getAverage(counter)}\t${time}\n`
    }
    for (const watcher in this.watchers) {
      this.watchers[watcher].snapshot()
      tabSeperatedValues += `${watcher}-average\t${this.getAverage(watcher)}\t${time}\n`
    }
    for (const timer in this.timers) {
      this.timers[timer].snapshot()
      tabSeperatedValues += `${timer}-average\t${this.getAverage(timer) / 1000}\t${time}\n`
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
  constructor (length, watchFn, context) {
    this.watchFn = watchFn.bind(context)
    this.ring = new Ring(length)
  }
  snapshot () {
    const value = this.watchFn()
    this.ring.save(value)
  }
}

class TimerRing {
  constructor (length) {
    this.ids = {}
    this.avgTimePerItem = new Ring(10)
    this.ring = new Ring(length)
  }
  start (id) {
    if (!this.ids[id]) {
      this.ids[id] = Date.now()
    }
  }
  stop (id) {
    const entry = this.ids[id]
    if (entry) {
      const duration = Date.now() - entry
      this.avgTimePerItem.save(duration)
      delete this.ids[id]
    }
  }
  snapshot () {
    this.ring.save(this.avgTimePerItem.average())
  }
}

module.exports = Statistics
