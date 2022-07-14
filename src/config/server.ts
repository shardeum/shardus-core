import { ServerMode, StrictServerConfiguration } from '../shardus/shardus-types'

const SERVER_CONFIG: StrictServerConfiguration = {
  heartbeatInterval: 5,
  baseDir: '.',
  transactionExpireTime: 5,
  crypto: {
    hashKey: '69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc',
  },
  p2p: {
    ipServer: 'api.ipify.org/?format=json',
    timeServers: [
      '0.pool.ntp.org',
      '1.pool.ntp.org',
      '2.pool.ntp.org',
      '3.pool.ntp.org',
    ],
    existingArchivers: [
      {
        ip: '127.0.0.1',
        port: 4000,
        publicKey:
          '758b1c119412298802cd28dbfa394cdfeecc4074492d60844cc192d632d84de3',
      },
      {
        ip: '127.0.0.1',
        port: 4001,
        publicKey:
          'e4b5e3d51e727f897786a1bb176a028ecfe1941bfa5beefd3c6209c3dbc07cf7',
      },
    ],
    syncLimit: 180,
    cycleDuration: 30,
    maxRejoinTime: 20,
    difficulty: 2,
    queryDelay: 1,
    gossipRecipients: 8,
    gossipFactor: 4,
    gossipStartSeed: 15,
    gossipSeedFallof: 15,
    gossipTimeout: 180,
    maxSeedNodes: 10,
    minNodesToAllowTxs: 1,
    minNodes: 15,
    maxNodes: 30,
    seedNodeOffset: 4,
    nodeExpiryAge: 30,
    maxJoinedPerCycle: 1,
    maxSyncingPerCycle: 5,
    syncBoostEnabled: true,
    maxSyncTimeFloor: 1200,
    maxNodeForSyncTime: 9,
    maxRotatedPerCycle: 1,
    firstCycleJoin: 10,
    maxPercentOfDelta: 40,
    minScaleReqsNeeded: 5,
    maxScaleReqs: 200,
    scaleConsensusRequired: 0.25,
    amountToGrow: 1,
    amountToShrink: 1,
    startInWitnessMode: false,
    experimentalSnapshot: true,
    detectLostSyncing: true,
  },
  ip: {
    externalIp: '0.0.0.0',
    externalPort: 9001,
    internalIp: '0.0.0.0',
    internalPort: 10001,
  },
  network: { timeout: 5 },
  reporting: {
    report: true,
    recipient: 'http://127.0.0.1:3000/api',
    interval: 2,
    console: false,
  },
  debug: {
    loseReceiptChance: 0,
    loseTxChance: 0,
    canDataRepair: false,
    startInFatalsLogMode: false,
    startInErrorLogMode: true,
    fakeNetworkDelay: 0,
    disableSnapshots: true,
    disableTxCoverageReport: true,
    haltOnDataOOS: false,
    countEndpointStart: -1,
    countEndpointStop: -1,
    hashedDevAuth: '',
    devPublicKey: '',
    newCacheFlow: true,
    debugNoTxVoting: false,
    ignoreRecieptChance: 0,
    ignoreVoteChance: 0,
    failReceiptChance: 0,
    voteFlipChance: 0,
    skipPatcherRepair: false,
    failNoRepairTxChance: 0,
    useNewParitionReport: false,
    oldPartitionSystem: false,
    dumpAccountReportFromSQL: false,
    profiler: false,
    optimizedTXConsenus: true,
    robustQueryDebug: false,
    forwardTXToSyncingNeighbors: false,
  },
  statistics: { save: true, interval: 1 },
  loadDetection: {
    queueLimit: 1000,
    desiredTxTime: 15,
    highThreshold: 0.5,
    lowThreshold: 0.2,
  },
  rateLimiting: {
    limitRate: true,
    loadLimit: {
      internal: 0.5,
      external: 0.4,
      txTimeInQueue: 0.2,
      queueLength: 0.2,
    },
  },
  stateManager: { 
    stateTableBucketSize: 500, 
    accountBucketSize: 200,
    patcherAccountsPerRequest: 250,
    patcherAccountsPerUpdate: 2500, 
    patcherMaxHashesPerRequest: 300,
    patcherMaxLeafHashesPerRequest: 300,
    patcherMaxChildHashResponses: 2000,
    maxDataSyncRestarts: 5,
    maxTrackerRestarts: 5
  },
  sharding: { nodesPerConsensusGroup: 5, executeInOneShard: false },
  mode: ServerMode.Debug,
}
export default SERVER_CONFIG
