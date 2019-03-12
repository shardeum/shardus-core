class LoadDetection {
  constructor (statistics) {
    this.statistics = statistics
  }

  /**
   * Returns a number between 0 and 1 indicating the current load.
   */
  getCurrentLoad () {
    /*
    console.log('DBG', 'avg txInjected', this.statistics.getAverage('txInjected'))
    console.log('DBG', 'avg txApplied', this.statistics.getAverage('txApplied'))
    console.log('DBG', 'avg txRejected', this.statistics.getAverage('txRejected'))
    console.log('DBG', 'avg queueLength', this.statistics.getAverage('queueLength'))
    console.log('DBG', '======')
    */
  }

  isOverloaded () {
    // return this.getCurrentLoad() > 0.8
    return false
  }
}

module.exports = LoadDetection
