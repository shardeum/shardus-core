class LoadDetection {
  constructor (config, statistics) {
    this.statistics = statistics
    this.desiredTxTime = config.desiredTxTime
    this.loadLimit = config.loadLimit
  }

  /**
   * Returns a number between 0 and 1 indicating the current load.
   */
  getCurrentLoad () {
    const txTimeInQueue = this.statistics.getAverage('txTimeInQueue')
    const queueLength = this.statistics.getAverage('queueLength')
    if (queueLength < 10) return 0
    const load = txTimeInQueue / this.desiredTxTime
    return load > 1 ? 1 : load
  }

  isOverloaded () {
    return this.getCurrentLoad() > this.loadLimit
  }
}

module.exports = LoadDetection
