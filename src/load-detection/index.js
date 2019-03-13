class LoadDetection {
  constructor (config, statistics) {
    this.statistics = statistics
    this.desiredTxTime = config.desiredTxTime
    this.limitRate = config.limitRate
    this.loadLimit = config.loadLimit
    this.queueLimit = config.queueLimit
  }

  /**
   * Returns a number between 0 and 1 indicating the current load.
   */
  getCurrentLoad () {
    const txTimeInQueue = this.statistics.getAvgTimePerItem('txTimeInQueue') / 1000
    const queueLength = this.statistics.getWatcherValue('queueLength')
    if (queueLength < 10) return 0
    if (queueLength > this.queueLimit) return 1
    const load = txTimeInQueue / this.desiredTxTime
    return load > 1 ? 1 : load
  }

  isOverloaded () {
    if (!this.limitRate) return false
    const load = this.getCurrentLoad()
    if (load < this.loadLimit) return false
    return Math.random() < load
  }
}

module.exports = LoadDetection
