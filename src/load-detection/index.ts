import Statistics from '../statistics'
// import { Ring } from '../statistics'
import { EventEmitter } from 'events'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { profilerInstance, NodeLoad } from '../utils/profiler'
import * as Context from '../p2p/Context'
import { memoryReportingInstance } from '../utils/memoryReporting'
import { isDebugModeMiddleware } from '../network/debugMiddleware'
interface LoadDetection {
  highThreshold: number /** if load > highThreshold, then scale up request */
  lowThreshold: number /** if load < lowThreshold, then scale down request */
  desiredTxTime: number /** max desired average time for the age of a TX.  */
  queueLimit: number /** max desired TXs in queue. note TXs must spend a minimum 6 seconds in the before they can process*/
  executeQueueLimit: number /** max desired TXs in queue that will be executed on this node. note TXs must spend a minimum 6 seconds in the before they can process*/
  statistics: Statistics
  load: number /** load is what matters for scale up or down. it is the max of scaledTimeInQueue and scaledQueueLength. */
  nodeLoad: NodeLoad /** this nodes perf related load. does not determine scale up/down, but can cause rate-limiting */
  scaledTxTimeInQueue: number /** 0-1 value on how close to desiredTxTime this nodes is (set to 0 if scaledQueueLength < lowThreshold) */
  scaledQueueLength: number /** 0-1 value on how close to queueLimit this nodes is */
  scaledExecuteQueueLength: number /** 0-1 value on how close to queueLimit this nodes is */
  dbg: boolean
  lastEmitCycle: number /** the last cylce that we have sent load events on */
}
let lastMeasuredTimestamp = 0

class LoadDetection extends EventEmitter {
  constructor(config, statistics) {
    super()
    this.highThreshold = config.highThreshold
    this.lowThreshold = config.lowThreshold
    this.desiredTxTime = config.desiredTxTime
    this.queueLimit = config.queueLimit
    this.executeQueueLimit = config.executeQueueLimit
    this.statistics = statistics
    this.load = 0
    this.nodeLoad = {
      internal: 0,
      external: 0,
    }
    this.scaledTxTimeInQueue = 0
    this.scaledQueueLength = 0
    this.scaledExecuteQueueLength = 0

    this.dbg = false
    this.lastEmitCycle = -1

    /**
     * Sets load to DESIRED_LOAD (should be between 0 and 1)
     *
     * Usage: http://<NODE_IP>:<NODE_EXT_PORT>/loadset?load=<DESIRED_LOAD>
     */
    Context.network.registerExternalGet('loadset', isDebugModeMiddleware, (req, res) => {
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
    Context.network.registerExternalGet('loadreset', isDebugModeMiddleware, (req, res) => {
      this.dbg = false
      console.log('reset load detection to normal behavior')
      res.send('reset load detection to normal behavior')
    })
    Context.network.registerExternalGet('load', (req, res) => {
      try {
        // todo: reject if request is not coming from node operator dashboard
        const load = this.getCurrentLoad()
        const nodeLoad = this.getCurrentNodeLoad()
        return res.json({load, nodeLoad})
      } catch (e) {
        console.log(`Error getting load: ${e.message}`);
      }
    })
  }

  configUpdated() {
    if (this.desiredTxTime !== Context.config.loadDetection.desiredTxTime) {
      this.desiredTxTime = typeof Context.config.loadDetection.desiredTxTime === 'string' ? Number(Context.config.loadDetection.desiredTxTime) : Context.config.loadDetection.desiredTxTime
      console.log('Config updated for loadDetection.desiredTxTime', this.desiredTxTime)
      nestedCountersInstance.countEvent(
        'loadRelated',
        `desiredTxTime config updated`
      )
    }
  }

  /**
   * Returns a number between 0 and 1 indicating the current load.
   */
  updateLoad() {
    let load

    if (this.dbg) {
      load = this.load
      this.scaledTxTimeInQueue = load
      this.scaledQueueLength = load
      this.scaledExecuteQueueLength = load
    } else {
      const txTimeInQueue = this.statistics.getAverage('txTimeInQueue') / 1000
      let scaledTxTimeInQueue = txTimeInQueue >= this.desiredTxTime ? 1 : txTimeInQueue / this.desiredTxTime

      const queueLength = this.statistics.getWatcherValue('queueLength')
      const scaledQueueLength = queueLength >= this.queueLimit ? 1 : queueLength / this.queueLimit

      // looking at these counters individually so we can have more detail about load
      // if (scaledTxTimeInQueue > this.highThreshold){
      //   nestedCountersInstance.countEvent('loadRelated',`highLoad-scaledTxTimeInQueue ${this.highThreshold}`)
      // }
      // if (scaledQueueLength > this.highThreshold){
      //   nestedCountersInstance.countEvent('loadRelated',`highLoad-scaledQueueLength ${this.highThreshold}`)
      // }

      //need 20 samples in the queue before we start worrying about them being there too long
      if (queueLength < 20) {
        //if(scaledQueueLength < (this.lowThreshold)){ //tried to get fancy, but going back to 20 as a constant.
        if (scaledTxTimeInQueue > this.highThreshold) {
          nestedCountersInstance.countEvent(
            'loadRelated',
            `scaledTxTimeInQueue clamped due to low scaledQueueLength`
          )
        }
        scaledTxTimeInQueue = 0
      }

      const executeQueueLength = this.statistics.getWatcherValue('executeQueueLength')
      const scaledExecuteQueueLength =
        executeQueueLength >= this.executeQueueLimit ? 1 : executeQueueLength / this.executeQueueLimit

      this.scaledTxTimeInQueue = scaledTxTimeInQueue
      this.scaledQueueLength = scaledQueueLength
      this.scaledExecuteQueueLength = scaledExecuteQueueLength

      if (profilerInstance != null) {
        let dutyCycleLoad = profilerInstance.getTotalBusyInternal()
        if (dutyCycleLoad.duty > 0.8) {
          nestedCountersInstance.countEvent('loadRelated', `note-dutyCycle 0.8`)
        } else if (dutyCycleLoad.duty > 0.6) {
          nestedCountersInstance.countEvent('loadRelated', `note-dutyCycle 0.6`)
        } else if (dutyCycleLoad.duty > 0.4) {
          nestedCountersInstance.countEvent('loadRelated', 'note-dutyCycle 0.4')
        }

        this.statistics.setManualStat('netInternalDuty', dutyCycleLoad.netInternlDuty)
        this.statistics.setManualStat('netExternalDuty', dutyCycleLoad.netInternlDuty)

        let cpuPercent = memoryReportingInstance.cpuPercent()
        this.statistics.setManualStat('cpuPercent', cpuPercent)

        let internalDutyAvg = this.statistics.getAverage('netInternalDuty')
        let externalDutyAvg = this.statistics.getAverage('netExternalDuty')

        this.nodeLoad = {
          internal: internalDutyAvg, //dutyCycleLoad.netInternlDuty,
          external: externalDutyAvg, //dutyCycleLoad.netExternlDuty,
        }
      }

      //lets use 80% of our EXSS load and 20% of our total load
      //let adjustedQueueLoad = (scaledExecuteQueueLength * 0.8) + (scaledQueueLength * 0.2)
      //lets use 100% of our EXSS load ... todo could make this a setting
      //let adjustedQueueLoad = (scaledExecuteQueueLength * 1.0) + (scaledQueueLength * 0.0)

      //mix these together with a MAX use settings to make scaledQueueLength much larger than scaledExecuteQueueLength
      let adjustedQueueLoad = Math.max(scaledExecuteQueueLength, scaledQueueLength)

      //load = Math.max(scaledTxTimeInQueue, scaledQueueLength)

      load = Math.max(scaledTxTimeInQueue, adjustedQueueLoad)

      if (scaledQueueLength > this.highThreshold) {
        nestedCountersInstance.countEvent('loadRelated', 'highThreshold-scaledQueueLength')
      }
      if (scaledExecuteQueueLength > this.highThreshold) {
        nestedCountersInstance.countEvent('loadRelated', 'highThreshold-scaledExecuteQueueLength')
      }
      // if(adjustedQueueLoad > this.highThreshold){
      //   nestedCountersInstance.countEvent(
      //     'loadRelated',
      //     'highThreshold-adjustedQueueLoad'
      //   )
      // }
      if (scaledTxTimeInQueue > this.highThreshold) {
        nestedCountersInstance.countEvent('loadRelated', 'highThreshold-scaledTxTimeInQueue')
      }
    }

    //only send load events if we are on a new cycle.
    //updateLoad gets called at a much higher frequency than once per cycle
    //We could potentially make this better by taking some kind of self average
    //rather than just the random luck of load see when a new cycle has turned over.
    //however, these load metrics already have some inherent averaging
    let lastCycle = Context.p2p.state.getLastCycle();
    if (lastCycle == null) {
      return
    } else if (this.lastEmitCycle != lastCycle.counter) {
      this.lastEmitCycle = lastCycle.counter
      //If our max load is higher than the threshold send highLoad event that will create scale up gossip
      if (load > this.highThreshold) {
        this.emit('highLoad')
      }
      //If our max load is lower than threshold send a scale down message.
      if (load < this.lowThreshold) {
        this.emit('lowLoad')
      }
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
      queueLength: this.scaledQueueLength, //this will impact rejections, but not scale up-down
      executeQueueLength: this.scaledExecuteQueueLength,
    }
  }
}

export default LoadDetection
