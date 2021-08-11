import Statistics from '../statistics'
import { EventEmitter } from 'events'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { profilerInstance, NodeLoad } from '../utils/profiler'
import * as Context from '../p2p/Context'

interface LoadDetection {
  highThreshold: number
  lowThreshold: number
  desiredTxTime: number
  queueLimit: number
  statistics: Statistics
  load: number
  nodeLoad: NodeLoad
  scaledTxTimeInQueue: number
  scaledQueueLength: number
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
      //if(queueLength < 20){
      if(scaledQueueLength < this.lowThreshold){
        if(scaledTxTimeInQueue > this.highThreshold){
          nestedCountersInstance.countEvent(
            'loadRelated',
            `scaled time fix`
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
            'highLoad-dutyCycle 0.4'
          )
        }
        if (dutyCycleLoad.duty > 0.6) {
          nestedCountersInstance.countEvent(
            'loadRelated',
            `highLoad-dutyCycle 0.6`
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
          'scaledQueueLength past highThreshold'
        )
      }
      if(scaledTxTimeInQueue > this.highThreshold){
        nestedCountersInstance.countEvent(
          'loadRelated',
          'scaledTxTimeInQueue past highThreshold'
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
