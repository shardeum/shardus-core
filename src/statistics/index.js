class Statistics {
  constructor (config) {
    this.unitsPerSec = BigInt(1000000000)
    this.txInjected = []
    this.txApplied = []
    this.windowLength = this.unitsPerSec * BigInt(config.windowLength)
  }

  incrementTxInjected () {
    const now = process.hrtime.bigint()
    this.txInjected.push(now)
    const expired = now - this.windowLength
    this.txInjected = this.txInjected.filter(time => time > expired)
  }

  incrementTxApplied () {
    const now = process.hrtime.bigint()
    this.txApplied.push(now)
    const expired = now - this.windowLength
    this.txApplied = this.txApplied.filter(time => time > expired)
  }

  getTxInjectedCount (since = 0) {
    if (since === 0) return this.txInjected.length
    return this.txInjected.filter(time => time > since).length
  }

  getTxAppliedCount (since = 0) {
    if (since === 0) return this.txApplied.length
    return this.txApplied.filter(time => time > since).length
  }

  getLastTxInjectedTime () {
    if (this.txInjected.length < 1) return BigInt(0)
    return this.txInjected[this.txInjected.length - 1]
  }

  getLastTxAppliedTime () {
    if (this.txApplied.length < 1) return BigInt(0)
    return this.txApplied[this.txApplied.length - 1]
  }
}

module.exports = Statistics
