import { nestedCountersInstance } from '../utils/nestedCounters';
import { logFlags } from '../logger';
import StateManager from '.';
import { P2P } from '@shardus/types';
import * as utils from '../utils';

/**
 * Help provide a list of archivers that can be used to ask for data
 * Intialize the list and use the dataSourceArchiver
 * If you need another archiver to talk to call tryNextDataSourceArchiver
 */
export default class ArchiverDataSourceHelper {
  stateManager: StateManager;

  dataSourceArchiver: P2P.ArchiversTypes.JoinedArchiver;
  dataSourceArchiverList: P2P.ArchiversTypes.JoinedArchiver[];
  dataSourceArchiverIndex: number;

  constructor(stateManager: StateManager) {
    this.stateManager = stateManager;
  }

  initWithList(listOfArchivers: P2P.ArchiversTypes.JoinedArchiver[]): void {
    utils.shuffleArray(listOfArchivers);
    this.dataSourceArchiverIndex = 0;
    this.dataSourceArchiver = listOfArchivers[this.dataSourceArchiverIndex];
    this.dataSourceArchiverList = [...listOfArchivers];
  }

  /**
   * tryNextDataSourceArchiver
   * @param debugString
   */
  tryNextDataSourceArchiver(debugString: string): boolean {
    this.dataSourceArchiverIndex++;
    /* prettier-ignore */ if (logFlags.error) this.stateManager.mainLogger.error(`tryNextDataSourceArchiver ${debugString} try next archiver: ${this.dataSourceArchiverIndex}`)
    if (this.dataSourceArchiverIndex >= this.dataSourceArchiverList.length) {
      /* prettier-ignore */ if (logFlags.error) this.stateManager.mainLogger.error(`tryNextDataSourceArchiver ${debugString} ran out of archivers ask for data`)
      this.dataSourceArchiverIndex = 0;
      /* prettier-ignore */ nestedCountersInstance.countEvent('sync', `tryNextDataSourceArchiver Out of tries: ${this.dataSourceArchiverIndex} of ${this.dataSourceArchiverList.length} `, 1)
      return false;
    }

    // pick new data source archiver
    this.dataSourceArchiver = this.dataSourceArchiverList[this.dataSourceArchiverIndex];

    if (this.dataSourceArchiver == null) {
      /* prettier-ignore */ nestedCountersInstance.countEvent('sync', `tryNextDataSourceArchiver next try: ${this.dataSourceArchiverIndex} of ${this.dataSourceArchiverList.length} ARCHIVER==null`, 1)
      return false;
    }

    /* prettier-ignore */ if (logFlags.error) this.stateManager.mainLogger.error(`tryNextDataSourceArchiver ${debugString} found: ${this.dataSourceArchiver.ip} ${this.dataSourceArchiver.port} `)

    /* prettier-ignore */ nestedCountersInstance.countEvent('sync', `tryNextDataSourceArchiver next try: ${this.dataSourceArchiverIndex} of ${this.dataSourceArchiverList.length}`, 1)

    return true;
  }

  // Not sure if this is needed
  tryRestartList(debugString: string): boolean {
    this.dataSourceArchiverIndex = 0;
    const numberArchivers = this.dataSourceArchiverList.length;

    //allow a list restart if we have a small number of NumberArchivers
    if (numberArchivers > 3) {
      return false;
    }

    /* prettier-ignore */ nestedCountersInstance.countEvent('sync', `ArchiverDataSourceHelper restartList ${debugString} numberArchivers:${numberArchivers}`, 1)

    if (numberArchivers > 0) {
      this.dataSourceArchiver = this.dataSourceArchiverList[this.dataSourceArchiverIndex];
      return true;
    }
    return false;
  }

  getNumberArchivers(): number {
    return this.dataSourceArchiverList.length;
  }
}
