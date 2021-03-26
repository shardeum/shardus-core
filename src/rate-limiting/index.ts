import LoadDetection from '../load-detection'
import { NodeLoad } from '../utils/profiler'

interface RateLimiting {
  loadDetection: LoadDetection
  limitRate: boolean
  loadLimit: NodeLoad
}

class RateLimiting {
  constructor(config, loadDetection) {
    this.loadDetection = loadDetection
    this.limitRate = config.limitRate
    this.loadLimit = config.loadLimit
  }

  isOverloaded() {
    if (!this.limitRate) return false
    const load = this.loadDetection.getCurrentNodeLoad()
    if (load.internal < this.loadLimit.internal) return false
    const throttleRange = 1 - this.loadLimit.internal
    const throttleAmount = load.internal - this.loadLimit.internal
    const throttleProportion = throttleAmount / throttleRange
    return Math.random() < throttleProportion
  }
}

export default RateLimiting
