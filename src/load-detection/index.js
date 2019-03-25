class LoadDetection {
  constructor (config, statistics) {
    this.desiredTxTime = config.desiredTxTime
    this.queueLimit = config.queueLimit
    this.statistics = statistics
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
}

module.exports = LoadDetection
