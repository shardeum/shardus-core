class LoadDetection {
  constructor (statistics) {
    this.statistics = statistics
  }

  /**
   * Returns a number between 0 and 1 indicating the current load.
   */
  getCurrentLoad () {
    /*
    console.log('DBG', 'avg txInjected', this.statistics.average('txInjected'))
    console.log('DBG', 'avg txApplied', this.statistics.average('txApplied'))
    console.log('DBG', 'avg txRejected', this.statistics.average('txRejected'))
    console.log('DBG', 'avg queueLength', this.statistics.averageQueueLength())
    console.log('DBG', '======')
    */
  }

  isOverloaded () {
    // return this.getCurrentLoad() > 0.8
    this.getCurrentLoad()
    return false
  }
}

module.exports = LoadDetection
