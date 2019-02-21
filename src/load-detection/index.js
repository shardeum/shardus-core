class LoadDetection {
  constructor (config, statistics) {
    config.maxInjectedTps = BigInt(config.maxInjectedTps)
    config.maxAppliedTps = BigInt(config.maxAppliedTps)
    this.unitsPerSec = statistics.unitsPerSec
    this.minInjectedTxTime = config.maxInjectedTps > BigInt(0) ? this.unitsPerSec / config.maxInjectedTps : BigInt(0)
    this.minAppliedTxTime = config.maxAppliedTps > BigInt(0) ? this.unitsPerSec / config.maxAppliedTps : BigInt(0)
    this.statistics = statistics
  }

  isOverloaded () {
    const now = process.hrtime.bigint()
    const timeSinceLastInjected = now - this.statistics.getLastTxInjectedTime()
    const timeSinceLastApplied = now - this.statistics.getLastTxAppliedTime()
    if (timeSinceLastInjected < this.minInjectedTxTime) return true
    if (timeSinceLastApplied < this.minAppliedTxTime) return true
    return false
  }
}

module.exports = LoadDetection
