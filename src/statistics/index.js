class Statistics {
  constructor (config, acceptedTxQueue, { counterNames = [] }) {
    this.interval = config.interval * 1000
    this.timer = null
    this.acceptedTxQueue = acceptedTxQueue
    this.counters = {}
    for (const name of counterNames) {
      this.counters[name] = new CounterRing(60)
    }
    this.queueLengthRing = new Ring(60)
  }

  startSnapshots () {
    this.timer = setInterval(this._takeSnapshot.bind(this), this.interval)
  }

  stopSnapshots () {
    clearInterval(this.timer)
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

  averageQueueLength () {
    return this.queueLengthRing.average()
  }

  _takeSnapshot () {
    for (const name in this.counters) {
      this.counters[name].snapshot()
    }
    this.queueLengthRing.save(this.acceptedTxQueue.length)
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
