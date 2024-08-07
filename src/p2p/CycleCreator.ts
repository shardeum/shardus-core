import deepmerge from 'deepmerge';
import { Logger } from 'log4js';
import { logFlags } from '../logger';
import { P2P } from '@shardus/types';
import * as utils from '../utils';
// don't forget to add new modules here
import * as Active from './Active';
import * as Apoptosis from './Apoptosis';
import * as Archivers from './Archivers';
import * as Comms from './Comms';
import { config, crypto, logger, stateManager, storage } from './Context';
import * as CycleAutoScale from './CycleAutoScale';
import * as CycleChain from './CycleChain';
import * as Join from './Join';
import * as Lost from './Lost';
import * as NodeList from './NodeList';
import { profilerInstance } from '../utils/profiler';
import * as Refresh from './Refresh';
import * as Rotation from './Rotation';
import * as SafetyMode from './SafetyMode';
import * as Modes from './Modes';
import * as Self from './Self';
import * as LostArchivers from './LostArchivers';
import { compareQuery, Comparison } from './Utils';
import { errorToStringFull, formatErrorMessage } from '../utils';
import { nestedCountersInstance } from '../utils/nestedCounters';
import { randomBytes } from '@shardus/crypto-utils';
import { digestCycle, syncNewCycles } from './Sync';
import { shardusGetTime } from '../network';
import { InternalBinaryHandler } from '../types/Handler';
import { InternalRouteEnum } from '../types/enum/InternalRouteEnum';
import { TypeIdentifierEnum } from '../types/enum/TypeIdentifierEnum';
import {
  CompareCertRespSerializable,
  deserializeCompareCertResp,
  serializeCompareCertResp,
} from '../types/CompareCertResp';
import {
  CompareCertReqSerializable,
  deserializeCompareCertReq,
  serializeCompareCertReq,
} from '../types/CompareCertReq';
import { verifyPayload } from '../types/ajv/Helpers';
import fs from 'fs';
import path from 'path';
import { getStreamWithTypeCheck, requestErrorHandler } from '../types/Helpers';
import { RequestErrorEnum } from '../types/enum/RequestErrorEnum';
import { BadRequest, InternalError, NotFound, serializeResponseError } from '../types/ResponseError';
import { Utils } from '@shardus/types';
import { nodeListFromStates } from './Join';

/** CONSTANTS */

const SECOND = 1000;
const BEST_CERTS_WANTED = 3;
const DESIRED_CERT_MATCHES = 3;
const MAX_CYCLES_TO_KEEP = 20;

// add the types of any new modules here
type submoduleTypes =
  | typeof Archivers
  | typeof Join
  | typeof Active
  | typeof Rotation
  | typeof Refresh
  | typeof Apoptosis
  | typeof Lost
  | typeof SafetyMode
  | typeof Modes
  | typeof CycleAutoScale
  | typeof LostArchivers;

/** STATE */

const filePath = path.join(process.cwd(), 'data-logs', 'cycleRecords1.txt');

let modeModuleMigrationApplied = false;
export let hasAlreadyEnteredProcessing = false;

let p2pLogger: Logger;
let cycleLogger: Logger;

// don't forget to add new modules here
//   need to keep the Lost module after the Apoptosis module

export let submodules: submoduleTypes[] = [
  Archivers,
  Join,
  Active,
  Rotation,
  Refresh,
  Apoptosis,
  Lost,
  // SafetyMode,
  Modes,
  CycleAutoScale,
  LostArchivers,
];

export let currentQuarter = -1; // means we have not started creating cycles
export let currentCycle = 0;
export let currentStart = 0;
export let nextQ1Start = 0;
export let q1SendRequests = false; // if we are in q1 this lets us know if we can send requests also

export let scaleFactor: number = 1;
export let scaleFactorSyncBoost: number = 1;

export let netConfig: any = {};

let createCycleTag = 0;

let madeCycle = false; // True if we successfully created the last cycle record, otherwise false

// not used anymore
//let madeCert = false // set to True after we make our own cert and try to gossip it

let txs: P2P.CycleCreatorTypes.CycleTxs;
let record: P2P.CycleCreatorTypes.CycleRecord;
let marker: P2P.CycleCreatorTypes.CycleMarker;
let cert: P2P.CycleCreatorTypes.CycleCert;

let bestRecord: P2P.CycleCreatorTypes.CycleRecord;
let bestMarker: P2P.CycleCreatorTypes.CycleMarker;
let bestCycleCert: Map<P2P.CycleCreatorTypes.CycleMarker, P2P.CycleCreatorTypes.CycleCert[]>;
let bestCertScore: Map<P2P.CycleCreatorTypes.CycleMarker, number>;

const timers = {};

// Keeps track of the last saved record in the DB in order to update it
let lastSavedData: P2P.CycleCreatorTypes.CycleRecord;

// Keeps track of consecutive fetchLatestCycle fails to initiate apoptosis if it happens too many times
let fetchLatestRecordFails = 0;
const maxFetchLatestRecordFails = 5;

/** ROUTES */

interface CompareMarkerReq {
  marker: P2P.CycleCreatorTypes.CycleMarker;
  txs: P2P.CycleCreatorTypes.CycleTxs;
}
interface CompareMarkerRes {
  marker: P2P.CycleCreatorTypes.CycleMarker;
  txs?: P2P.CycleCreatorTypes.CycleTxs;
}

interface CompareCertReq {
  certs: P2P.CycleCreatorTypes.CycleCert[];
  record: P2P.CycleCreatorTypes.CycleRecord;
}
interface CompareCertRes {
  certs: P2P.CycleCreatorTypes.CycleCert[];
  record: P2P.CycleCreatorTypes.CycleRecord;
}

const compareCertRoute: P2P.P2PTypes.InternalHandler<
  CompareCertReq,
  CompareCertRes,
  P2P.NodeListTypes.Node['id']
> = async (payload, respond, sender) => {
  profilerInstance.scopedProfileSectionStart('compareCert');
  await respond(compareCycleCertEndpoint(payload, sender, 'compareCycleCertEndpoint'));
  profilerInstance.scopedProfileSectionEnd('compareCert');
};

const gossipCertRoute: P2P.P2PTypes.GossipHandler<CompareCertReq, P2P.NodeListTypes.Node['id']> = (
  payload,
  sender,
  tracker
) => {
  gossipHandlerCycleCert(payload, sender, tracker);
};

const compareCertBinaryHandler: P2P.P2PTypes.Route<InternalBinaryHandler<Buffer>> = {
  name: InternalRouteEnum.binary_compare_cert,
  handler: async (payload, respond, header, sign) => {
    const route = InternalRouteEnum.binary_compare_cert;
    nestedCountersInstance.countEvent('internal', route);
    profilerInstance.scopedProfileSectionStart(route);
    const errorHandler = (
      errorType: RequestErrorEnum,
      opts?: { customErrorLog?: string; customCounterSuffix?: string }
    ): void => requestErrorHandler(route, errorType, header, opts);

    try {
      let resp: CompareCertRespSerializable = { certs: [], record: null };

      const requestStream = getStreamWithTypeCheck(payload, TypeIdentifierEnum.cCompareCertReq);
      if (!requestStream) {
        errorHandler(RequestErrorEnum.InvalidRequest);
        return respond(BadRequest('Invalid CompareCert request stream'), serializeResponseError);
      }

      const req: CompareCertReq = deserializeCompareCertReq(requestStream);

      const errors = verifyPayload('CompareCertReq', req);
      if (errors && errors.length > 0) {
        p2pLogger.error(`compareCert request validation errors: ${errors}`);
        return respond(BadRequest('Request validation errors'), serializeResponseError);
      }

      const compareCertReq: CompareCertReq = {
        certs: req.certs,
        record: req.record,
      };

      resp = compareCycleCertEndpoint(compareCertReq, header.sender_id, 'compareCycleCertBinaryEndpoint');

      respond(resp, serializeCompareCertResp);
    } catch (errors) {
      nestedCountersInstance.countEvent('internal', `${route}-exception`);
      p2pLogger.error(`${route} exception executing request: ${errorToStringFull(errors)}`);
      return respond(InternalError('Exception executing request'), serializeResponseError);
    } finally {
      profilerInstance.scopedProfileSectionEnd(route);
    }
  },
};

const routes = {
  internal: {
    'compare-cert': compareCertRoute,
  },
  gossip: {
    'gossip-cert': gossipCertRoute,
  },
  internal2: {
    [compareCertBinaryHandler.name]: compareCertBinaryHandler,
  },
};

/** CONTROL FUNCTIONS */

export function init() {
  // Get a handle to write to p2p.log
  p2pLogger = logger.getLogger('p2p');
  cycleLogger = logger.getLogger('cycle');

  for (const submodule of submodules) {
    if (submodule.init) submodule.init();
  }

  // Init state
  reset();

  // Register routes
  for (const [name, handler] of Object.entries(routes.internal)) {
    Comms.registerInternal(name, handler);
  }
  for (const [name, handler] of Object.entries(routes.gossip)) {
    Comms.registerGossipHandler(name, handler);
  }
  for (const [name, handler] of Object.entries(routes.internal2)) {
    Comms.registerInternalBinary(name, handler.handler);
  }
}

function moduleMigration() {
  // removing SafetyMode from submodules and adding Modes
  submodules = submodules.filter((submodule) => submodule !== SafetyMode);
  if (!submodules.includes(Modes)) {
    submodules.push(Modes);
    submodules[submodules.length - 1].init();
  }
}

function updateScaleFactor() {
  let activeNodeCount = NodeList.activeByIdOrder.length;
  let consensusRange = Math.min(config.sharding.nodesPerConsensusGroup, activeNodeCount); //if we have less activeNodeCount than consensus radius
  //  we can only count the minumum of the two. otherwise it would over boost scaling
  let networkParSize = 100; //num nodes where we want scale to be 1.0.   should be 50-100, can set to 5 for small network testing
  let consenusParSize = 5; //consenus size where we want the scale to be 1.0

  // this is a bit hard coded, but basicaly the first 400 nodes in a network get a boost to max syncing allowes
  // this should smooth out the joining process but make it so we dont need such high defaults for syncMax that
  // could become a problem when there are more nodes in the network later on.

  if (config.p2p.syncBoostEnabled) {
    if (activeNodeCount < 10) {
      scaleFactorSyncBoost = 1;
    } else if (activeNodeCount < 200) {
      scaleFactorSyncBoost = 2;
    } else if (activeNodeCount < 400) {
      scaleFactorSyncBoost = 1.5;
    } else {
      scaleFactorSyncBoost = 1.5;
    }
  } else {
    scaleFactorSyncBoost = 1;
  }

  scaleFactor = Math.max((consensusRange / consenusParSize) * (activeNodeCount / networkParSize), 1);
}

// Resets CycleCreator and submodules
function reset() {
  updateScaleFactor();

  // Reset submodules
  for (const module of submodules) module.reset();

  // Reset CycleCreator
  txs = collectCycleTxs();
  ({ record, marker, cert } = makeCycleData(txs, CycleChain.newest || undefined));

  //todo some logging here.

  bestRecord = undefined;
  bestMarker = undefined;
  bestCycleCert = new Map();
  bestCertScore = new Map();
}

/**
 * Entrypoint for cycle record creation. Sets things up then kicks off the
 * scheduler (cycleCreator) to start scheduling the callbacks for cycle record
 * creation.
 */
export async function startCycles() {
  if (Self.isFirst) {
    // If first node, create cycle record 0, set bestRecord to it
    const recordZero = makeRecordZero();
    bestRecord = recordZero;
    madeCycle = true;

    // Schedule the scheduler to run at cycle zero start
    const { startQ1 } = calcIncomingTimes(recordZero);
    await schedule(cycleCreator, startQ1);

    return;
  }

  // Otherwise, set bestRecord to newest record in cycle chain
  bestRecord = CycleChain.newest;
  madeCycle = true;

  await cycleCreator();
}

/**
 * Schedules itself to run at the start of each cycle, and schedules callbacks
 * to run for every quarter of the cycle.
 */
async function cycleCreator() {
  /* prettier-ignore */ if (logFlags.p2pNonFatal) console.log('cycleCreator: currentCycle', currentCycle)
  // Set current quater to 0 while we are setting up the previous record
  //   Routes should use this to not process and just single-forward gossip
  currentQuarter = 0;

  createCycleTag++;
  let callTag = `cct${createCycleTag}`;
  /* prettier-ignore */ if (logFlags.verbose) info( `cc: start C${currentCycle} Q${currentQuarter} madeCycle: ${madeCycle} bestMarker: ${bestMarker} ${callTag}` )

  try {
    // Get the previous record
    //let prevRecord = madeCycle ? bestRecord : await fetchLatestRecord()
    let prevRecord = bestRecord;
    if (!prevRecord) {
      warn(`cc: !prevRecord. Fetech now. ${callTag}`);
      prevRecord = await fetchLatestRecord();
    }
    while (!prevRecord) {
      warn(`cc: cycleCreator: Could not get fetch prevRecord. Trying again in 1 sec...  ${callTag}`);
      await utils.sleep(1 * SECOND);
      prevRecord = await fetchLatestRecord();
    }

    /* prettier-ignore */ if (logFlags.verbose) info(`cc: prevRecord.counter: ${prevRecord.counter} ${callTag}`)
    info(`cc: prevRecord.counter: ${prevRecord.counter} ${callTag}`);
    const networkModeBefore = Modes.networkMode; // Before applying new record
    //WE complete Sync.digestCycle each cycle even thought we are failing later to get to cycleLogger.info

    // Apply the previous records changes to the NodeList
    //if (madeCycle) {
    if (!CycleChain.newest || CycleChain.newest.counter < prevRecord.counter) {
      warn(`cc: digest cycle ${prevRecord.counter} ${callTag}`);
      digestCycle(prevRecord, 'cycleCreator');
    }
    //}
    let data: P2P.CycleCreatorTypes.CycleData = undefined;
    try {
      // Save the previous record to the DB
      const marker = makeCycleMarker(prevRecord);
      const certificate = makeCycleCert(marker);
      const data: P2P.CycleCreatorTypes.CycleData = { ...prevRecord, marker, certificate };

      if (lastSavedData) {
        await storage.updateCycle({ networkId: lastSavedData.networkId }, data);
      } else {
        // if node list hashes are not set at this point, set them to an empty array hash to avoid null values
        data.nodeListHash = data.nodeListHash || '';
        data.archiverListHash = data.archiverListHash || '';
        data.standbyNodeListHash = data.standbyNodeListHash || '';
        await storage.addCycles(data);
      }
      lastSavedData = data;

      /* prettier-ignore */ if (logFlags.verbose) info(`cc: cycle data created and stored. data.counter:${data.counter} ${callTag}`)

      // this event is currently only handled by non active snapshot system
      Self.emitter.emit('new_cycle_data', data);
    } catch (er) {
      /* prettier-ignore */ warn(`cc: Could not save prevRecord to DB. C${currentCycle} ${formatErrorMessage(er)}`)
    }

    // We are not always making it to this point. every 60s:
    // Print combined cycle log entry
    /* prettier-ignore */ if (logFlags.verbose) cycleLogger.info(CycleChain.getDebug() + NodeList.getDebug())

    /* prettier-ignore */ if (logFlags.verbose) info(`cc: recorded to cycle.log ${callTag}`)

    // Prune the cycle chain
    pruneCycleChain();

    /* prettier-ignore */ if (logFlags.verbose) info(`cc: pruned ${callTag}`)

    // Send last cycle record, state hashes and receipt hashes to any subscribed archivers
    Archivers.sendData();
    /* prettier-ignore */ if (logFlags.verbose) info(`cc: acrhiver data sent ${callTag}`) //todo list time delta

    let expectedCycle = currentCycle + 1;
    // this is where we update the current cycle
    ({ cycle: currentCycle, quarter: currentQuarter } = currentCycleQuarterByTime(prevRecord));

    if (expectedCycle !== currentCycle) {
      warn(`cc: expectedCycle: ${expectedCycle} currentCycle: ${currentCycle} ${callTag}`);
      /* prettier-ignore */ nestedCountersInstance.countEvent('p2p', `cycleCreator:expectedCycle !== currentCycle ex${expectedCycle}!=${currentCycle}} tag:${callTag}`)
    }

    /* prettier-ignore */ if (logFlags.verbose) info(`cc: current cycle and quarter updated C${currentCycle} Q${currentQuarter} ${callTag}`)

    const { quarterDuration, startQ1, startQ2, startQ3, startQ4, end } = calcIncomingTimes(prevRecord);

    nextQ1Start = end;

    // make some more logging .. posibly even to cycle log with a timestamp also.
    /* prettier-ignore */ if (logFlags.verbose) info(`cc: inc times ${Utils.safeStringify({ quarterDuration, startQ1, startQ2, startQ3, startQ4, end })}  ${callTag}`)

    // Reset cycle marker and cycle certificate creation state
    reset();

    /* prettier-ignore */ if (logFlags.verbose) info(`cc: cycle data was reset record.counter: ${record.counter}  ${callTag}`)

    // Omar moved this to before scheduling the quarters; should not make a difference
    madeCycle = false;

    // swapping out SafetyMode module for Modes if feature flag is true and if we haven't done it before
    if (config.p2p.useNetworkModes === true && modeModuleMigrationApplied === false) {
      modeModuleMigrationApplied = true;
      moduleMigration();
    }

    // I think once the network has reached to processing mode and some nodes drop to 10% and goes into safety mode
    // At this point, the new node might find that active count from previous record is still less than minNodes and would not flip hasAlreadyEnteredProcessing to true
    // I think we should flip hasAlreadyEnteredProcessing to true any mode other than forming in the previous record
    // using minNodes since this is dealing with going into processing mode. minNodes and baselineNodes are the same value at start
    if (prevRecord.active >= config.p2p.minNodes && hasAlreadyEnteredProcessing === false) {
      hasAlreadyEnteredProcessing = true;
    }
    const networkModeAfter = Modes.networkMode; // After applying new record
    if (networkModeBefore === 'recovery' && networkModeAfter === 'restore') {
      NodeList.changeNodeListInRestore(prevRecord.start);
    }

    if (prevRecord.mode === 'shutdown') {
      console.log(
        `❌ Shutdown mode activated at Cycle ${prevRecord.counter}. Exiting Network after ${prevRecord.duration}s.`
      );
      await utils.sleep(prevRecord.duration * SECOND);
      Self.emitter.emit('invoke-exit', 'Shutdown-Mode'); // Terminating the validator process
    }

    /* prettier-ignore */ if (logFlags.verbose) info(`cc: scheduling currentCycle:${currentCycle} ${callTag} ${startQ1}`)

    schedule(runQ1, startQ1, { runEvenIfLateBy: quarterDuration - 1 * SECOND }); // if there's at least one sec before Q2 starts, we can start Q1 now
    schedule(runQ2, startQ2);
    schedule(runQ3, startQ3);
    schedule(runQ4, startQ4);
    schedule(cycleCreator, end, { runEvenIfLateBy: Infinity });
  } finally {
    /* prettier-ignore */ if (logFlags.verbose) info( `cc: end C${currentCycle} Q${currentQuarter} madeCycle: ${madeCycle} bestMarker: ${bestMarker} ${callTag}` )
  }
}

// network:  |q1           |q2           |q3            |q4          |q1           |q2           |q3            |q4           |
//                                                                 r
//                                                                *
// us:   |q1           |q2           |q3            |q4          |q1           |q2           |q3            |q4           |

//      |                                                                                           |
//  |             2                                                             13              |

/**
 * Handles cycle record creation tasks for quarter 1
 */
async function runQ1() {
  q1SendRequests = false;
  currentQuarter = 1;
  Self.emitter.emit('cycle_q1_start');
  profilerInstance.profileSectionStart('CycleCreator-runQ1');

  if (logFlags.p2pNonFatal) info(`C${currentCycle} Q${currentQuarter}`);

  const SECOND = 1000;
  const cycleDuration = record.duration * SECOND;
  const quarterDuration = cycleDuration / 4;

  //we sleep for 1/8 of the quarter duration before we send messages to improve tolerance of
  //what cycle nodes think they are in
  await utils.sleep(quarterDuration * config.p2p.q1DelayPercent);

  //set this to true to allow other code that may be waiting for a safe time to send Q1 gossip
  //to proceed
  q1SendRequests = true;

  // Tell submodules to sign and send their requests
  if (logFlags.p2pNonFatal) info('Triggering submodules to send requests...');
  for (const submodule of submodules) submodule.sendRequests();

  profilerInstance.profileSectionEnd('CycleCreator-runQ1');
}

/**
 * Handles cycle record creation tasks for quarter 2
 */
function runQ2() {
  currentQuarter = 2;
  Self.emitter.emit('cycle_q2_start');
  if (logFlags.p2pNonFatal) info(`C${currentCycle} Q${currentQuarter}`);
}

/**
 * Handles cycle record creation tasks for quarter 3
 */
/*
  During Q1 and Q2 nodes build a list of valid txs they have seen.
  At the start of Q3 they generate a hash of all the txs they have seen.
  The cycle tx_hash is a hash of all the hashes of each valid tx
  the node has seen and validated. If the node is queried for the
  cycle_tx_hash it returns this even if sees and adds new txs to
  the list of txs the node has seen and validated.
  During Q3 the node does a robust query to get the most common
  cycle_tx_hash and queries the node that provided it to get the
  associated txs. The node validates these transactions and if
  any one of the txs is invalid it does not use what it got from
  the query. Otherwise as long as 2 or more nodes provided the
  cycle_tx_hash it switches to using this.
  Once the node has decided on the cycle_tx_hash it generates
  the a cycle_tx_hash_vote by signing the cycle_tx_hash and gossips
  that to other nodes. A node can only sign one cycle_tx_hash. If
  it tries to sign more than one it can be punished and all votes
  it submitted are ignored. The vote value is determined using
  XOR of the node_id hash and the cycle_tx_hash. A cycle_cert is
  created by combining the 3 highest value votes for a cycle_tx_hash.
  A node regossips if the gossip it received improved the value
  of the cert for the given cycle_tx_hash. The node regossips the
  all or up to the 3 best votes it has for the cycle tx_hash.
  The node also uses robust query to compare the best cycle_cert
  it has with other nodes.
*/
async function runQ3() {
  currentQuarter = 3;
  Self.emitter.emit('cycle_q3_start');
  if (logFlags.p2pNonFatal) info(`C${currentCycle} Q${currentQuarter}`);

  profilerInstance.profileSectionStart('CycleCreator-runQ3');
  // Get txs and create this cycle's record, marker, and cert
  txs = collectCycleTxs();
  ({ record, marker, cert } = makeCycleData(txs, CycleChain.newest));

  if (config.debug.enableCycleRecordDebugTool || config.debug.localEnableCycleRecordDebugTool) {
    if (currentQuarter === 3 && Self.isActive) {
      const cycleData =
        Utils.safeStringify({
          port: Self.port,
          cycleNumber: record.counter,
          cycleRecord: record,
        }) + '\n';
      fs.appendFile(filePath, cycleData, (err) => {
        if (err) {
          console.error('Error appending to file:', err);
        }
      });
    }
  }

  /* prettier-ignore */ if (logFlags && logFlags.verbose) console.log("cycle record: ", record)

  /*
  info(`
    Original cycle txs: ${JSON.stringify(txs)}
    Original cycle record: ${JSON.stringify(record)}
    Original cycle marker: ${JSON.stringify(marker)}
    Original cycle cert: ${JSON.stringify(cert)}
  `)
  */

  // Compare this cycle's marker with the network
  const myC = currentCycle;
  const myQ = currentQuarter;

  // Omar - decided that we can get by with not doing a round of compareCycleMarkers
  //     and instead going straight to comparing cycle certificates.
  /*
  const matched = await compareCycleMarkers(myC, myQ, DESIRED_MARKER_MATCHES)
  if (!matched){
    warn(`In Q3 no match from compareCycleMarker with DESIRED_MARKER_MATCHES of ${DESIRED_MARKER_MATCHES}`)
    return
  }
  if (cycleQuarterChanged(myC, myQ)){
    warn(`In Q3 ran out of time waiting for match from compareCycleMarker`)
    return
  }

  info(`
    Compared cycle txs: ${JSON.stringify(txs)}
    Compared cycle record: ${JSON.stringify(record)}
    Compared cycle marker: ${JSON.stringify(marker)}
    Compared cycle cert: ${JSON.stringify(cert)}
  `)
  */

  madeCycle = true;

  // Gossip your cert for this cycle with the network
  gossipMyCycleCert();

  profilerInstance.profileSectionEnd('CycleCreator-runQ3');
}

/**
 * Handles cycle record creation tasks for quarter 4
 */
async function runQ4() {
  currentQuarter = 4;

  if (logFlags.p2pNonFatal) info(`C${currentCycle} Q${currentQuarter}`);

  /* prettier-ignore */ info(`Q4: start: C${currentCycle} Q${currentQuarter}`)

  // Don't do cert comparison if you didn't make the cycle
  if (madeCycle === false) {
    warn('In Q4 nothing to do since we madeCycle is false.');
    return;
  }
  profilerInstance.profileSectionStart('CycleCreator-runQ4');

  // Compare your cert for this cycle with the network
  const myC = currentCycle;
  const myQ = currentQuarter;
  const enterTime = shardusGetTime();
  const cycleDuration = config.p2p.cycleDuration * SECOND;
  try {
    let matched;
    do {
      matched = await compareCycleCert(myC, myQ, DESIRED_CERT_MATCHES);
      if (!matched) {
        if (cycleQuarterChanged(myC, myQ)) {
          /* prettier-ignore */ warn( `In Q4 ran out of time waiting for compareCycleCert with DESIRED_CERT_MATCHES of ${DESIRED_CERT_MATCHES}` )
          profilerInstance.profileSectionEnd('CycleCreator-runQ4');
          return;
        }
        await utils.sleep(100);
        if (enterTime + cycleDuration < shardusGetTime()) {
          /* prettier-ignore */ warn( `In Q4 waited ${config.p2p.cycleDuration} seconds for compareCycleCert with DESIRED_CERT_MATCHES of ${DESIRED_CERT_MATCHES}` )
          //profilerInstance.profileSectionEnd('CycleCreator-runQ4')
          //return
          // we should return, but want to catch this get stuck to confirm it is not happening
          await utils.sleep(1000);
        }
      }
    } while (!matched);

    if (logFlags.p2pNonFatal)
      info(`
    Certified cycle record: ${Utils.safeStringify(record)}
    Certified cycle marker: ${Utils.safeStringify(marker)}
    Certified cycle cert: ${Utils.safeStringify(cert)}
  `);
  } finally {
    /* prettier-ignore */ info( `Q4: END: myC:${myC}  C${currentCycle} Q${currentQuarter} Certified cycle record: ${Utils.safeStringify(record.counter)}` )
    // Dont need this any more since we are not doing anything after this
    // if (cycleQuarterChanged(myC, myQ)) return
    profilerInstance.profileSectionEnd('CycleCreator-runQ4');
  }
}

/** HELPER FUNCTIONS */

export function makeRecordZero(): P2P.CycleCreatorTypes.CycleRecord {
  const txs = collectCycleTxs();
  return makeCycleRecord(txs, CycleChain.newest);
}

function makeCycleData(txs: P2P.CycleCreatorTypes.CycleTxs, prevRecord?: P2P.CycleCreatorTypes.CycleRecord) {
  const record = makeCycleRecord(txs, prevRecord);
  const marker = makeCycleMarker(record);
  const cert = makeCycleCert(marker);
  return { record, marker, cert };
}

function collectCycleTxs(): P2P.CycleCreatorTypes.CycleTxs {
  /* prettier-ignore */ if (logFlags.p2pNonFatal) console.log('collectCycleTxs: inside collectCycleTxs')
  // Collect cycle txs from all submodules
  const txs = submodules.map((submodule) => submodule.getTxs());
  return Object.assign({}, ...txs);
}

function makeCycleRecord(
  cycleTxs: P2P.CycleCreatorTypes.CycleTxs,
  prevRecord?: P2P.CycleCreatorTypes.CycleRecord
): P2P.CycleCreatorTypes.CycleRecord {
  const baseRecord: P2P.CycleCreatorTypes.BaseRecord = {
    networkId: prevRecord ? prevRecord.networkId : randomBytes(32),
    counter: prevRecord ? prevRecord.counter + 1 : 0,
    previous: prevRecord ? makeCycleMarker(prevRecord) : '0'.repeat(64),
    start:
      prevRecord && prevRecord.mode !== 'shutdown'
        ? prevRecord.start + prevRecord.duration
        : utils.getTime('s'),
    duration: prevRecord ? prevRecord.duration : config.p2p.cycleDuration,
    networkConfigHash: makeNetworkConfigHash(),
  };

  currentStart = baseRecord.start;

  const cycleRecord = Object.assign(baseRecord, {
    joined: [],
    returned: [],
    lost: [],
    lostSyncing: [],
    refuted: [],
    apoptosized: [],
    nodeListHash: '',
    archiverListHash: '',
    standbyNodeListHash: '',
    random: config.debug.randomCycleData ? Math.floor(Math.random() * 1000) + 1 : 0,
  }) as P2P.CycleCreatorTypes.CycleRecord;

  submodules.map((submodule) => submodule.updateRecord(cycleTxs, cycleRecord, prevRecord));
  //Updating Cycle Record if network has entered 'Shutdown' Mode
  if (config.p2p.initShutdown || cycleRecord.mode === 'shutdown') {
    console.log('Updating Shutdown Mode Cycle Record...');
    cycleRecord.removed = ['all'];
    cycleRecord.archiversAtShutdown = Array.from(Archivers.archivers.values());
  }

  return cycleRecord;
}

export function makeCycleMarker(record: P2P.CycleCreatorTypes.CycleRecord) {
  return crypto.hash(record);
}

function makeCycleCert(marker: P2P.CycleCreatorTypes.CycleMarker): P2P.CycleCreatorTypes.CycleCert {
  return crypto.sign({ marker });
}

function makeNetworkConfigHash() {
  netConfig = {
    crypto: config.crypto,
    heartbeatInterval: config.heartbeatInterval,
    loadDetection: config.loadDetection,
    network: config.network,
    rateLimiting: config.rateLimiting,
    sharding: config.sharding,
    transactionExpireTime: config.transactionExpireTime,
    p2p: { ...config.p2p },
    stateManager: config.stateManager,
    debug: config.debug,
  };
  delete netConfig.p2p.existingArchivers;
  return crypto.hash(netConfig);
}

function unseenTxs(ours: P2P.CycleCreatorTypes.CycleTxs, theirs: P2P.CycleCreatorTypes.CycleTxs) {
  const unseen: Partial<P2P.CycleCreatorTypes.CycleTxs> = {};

  for (const field in theirs) {
    if (theirs[field] && ours[field]) {
      if (crypto.hash(theirs[field]) !== crypto.hash(ours[field])) {
        // Go through each tx of theirs and see if ours has it
        const ourTxHashes = new Set(ours[field].map((tx) => crypto.hash(tx)));
        for (const tx of theirs[field]) {
          if (!ourTxHashes.has(crypto.hash(tx))) {
            // If it doesn't, add it to unseen
            if (!unseen[field]) unseen[field] = [];
            unseen[field].push(tx);
          }
        }
      }
    } else {
      // Add the whole field from theirs to unseen
      unseen[field] = theirs[field];
    }
  }

  return unseen;
}

function dropInvalidTxs(txs: Partial<P2P.CycleCreatorTypes.CycleTxs>) {
  // [TODO] Call into each module to validate its relevant CycleTxs
  return txs;
}

/**
 * Syncs the CycleChain to the newest cycle record of the network, and returns
 * the newest cycle record.
 */
async function fetchLatestRecord(): Promise<P2P.CycleCreatorTypes.CycleRecord> {
  try {
    const oldCounter = CycleChain.newest.counter;
    await syncNewCycles(NodeList.activeOthersByIdOrder);
    if (CycleChain.newest.counter <= oldCounter) {
      // We didn't actually sync
      /* prettier-ignore */ warn(`CycleCreator: fetchLatestRecord: synced record not newer CycleChain.newest.counter: ${CycleChain.newest.counter} oldCounter: ${oldCounter}`)
      fetchLatestRecordFails++;
      if (fetchLatestRecordFails > maxFetchLatestRecordFails) {
        /* prettier-ignore */ error( 'CycleCreator: fetchLatestRecord_A: fetchLatestRecordFails > maxFetchLatestRecordFails. apoptosizeSelf ' )
        // this.fatalLogger.fatal(
        //   'CycleCreator: fetchLatestRecord_A: fetchLatestRecordFails > maxFetchLatestRecordFails. apoptosizeSelf '
        // )
        nestedCountersInstance.countEvent(
          'fetchLatestRecord',
          `fetchLatestRecord_A fail and apop self. ${shardusGetTime()}`
        );
        Apoptosis.apoptosizeSelf('Apoptosized within fetchLatestRecord() => src/p2p/CycleCreator.ts');
      }

      return null;
    }
  } catch (err) {
    warn('CycleCreator: fetchLatestRecord: syncNewCycles failed:', errorToStringFull(err));
    fetchLatestRecordFails++;
    if (fetchLatestRecordFails > maxFetchLatestRecordFails) {
      /* prettier-ignore */ error( 'CycleCreator: fetchLatestRecord_B: fetchLatestRecordFails > maxFetchLatestRecordFails. apoptosizeSelf ' )
      // this.fatalLogger.fatal(
      //   'CycleCreator: fetchLatestRecord_B: fetchLatestRecordFails > maxFetchLatestRecordFails. apoptosizeSelf ',
      //   utils.formatErrorMessage(err)
      // )
      nestedCountersInstance.countEvent(
        'fetchLatestRecord',
        `fetchLatestRecord_B fail and apop self. ${shardusGetTime()}`
      );
      Apoptosis.apoptosizeSelf('Apoptosized within fetchLatestRecord() => src/p2p/CycleCreator.ts');
    }
    return null;
  }
  fetchLatestRecordFails = 0;
  return CycleChain.newest;
}

/**
 * Returns what the current cycle counter and quarter would be from the given
 * cycle record.
 *
 * @param record CycleRecord
 */
function currentCycleQuarterByTime(record: P2P.CycleCreatorTypes.CycleRecord) {
  const SECOND = 1000;
  const cycleDuration = record.duration * SECOND;
  const quarterDuration = cycleDuration / 4;
  const start = record.start * SECOND + cycleDuration;

  const now = shardusGetTime();
  const elapsed = now - start;
  const elapsedQuarters = elapsed / quarterDuration;

  const cycle = record.counter + 1 + Math.trunc(elapsedQuarters / 4);
  const quarter = Math.abs(Math.ceil(elapsedQuarters % 4));
  return { cycle, quarter };
}

/**
 * Returns the timestamp of each quarter and the timestamp of the end of the
 * cycle record AFTER the given cycle record.
 *
 * @param record CycleRecord
 */
export function calcIncomingTimes(record: P2P.CycleCreatorTypes.CycleRecord) {
  const cycleDuration = record.duration * SECOND;
  const quarterDuration = cycleDuration / 4;
  const start = record.start * SECOND + cycleDuration;

  const startQ1 = start;
  const startQ2 = start + 1 * quarterDuration;
  const startQ3 = start + 2 * quarterDuration;
  const startQ4 = start + 3 * quarterDuration;
  const end = start + cycleDuration;

  return { quarterDuration, startQ1, startQ2, startQ3, startQ4, end };
}

/**
 * Schedules a callback to run at a certain time. It will run the callback even
 * if its time has passed, as long as it has not gone past runEvenIfLateBy ms.
 *
 * @param callback
 * @param time
 * @param opts
 * @param args
 */
export function schedule<T, U extends unknown[]>(
  callback: (...args: U) => T | Promise<T>,
  time: number,
  { runEvenIfLateBy = 0 } = {},
  ...args: U
) {
  return new Promise<void>((resolve) => {
    const now = shardusGetTime();
    if (now >= time) {
      if (now - time <= runEvenIfLateBy) {
        setImmediate(async () => {
          await callback(...args);
          resolve();
        });
      }
      return;
    }
    const toWait = time - now;
    if (timers[callback.name]) clearTimeout(timers[callback.name]);
    timers[callback.name] = setTimeout(async () => {
      await callback(...args);
      resolve();
    }, toWait);
  });
}

export function shutdown() {
  warn('Cycle creator shutdown');
  for (const timer of Object.keys(timers)) {
    warn(`clearing timer ${timer}`);
    clearTimeout(timers[timer]);
  }
  warn(`current cycle and quarter is: C${currentCycle} Q${currentQuarter}`);
  currentCycle += 1;
  currentQuarter = 0; // to stop functions which check if we are in the same quarter
  warn(`changed cycle and quarter to: C${currentCycle} Q${currentQuarter}`);
}

function cycleQuarterChanged(cycle: number, quarter: number) {
  return cycle !== currentCycle || quarter !== currentQuarter;
}

function scoreCert(cert: P2P.CycleCreatorTypes.CycleCert): number {
  try {
    const id = NodeList.byPubKey.get(cert.sign.owner).id; // get node id from cert pub key
    const obj = { id };
    const hid = crypto.hash(obj); // Omar - use hash of id so the cert is not made by nodes that are near based on node id
    const out = utils.XOR(cert.marker, hid);
    return out;
  } catch (err) {
    error('scoreCert ERR:', err);
    return 0;
  }
}

function validateCertSign(certs: P2P.CycleCreatorTypes.CycleCert[], sender: P2P.NodeListTypes.Node['id']) {
  for (const cert of certs) {
    const cleanCert: P2P.CycleCreatorTypes.CycleCert = {
      marker: cert.marker,
      sign: cert.sign,
    };
    if (NodeList.byPubKey.has(cleanCert.sign.owner) === false) {
      warn('validateCertSign: bad owner');
      return false;
    }
    if (!crypto.verify(cleanCert)) {
      warn('validateCertSign: bad sig');
      return false;
    }
  }
  return true;
}

function validateCerts(certs: P2P.CycleCreatorTypes.CycleCert[], record, sender, callerTag) {
  if (!certs || !Array.isArray(certs) || certs.length <= 0) {
    /* prettier-ignore */ warn(`validateCerts: bad certificate format;  ${callerTag}`)
    /* prettier-ignore */ warn( `validateCerts:   sent by: port:${NodeList.nodes.get(sender).externalPort} id:${Utils.safeStringify(sender)}` )
    return false;
  }
  if (!record || record === null || typeof record !== 'object') return false;
  //  make sure the cycle counter is what we expect
  if (record.counter !== CycleChain.newest.counter + 1) {
    /* prettier-ignore */ warn( `validateCerts: bad cycle record counter; ${callerTag} expected ${CycleChain.newest.counter + 1} but got ${ record.counter } ` )
    /* prettier-ignore */ warn( `validateCerts:   sent by: port:${NodeList.nodes.get(sender).externalPort} id:${Utils.safeStringify(sender)}` )
    return false;
  }
  // make sure all the certs are for the same cycle marker
  const inpMarker = crypto.hash(record);
  for (let i = 1; i < certs.length; i++) {
    if (inpMarker !== certs[i].marker) {
      /* prettier-ignore */ warn(`validateCerts: certificates marker does not match hash of record;  ${callerTag}`)
      /* prettier-ignore */ warn( `validateCerts:   sent by: port:${NodeList.nodes.get(sender).externalPort} id:${Utils.safeStringify( sender )}` )
      return false;
    }
  }
  // make sure that the certs are from different owners and not the same node
  const seen = {};
  for (let i = 0; i < certs.length; i++) {
    if (seen[certs[i].sign.owner]) {
      /* prettier-ignore */ warn(`validateCerts: multiple certificate from same owner; ${callerTag} certs: ${Utils.safeStringify(certs)}`)
      /* prettier-ignore */ warn( `validateCerts:   sent by: port:${NodeList.nodes.get(sender).externalPort} id:${Utils.safeStringify( sender )}` )
      return false;
    }
    seen[certs[i].sign.owner] = true;
  }
  //  checks signatures; more expensive
  if (!validateCertSign(certs, sender)) {
    /* prettier-ignore */ warn(`validateCerts: certificate has bad sign;  ${callerTag} certs:${Utils.safeStringify(certs)}`)
    /* prettier-ignore */ warn( `validateCerts:   sent by: port:${NodeList.nodes.get(sender).externalPort} id:${Utils.safeStringify(sender)}` )
    return false;
  }
  return true;
}

function validateCertsRecordTypes(inp, caller) {
  let err = utils.validateTypes(inp, { certs: 'a', record: 'o' });
  if (err) {
    warn(caller + ' bad input: ' + err + ' ' + Utils.safeStringify(inp));
    return false;
  }
  for (const cert of inp.certs) {
    err = utils.validateTypes(cert, { marker: 's', score: 'n', sign: 'o' });
    if (err) {
      warn(caller + ' bad input.certs: ' + err);
      return false;
    }
    err = utils.validateTypes(cert.sign, { owner: 's', sig: 's' });
    if (err) {
      warn(caller + ' bad input.sign: ' + err);
      return false;
    }
  }
  err = utils.validateTypes(inp.record, {
    activated: 'a',
    activatedPublicKeys: 'a',
    active: 'n',
    apoptosized: 'a',
    counter: 'n',
    desired: 'n',
    duration: 'n',
    expired: 'n',
    joined: 'a',
    joinedArchivers: 'a',
    joinedConsensors: 'a',
    lost: 'a',
    previous: 's',
    refreshedArchivers: 'a',
    refreshedConsensors: 'a',
    refuted: 'a',
    removed: 'a',
    start: 'n',
    syncing: 'n',
  });
  if (err) {
    warn(caller + ' bad input.record: ' + err);
    return false;
  }
  //  submodules need to validate their part of the record
  for (const submodule of submodules) {
    err = submodule.validateRecordTypes(inp.record);
    if (err) {
      warn(caller + ' bad input.record.* ' + err);
      return false;
    }
  }
  return true;
}

// Given an array of valid cycle certs, go through them and see if we can improve our best cert
// return true if we improved it
// We assume the certs have already been checked
function improveBestCert(inpCerts: P2P.CycleCreatorTypes.CycleCert[], inpRecord) {
  //  warn(`improveBestCert: certs:${JSON.stringify(certs)}`)
  //  warn(`improveBestCert: record:${JSON.stringify(record)}`)
  let improved = false;
  if (inpCerts.length <= 0) {
    return false;
  }
  let bscore = 0;
  if (bestMarker) {
    if (bestCertScore.get(bestMarker)) {
      bscore = bestCertScore.get(bestMarker);
    }
  }
  //  warn(`improveBestCert: bscore:${JSON.stringify(bscore)}`)
  const bcerts = bestCycleCert.get(inpCerts[0].marker);
  //  warn(`improveBestCert: bcerts:${JSON.stringify(bcerts)}`)
  const have = {};
  if (bcerts) {
    for (const cert of bcerts) {
      have[cert.sign.owner] = true;
    }
  }
  //  warn(`improveBestCert: have:${JSON.stringify(have)}`)
  for (const cert of inpCerts) {
    // make sure we don't store more than one cert from the same owner with the same marker
    if (have[cert.sign.owner]) continue;
    cert.score = scoreCert(cert);
    if (!bestCycleCert.get(cert.marker)) {
      bestCycleCert.set(cert.marker, [cert]);
    } else {
      let added = false;
      const bcerts = bestCycleCert.get(cert.marker);
      let i = 0;
      for (; i < bcerts.length; i++) {
        if (bcerts[i].score < cert.score) {
          bcerts.splice(i, 0, cert);
          bcerts.splice(BEST_CERTS_WANTED);
          added = true;
          break;
        }
      }
      if (!added && i < BEST_CERTS_WANTED) {
        bcerts.splice(i, 0, cert);
      }
    }
  }
  for (const cert of inpCerts) {
    let score = 0;
    const bcerts = bestCycleCert.get(cert.marker);
    for (const bcert of bcerts) {
      score += bcert.score;
    }
    bestCertScore.set(cert.marker, score);
    if (score > bscore) {
      bestMarker = cert.marker;
      bestRecord = inpRecord;
      improved = true;
    }
  }
  //  info(`improveBestCert: bestScore:${bestCertScore.get(bestMarker)}`)
  //  info(`improveBestCert: bestMarker:${bestMarker}`)
  //  info(`improveBestCert: bestCerts:${JSON.stringify(bestCycleCert.get(bestMarker))}`)
  //  info(`improveBestCert: improved:${improved}`)
  return improved;
}

function compareCycleCertEndpoint(inp: CompareCertReq, sender, endpoint_tag: string) {
  if (bestMarker === undefined) {
    // This should almost never happen since we generate and gossip our
    //   cert at the begining of Q3 and don't start comparing certs until
    //   the begining of Q4.
    warn(`${endpoint_tag} - bestMarker is undefined`);
    return { certs: [], record: record }; // receiving node will igore our response
  }

  if (!validateCertsRecordTypes(inp, endpoint_tag)) {
    return { certs: bestCycleCert.get(bestMarker), record: bestRecord };
  }
  const { certs: inpCerts, record: inpRecord } = inp;
  if (!validateCerts(inpCerts, inpRecord, sender, endpoint_tag)) {
    return { certs: bestCycleCert.get(bestMarker), record: bestRecord };
  }
  const inpMarker = inpCerts[0].marker;
  if (inpMarker !== makeCycleMarker(inpRecord)) {
    return { certs: bestCycleCert.get(bestMarker), record: bestRecord };
  }
  improveBestCert(inpCerts, inpRecord);
  return { certs: bestCycleCert.get(bestMarker), record: bestRecord };
}

async function compareCycleCert(myC: number, myQ: number, matches: number) {
  const queryFn = async (node: P2P.NodeListTypes.Node): Promise<[CompareCertRes, P2P.NodeListTypes.Node]> => {
    const req: CompareCertReq = {
      certs: bestCycleCert.get(bestMarker),
      record: bestRecord,
    };

    // not enough data to start comparing
    if (!req.certs || !req.record) {
      return [null, node];
    }

    let resp: CompareCertRes;
    if (config.p2p.useBinarySerializedEndpoints && config.p2p.compareCertBinary) {
      let reqSerialized = req as CompareCertReqSerializable;
      resp = await Comms.askBinary<CompareCertReqSerializable, CompareCertRespSerializable>(
        node,
        InternalRouteEnum.binary_compare_cert,
        reqSerialized,
        serializeCompareCertReq,
        deserializeCompareCertResp,
        {}
      );
    } else {
      resp = await Comms.ask(node, 'compare-cert', req);
    }
    if (!validateCertsRecordTypes(resp, 'compareCycleCert')) return [null, node];
    if (!(resp && resp.certs && resp.certs[0].marker && resp.record)) {
      throw new Error('compareCycleCert: Invalid query response');
    }
    return [resp, node];
  };

  const compareFn = (respArr) => {
    /**
     * [IMPORTANT] Don't change things if the awaited call took too long
     */
    if (cycleQuarterChanged(myC, myQ)) return Comparison.ABORT;

    const [resp, node] = respArr;
    if (resp === null) return Comparison.WORSE;
    if (resp.certs[0].marker === bestMarker) {
      // Our markers match
      return Comparison.EQUAL;
    } else if (!validateCerts(resp.certs, resp.record, node.id, 'compareCycleCert')) {
      return Comparison.WORSE;
    } else if (improveBestCert(resp.certs, resp.record)) {
      // Their marker is better, change to it and their record
      // don't need the following line anymore since improveBestCert sets bestRecord if it improved
      // bestRecord = resp.record

      /* prettier-ignore */ nestedCountersInstance.countRareEvent('cycle', `improved cert (better node) ${node.internalIp}:${node.internalPort}`)
      nestedCountersInstance.countRareEvent('cycle', `improved cert (our node) ${Self.ip}:${Self.port}`);

      return Comparison.BETTER;
    } else {
      // Their marker was worse
      return Comparison.WORSE;
    }
  };

  // Make sure matches makes sense
  if (matches > NodeList.activeOthersByIdOrder.length) {
    matches = NodeList.activeOthersByIdOrder.length;
  }

  /**
   * [NOTE] The number of nodesToAsk should be limited based on the amount of
   * time we have in the quarter
   */
  // We shuffle to spread out the network load of cert comparison
  const nodesToAsk = [...NodeList.activeOthersByIdOrder];
  utils.shuffleArray(nodesToAsk);

  // If anything compares better than us, compareQuery starts over
  const errors = await compareQuery<P2P.NodeListTypes.Node, [CompareCertRes, P2P.NodeListTypes.Node]>(
    nodesToAsk,
    queryFn,
    compareFn,
    matches
  );

  if (errors.length > 0) {
    warn(`compareCycleCertEndpoint: errors: ${Utils.safeStringify(errors)}`);
  }

  // Anything that's not an error, either matched us or compared worse than us
  return NodeList.activeOthersByIdOrder.length - errors.length >= matches;
}

async function gossipMyCycleCert() {
  // If we're not active dont gossip, unless we are first
  if (!Self.isActive && !Self.isFirst) return;
  profilerInstance.profileSectionStart('CycleCreator-gossipMyCycleCert');
  // We may have already received certs from other other nodes so gossip only if our cert improves it
  // madeCert = true  // not used
  if (logFlags.p2pNonFatal) info('About to improveBestCert with our cert...');
  if (improveBestCert([cert], record)) {
    // don't need the following line anymore since improveBestCert sets bestRecord if it improved
    // bestRecord = record
    if (logFlags.p2pNonFatal) info('bestRecord was set to our record');
    await gossipCycleCert(Self.id);
  }
  profilerInstance.profileSectionEnd('CycleCreator-gossipMyCycleCert');
}

function gossipHandlerCycleCert(inp: CompareCertReq, sender: P2P.NodeListTypes.Node['id'], tracker: string) {
  profilerInstance.profileSectionStart('CycleCreator-gossipHandlerCycleCert');
  if (!validateCertsRecordTypes(inp, 'gossipHandlerCycleCert')) return;
  const { certs: inpCerts, record: inpRecord } = inp;
  if (!validateCerts(inpCerts, inpRecord, sender, 'gossipHandlerCycleCert')) {
    return;
  }
  if (improveBestCert(inpCerts, inpRecord)) {
    // don't need the following line anymore since improveBestCert sets bestRecord if it improved
    // bestRecord = inpRecord
    gossipCycleCert(sender, tracker);
  }
  profilerInstance.profileSectionEnd('CycleCreator-gossipHandlerCycleCert');
}

// This gossips the best cert we have
async function gossipCycleCert(sender: P2P.NodeListTypes.Node['id'], tracker?: string) {
  const certGossip: CompareCertReq = {
    certs: bestCycleCert.get(bestMarker),
    record: bestRecord,
  };
  const signedCertGossip = crypto.sign(certGossip);
  Comms.sendGossip(
    'gossip-cert',
    signedCertGossip,
    tracker,
    sender,
    nodeListFromStates([
      P2P.P2PTypes.NodeStatus.ACTIVE,
      P2P.P2PTypes.NodeStatus.READY,
      P2P.P2PTypes.NodeStatus.SYNCING,
    ]),
    true
  );
}

function pruneCycleChain() {
  if (config.p2p.useSyncProtocolV2) {
    CycleChain.prune(MAX_CYCLES_TO_KEEP);
  } else {
    // Determine number of cycle records to keep
    const keep = Refresh.cyclesToKeep();
    // Throws away extra cycles
    CycleChain.prune(keep);
  }
}

function info(...msg) {
  const entry = `CycleCreator: ${msg.join(' ')}`;
  p2pLogger.info(entry);
}

function warn(...msg) {
  const entry = `CycleCreator: ${msg.join(' ')}`;
  p2pLogger.warn(entry);
}

function error(...msg) {
  const entry = `CycleCreator: ${msg.join(' ')}`;
  p2pLogger.error(entry);
}
function fatal(...msg) {
  const entry = `CycleCreator: ${msg.join(' ')}`;
  p2pLogger.fatal(entry);
}
