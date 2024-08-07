import LoadDetection from '../load-detection';
import { NodeLoad } from '../utils/profiler';
import { nestedCountersInstance } from '../utils/nestedCounters';
import Log4js from 'log4js';
import { shardusGetTime } from '../network';
import { activeIdToPartition } from '../p2p/NodeList';
import * as Self from '../p2p/Self';
import * as Context from '../p2p/Context';
import { logFlags } from '../logger';

interface RateLimiting {
  limitRate: boolean;
  loadLimit: NodeLoad;
  seqLogger: Log4js.Logger;
}

class RateLimiting {
  constructor(config, seqLogger) {
    this.limitRate = config.limitRate;
    this.loadLimit = config.loadLimit;
    this.seqLogger = seqLogger;
  }

  calculateThrottlePropotion(load, limit) {
    const throttleRange = 1 - limit;
    const throttleAmount = load - limit;
    const throttleProportion = throttleAmount / throttleRange;
    return throttleProportion;
  }

  getWinningLoad(nodeLoad, queueLoad) {
    let loads = { ...nodeLoad, ...queueLoad };
    let maxThrottle: number = 0;
    let loadType: any;
    for (let key in loads) {
      if (this.loadLimit[key] == null) {
        continue; //not checking load limit for undefined or 0 limit.
      }
      if (loads[key] < this.loadLimit[key]) continue;
      let throttle = this.calculateThrottlePropotion(loads[key], this.loadLimit[key]);

      /* prettier-ignore */ nestedCountersInstance.countEvent('loadRelated',`ratelimit reached: ${key} > ${this.loadLimit[key]}`)
      if (throttle > maxThrottle) {
        maxThrottle = throttle;
        loadType = key;
      }
    }

    if (loadType) {
      nestedCountersInstance.countEvent('loadRelated', `ratelimit winning load factor: ${loadType}`);
    }

    return {
      throttle: maxThrottle,
      loadType,
    };
  }

  isOverloaded(txId: string) {
    if (!this.limitRate) return false;
    const nodeLoad = Context.shardus.loadDetection.getCurrentNodeLoad();
    const queueLoad = Context.shardus.loadDetection.getQueueLoad();

    let { throttle, loadType } = this.getWinningLoad(nodeLoad, queueLoad);

    if (throttle > 0) {
      // TODO: add counter to track max load type
    }
    let overloaded = Math.random() < throttle;

    if (overloaded) {
      /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(
        `0x53455106 ${shardusGetTime()} tx:${txId} Note over ${activeIdToPartition.get(
          Self.id
        )}: overloaded_type ${loadType}:${throttle}`
      )
      /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(
        `0x53455106 ${shardusGetTime()} tx:${txId} Note over ${activeIdToPartition.get(
          Self.id
        )}: overloaded_node ${nodeLoad.internal}/${nodeLoad.external}`
      )
      /* prettier-ignore */ if (logFlags.seqdiagram) this.seqLogger.info(
        `0x53455106 ${shardusGetTime()} tx:${txId} Note over ${activeIdToPartition.get(
          Self.id
        )}: overloaded_queue ${queueLoad.txTimeInQueue}/${queueLoad.queueLength}}/${
          queueLoad.executeQueueLength
        }`
      )
      nestedCountersInstance.countEvent('loadRelated', 'txRejected:' + loadType);
    }

    return overloaded;
  }

  configUpdated() {
    try {
      if (this.limitRate !== Context.config.rateLimiting.limitRate) {
        this.limitRate = Context.config.rateLimiting.limitRate;
        console.log('Config updated for rateLimiting.limitRate', this.limitRate);
        nestedCountersInstance.countEvent('RateLimiting', 'limitRate config updated');
      }
      if (JSON.stringify(this.loadLimit) !== JSON.stringify(Context.config.rateLimiting.loadLimit)) {
        this.loadLimit = Context.config.rateLimiting.loadLimit;
        console.log('Config updated for rateLimiting.loadLimit', this.loadLimit);
        nestedCountersInstance.countEvent('RateLimiting', 'loadLimit config updated');
      }
    } catch (e) {
      nestedCountersInstance.countEvent('RateLimiting', 'config update failed');
    }
  }
}

export default RateLimiting;
