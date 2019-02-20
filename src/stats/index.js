class Stats {
  constructor () {
    this.txInjected = []
    this.txApplied = []
    this.windowLength = 5000
  }

  incrementTxInjected () {
    this.txInjected.push(Date.now())
    this._removeOld()
  }

  incrementTxApplied () {
    this.txApplied.push(Date.now())
    this._removeOld()
  }

  getTxInjected (since = 0) {
    if (since === 0) return this.txInjected.length
    return this.txInjected.filter(time => time > since).length
  }

  getTxApplied (since = 0) {
    if (since === 0) return this.txApplied.length
    return this.txApplied.filter(time => time > since).length
  }

  getLastTxInjectedTime () {
    return this.txInjected[this.txInjected.length - 1]
  }

  getLastTxAppliedTime () {
    return this.txApplied[this.txApplied.length - 1]
  }

  _removeOld () {
    const expired = Date.now() - this.windowLength
    this.txInjected = this.txInjected.filter(time => time > expired)
    this.txApplied = this.txApplied.filter(time => time > expired)
  }
}

module.exports = Stats
