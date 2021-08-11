import Statistics from '../statistics'
import { EventEmitter } from 'events'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { profilerInstance, NodeLoad } from '../utils/profiler'
import * as Context from '../p2p/Context'

interface LoadDetection {
  highThreshold: number /** if load > highThreshold, then scale up request */
  lowThreshold: number  /** if load < lowThreshold, then scale down request */
  desiredTxTime: number /** max desired average time for the age of a TX.  */
  queueLimit: number    /** max desired TXs in queue. note TXs must spend a minimum 6 seconds in the before they can process*/
  statistics: Statistics
  load: number /** load is what matters for scale up or down. it is the max of scaledTimeInQueue and scaledQueueLength. */
  nodeLoad: NodeLoad /** this nodes perf related load. does not determine scale up/down, but can cause rate-limiting */
  scaledTxTimeInQueue: number /** 0-1 value on how close to desiredTxTime this nodes is (set to 0 if scaledQueueLength < lowThreshold) */
  scaledQueueLength: number /** 0-1 value on how close to queueLimit this nodes is */
  dbg: boolean
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
      external: 0,
    }
    this.scaledTxTimeInQueue = 0
    this.scaledQueueLength = 0

    this.dbg = false

    /**
     * Sets load to DESIRED_LOAD (should be between 0 and 1)
     * 
     * Usage: http://<NODE_IP>:<NODE_EXT_PORT>/loadset?load=<DESIRED_LOAD>
     */
    Context.network.registerExternalGet('loadset', (req, res) => {
      if (req.query.load == null) return
      this.dbg = true
      this.load = Number(req.query.load)
      console.log(`set load to ${this.load}`)
      res.send(`set load to ${this.load}`)
    })
    /**
     * Resets load detection to normal behavior
     * 
     * Usage: http://<NODE_IP>:<NODE_EXT_PORT>/loadreset
     */
    Context.network.registerExternalGet('loadreset', (req, res) => {
      this.dbg = false
      console.log('reset load detection to normal behavior')
      res.send('reset load detection to normal behavior')
    })
  }

  /**
   * Returns a number between 0 and 1 indicating the current load.
   */
  updateLoad() {
    let load

    if (this.dbg) {
      load = this.load
    } else {
      const txTimeInQueue = this.statistics.getAverage('txTimeInQueue') / 1000
      let scaledTxTimeInQueue =
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

      //need 20 samples in the queue before we start worrying about them being there too long
      if(queueLength < 20){
      //if(scaledQueueLength < (this.lowThreshold)){ //tried to get fancy, but going back to 20 as a constant.
        if(scaledTxTimeInQueue > this.highThreshold){
          nestedCountersInstance.countEvent(
            'loadRelated',
            `scaledTxTimeInQueue clamped due to low scaledQueueLength`
          )
        }
        scaledTxTimeInQueue = 0
      }

      this.scaledTxTimeInQueue = scaledTxTimeInQueue
      this.scaledQueueLength = scaledQueueLength

      if (profilerInstance != null) {
        let dutyCycleLoad = profilerInstance.getTotalBusyInternal()
        if (dutyCycleLoad.duty > 0.4) {
          nestedCountersInstance.countEvent(
            'loadRelated',
            'note-dutyCycle 0.4'
          )
        }
        if (dutyCycleLoad.duty > 0.6) {
          nestedCountersInstance.countEvent(
            'loadRelated',
            `note-dutyCycle 0.6`
          )
        }
        this.nodeLoad = {
          internal: dutyCycleLoad.netInternlDuty,
          external: dutyCycleLoad.netExternlDuty,
        }
      }

      load = Math.max(scaledTxTimeInQueue, scaledQueueLength)


      if(scaledQueueLength > this.highThreshold){
        nestedCountersInstance.countEvent(
          'loadRelated',
          'highThreshold-scaledQueueLength'
        )
      }
      if(scaledTxTimeInQueue > this.highThreshold){
        nestedCountersInstance.countEvent(
          'loadRelated',
          'highThreshold-scaledTxTimeInQueue'
        )
      }
    }

    //If our max load is higher than the threshold send highLoad event that will create scale up gossip
    if (load > this.highThreshold){
      this.emit('highLoad')
    } 
    //If our max load is lower than threshold send a scale down message.
    if (load < this.lowThreshold){
      this.emit('lowLoad')
    } 
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
      queueLength: this.scaledQueueLength,
    }
  }
}

export default LoadDetection
