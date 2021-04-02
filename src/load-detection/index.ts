import Statistics from '../statistics'
import { EventEmitter } from 'events'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { profilerInstance, NodeLoad} from "../utils/profiler"

interface LoadDetection {
  highThreshold: number
  lowThreshold: number
  desiredTxTime: number
  queueLimit: number
  statistics: Statistics
  load: number
  nodeLoad: NodeLoad,
  scaledTxTimeInQueue: number,
  scaledQueueLength: number,
}
let lastMeasuredTimestamp = 0

class LoadDetection extends EventEmitter {
  constructor(config, statistics) {
    super()
    this.highThreshold = config.highThreshold
    this.lowThreshold = config.lowThreshold
    this.desiredTxTime = config.desiredTxTime
    this.queueLimit = config.queueLimit
    this.statistics = statistics
    this.load = 0
    this.nodeLoad = {
      internal: 0,
      external: 0
    }
    this.scaledTxTimeInQueue = 0
    this.scaledQueueLength = 0
  }

  /**
   * Returns a number between 0 and 1 indicating the current load.
   */
  updateLoad() {
    const txTimeInQueue = this.statistics.getAverage('txTimeInQueue') / 1000
    const scaledTxTimeInQueue =
      txTimeInQueue >= this.desiredTxTime
        ? 1
        : txTimeInQueue / this.desiredTxTime

    const queueLength = this.statistics.getWatcherValue('queueLength')
    const scaledQueueLength =
      queueLength >= this.queueLimit ? 1 : queueLength / this.queueLimit

    // looking at these counters individually so we can have more detail about load
    // if (scaledTxTimeInQueue > this.highThreshold){
    //   nestedCountersInstance.countEvent('loadRelated',`highLoad-scaledTxTimeInQueue ${this.highThreshold}`)      
    // }
    // if (scaledQueueLength > this.highThreshold){
    //   nestedCountersInstance.countEvent('loadRelated',`highLoad-scaledQueueLength ${this.highThreshold}`)      
    // }

    this.scaledTxTimeInQueue = scaledTxTimeInQueue
    this.scaledQueueLength = scaledQueueLength

    if(profilerInstance != null) {
      let dutyCycleLoad = profilerInstance.getTotalBusyInternal()
      if (dutyCycleLoad.duty > 0.4){
        nestedCountersInstance.countEvent('loadRelated','highLoad-dutyCycle 0.4')      
      }      
      if (dutyCycleLoad.duty > 0.6){
        nestedCountersInstance.countEvent('loadRelated',`highLoad-dutyCycle 0.6`)      
      }   
      this.nodeLoad = {
        internal: dutyCycleLoad.netInternlDuty,
        external: dutyCycleLoad.netExternlDuty,
      }
    }
    
    const load = Math.max(scaledTxTimeInQueue, scaledQueueLength)
    if (load > this.highThreshold) this.emit('highLoad')
    if (load < this.lowThreshold) this.emit('lowLoad')
    this.load = load
  }

  getCurrentLoad() {
    return this.load
  }

  getCurrentNodeLoad() {
    return this.nodeLoad
  }

  getQueueLoad() {
    return {
      txTimeInQueue: this.scaledTxTimeInQueue,
      queueLength: this.scaledQueueLength
    }
  }
}

export default LoadDetection
