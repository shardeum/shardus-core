class LoadDetection {
  constructor (config, statistics) {
    this.desiredTxTime = config.desiredTxTime
    this.queueLimit = config.queueLimit
    this.statistics = statistics
    this.load = 0
  }

  /**
   * Returns a number between 0 and 1 indicating the current load.
   */
  updateLoad () {
    const txTimeInQueue = this.statistics.getAverage('txTimeInQueue') / 1000
    const scaledTxTimeInQueue = txTimeInQueue >= this.desiredTxTime ? 1 : txTimeInQueue / this.desiredTxTime

    const queueLength = this.statistics.getWatcherValue('queueLength')
    const scaledQueueLength = queueLength >= this.queueLimit ? 1 : queueLength / this.queueLimit

    const load = Math.max(scaledTxTimeInQueue, scaledQueueLength)
    this.load = load
  }

  getCurrentLoad () {
    return this.load
  }
}

module.exports = LoadDetection
