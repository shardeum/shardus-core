import LoadDetection from '../load-detection'
import { NodeLoad } from '../utils/profiler'
import { nestedCountersInstance } from '../utils/nestedCounters'

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

  calculateThrottlePropotion(load, limit) {
    const throttleRange = 1 - limit
    const throttleAmount = load- limit
    const throttleProportion = throttleAmount / throttleRange
    return throttleProportion
  }

  getWinningLoad(nodeLoad, queueLoad) {
    let loads = {...nodeLoad, ...queueLoad}
    let maxThrottle: number = 0
    let loadType: any
    for (let key in loads) {
      if(this.loadLimit[key] == null){
        continue //not checking load limit for undefined or 0 limit.
      }
      if (loads[key] < this.loadLimit[key]) continue
      let throttle = this.calculateThrottlePropotion(loads[key], this.loadLimit[key])

      nestedCountersInstance.countEvent('loadRelated',`limit reached: ${key} > ${this.loadLimit[key]}`)  
      if (throttle > maxThrottle) {
        maxThrottle = throttle
        loadType = key
      }
    }

    if(loadType){
      nestedCountersInstance.countEvent('loadRelated',`winning load factor: ${loadType}`)  
    }

    return {
      throttle: maxThrottle,
      loadType
    }
  }

  isOverloaded() {
    if (!this.limitRate) return false
    const nodeLoad = this.loadDetection.getCurrentNodeLoad()
    const queueLoad = this.loadDetection.getQueueLoad()

    let { throttle, loadType } = this.getWinningLoad(nodeLoad, queueLoad)

    if (throttle > 0) {
      // TODO: add counter to track max load type
    }
    return Math.random() < throttle
  }
}

export default RateLimiting
