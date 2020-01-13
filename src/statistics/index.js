const path = require('path')
const fs = require('fs')
const { Readable } = require('stream')
const EventEmitter = require('events')
const utils = require('../utils')

class Statistics extends EventEmitter {
  constructor (baseDir, config, { counters = [], watchers = {}, timers = [] }, context) {
    super()
    this.intervalDuration = config.interval || 1
    this.intervalDuration = this.intervalDuration * 1000
    this.context = context
    this.counterDefs = counters
    this.watcherDefs = watchers
    this.timerDefs = timers
    this.initialize()

    this.interval = null
    this.snapshotWriteFns = []
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

  initialize () {
    this.counters = this._initializeCounters(this.counterDefs)
    this.watchers = this._initializeWatchers(this.watcherDefs, this.context)
    this.timers = this._initializeTimers(this.timerDefs)
  }

  getStream () {
    this.stream = new Readable()
    this.stream._read = () => { this.streamIsPushable = true }
    return this.stream
  }

  writeOnSnapshot (writeFn, context) {
    this.snapshotWriteFns.push(writeFn.bind(context))
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

  // Returns the current average of all elements in the given WatcherRing, CounterRing, or TimerRing
  getAverage (name) {
    const ringHolder = this.counters[name] || this.watchers[name] || this.timers[name]
    if (!ringHolder.ring) throw new Error(`Ring holder '${name}' is undefined.`)
    return ringHolder.ring.average()
  }

  // Returns the value of the last element of the given WatcherRing, CounterRing, or TimerRing
  getPreviousElement (name) {
    const ringHolder = this.counters[name] || this.watchers[name] || this.timers[name]
    if (!ringHolder.ring) throw new Error(`Ring holder '${name}' is undefined.`)
    return ringHolder.ring.previous()
  }

  _initializeCounters (counterDefs = []) {
    const counters = {}
    for (const name of counterDefs) {
      counters[name] = new CounterRing(60)
    }
    return counters
  }

  _initializeWatchers (watcherDefs = {}, context) {
    const watchers = {}
    for (const name in watcherDefs) {
      const watchFn = watcherDefs[name]
      watchers[name] = new WatcherRing(60, watchFn, context)
    }
    return watchers
  }

  _initializeTimers (timerDefs = []) {
    const timers = {}
    for (const name of timerDefs) {
      timers[name] = new TimerRing(60)
    }
    return timers
  }

  _takeSnapshot () {
    const time = new Date().toISOString()
    let tabSeperatedValues = ''

    for (const counter in this.counters) {
      this.counters[counter].snapshot()
      tabSeperatedValues += `${counter}-average\t${this.getAverage(counter)}\t${time}\n`
      tabSeperatedValues += `${counter}-total\t${this.getCounterTotal(counter)}\t${time}\n`
    }
    for (const watcher in this.watchers) {
      this.watchers[watcher].snapshot()
      tabSeperatedValues += `${watcher}-average\t${this.getAverage(watcher)}\t${time}\n`
      tabSeperatedValues += `${watcher}-value\t${this.getWatcherValue(watcher)}\t${time}\n`
    }
    for (const timer in this.timers) {
      this.timers[timer].snapshot()
      tabSeperatedValues += `${timer}-average\t${this.getAverage(timer) / 1000}\t${time}\n`
    }

    for (const writeFn of this.snapshotWriteFns) {
      tabSeperatedValues += writeFn()
    }

    this._pushToStream(tabSeperatedValues)
    this.emit('snapshot')
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
      if (_exists(element)) {
        sum += Number(element)
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
      delete this.ids[id]
    }
  }
  snapshot () {
    // Calc median duration of all entries in ids
    const durations = []
    for (const id in this.ids) {
      const startTime = this.ids[id]
      // console.log('START_TIME ', startTime, 'ID', id)
      const duration = Date.now() - startTime
      utils.insertSorted(durations, duration, (a, b) => a - b)
    }
    const median = utils.computeMedian(durations, false)
    // Save median
    this.ring.save(median)
  }
}

function _exists (thing) {
  return (typeof thing !== 'undefined' && thing !== null)
}

module.exports = Statistics
