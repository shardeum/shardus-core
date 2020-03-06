interface RateLimiting {
  loadDetection: LoadDetection
  limitRate: boolean
  loadLimit: number
}

class RateLimiting {
  constructor (config, loadDetection) {
    this.loadDetection = loadDetection
    this.limitRate = config.limitRate
    this.loadLimit = config.loadLimit
  }

  isOverloaded () {
    if (!this.limitRate) return false
    const load = this.loadDetection.getCurrentLoad()
    if (load < this.loadLimit) return false
    const throttleRange = 1 - this.loadLimit
    const throttleAmount = load - this.loadLimit
    const throttleProportion = throttleAmount / throttleRange
    return Math.random() < throttleProportion
  }
}

module.exports = RateLimiting
