import * as http from '../http';
import utils from '../utils';
import { Node, NodeInfo } from './p2p-types';
import { p2p } from './P2PContext';
import { sync } from './Sync';

/** STATE */

/** ROUTES */

export const internalRoutes = [
  {
    name: 'cyclechainhash',
    handler: async (payload, respond) => {
      if (!payload) {
        p2p.mainLogger.debug(
          'No payload provided with `cyclechainhash` request.'
        );
        await respond({
          cycleChainHash: null,
          error: 'no payload; start and end cycle required',
        });
        return;
      }
      p2p.mainLogger.debug(
        `Payload of request on 'cyclechainhash': ${JSON.stringify(payload)}`
      );
      if (payload.start === undefined || payload.end === undefined) {
        p2p.mainLogger.debug(
          'Start and end for the `cyclechainhash` request were not both provided.'
        );
        await respond({
          cycleChainHash: null,
          error: 'start and end required',
        });
        return;
      }
      const cycleChainHash = getCycleChainHash(payload.start, payload.end);
      p2p.mainLogger.debug(
        `Cycle chain hash to be sent: ${JSON.stringify(cycleChainHash)}`
      );
      if (!cycleChainHash) {
        await respond({
          cycleChainHash,
          error: 'invalid indexes for cycle chain hash',
        });
        return;
      }
      await respond({ cycleChainHash });
    },
  },
];

function getCycleChainHash(start, end) {
  p2p.mainLogger.debug(
    `Requested hash of cycle chain from cycle ${start} to ${end}...`
  );
  let cycleChain;
  try {
    cycleChain = p2p.getCycleChain(start, end);
  } catch (e) {
    return null;
  }
  const hash = p2p.crypto.hash({ cycleChain });
  p2p.mainLogger.debug(`Hash of requested cycle chain: ${hash}`);
  return hash;
}

/** FUNCTIONS */

export async function startup(): Promise<boolean> {
  // Emit the 'joining' event before attempting to join
  const publicKey = p2p.crypto.getPublicKey();
  p2p.mainLogger.debug('Emitting `joining` event.');
  p2p.emit('joining', publicKey);

  // Get new seednodes and attempt to join until you are successful
  let activeNodes: Node[];
  let joined = false;
  // outerJoinAttemps is set to a high number incase we want to build a large network and need the node to keep trying to join for awhile.
  let outerJoinAttemps = 100;
  let ourIpInfo;
  while (!joined) {
    activeNodes = await contactArchiver();
    p2p.isFirstSeed = await discoverNetwork(activeNodes);

    // Remove yourself from seedNodes if you are present in them but not firstSeed
    ourIpInfo = p2p.getIpInfo();
    if (p2p.isFirstSeed === false) {
      const ourIdx = activeNodes.findIndex(
        (node: { ip: any; port: any }) =>
          node.ip === ourIpInfo.externalIp &&
          node.port === ourIpInfo.externalPort
      );
      if (ourIdx > -1) {
        activeNodes.splice(ourIdx, 1);
      }
    }

    joined = await joinNetwork(activeNodes);
    if (joined === false) {
      p2p.mainLogger.debug(
        'join failed. outer attemps left: ' + outerJoinAttemps
      );
      // if we failed to join exit the flow
      outerJoinAttemps--;
      if (outerJoinAttemps <= 0) {
        p2p.mainLogger.debug('join failed. no more outer join attempts left');
        return false;
      }
    }
  }

  // Emit the 'joined' event before attempting to sync to the network
  p2p.mainLogger.debug('Emitting `joined` event.');
  p2p.emit('joined', p2p.id, publicKey);

  // Once joined, sync to the network
  // [AS] [TODO] [HACK] If you're node with port 9003, use the new sync
  if (ourIpInfo.externalPort === 9003) {
    await sync(activeNodes)
  } else {
    await syncToNetwork(activeNodes);
  }

  p2p.emit('initialized');
  return true;
}

async function contactArchiver() {
  const archiver: Node = p2p.existingArchivers[0];
  const activeNodesSigned = await getActiveNodesFromArchiver();
  if (!p2p.crypto.verify(activeNodesSigned, archiver.publicKey)) {
    throw Error('Fatal: _getSeedNodes seed list was not signed by archiver!');
  }
  const joinRequest = activeNodesSigned.joinRequest;
  if (joinRequest) {
    if (p2p.archivers.addJoinRequest(joinRequest) === false) {
      throw Error(
        'Fatal: _getSeedNodes archivers join request not accepted by us!'
      );
    }
  }
  const dataRequest = activeNodesSigned.dataRequest;
  if (dataRequest) {
    p2p.archivers.addDataRecipient(joinRequest.nodeInfo, dataRequest);
  }
  return activeNodesSigned.nodeList;
}

async function discoverNetwork(seedNodes) {
  // Check if our time is synced to network time server
  try {
    const timeSynced = await p2p._checkTimeSynced(p2p.timeServers);
    if (!timeSynced) {
      p2p.mainLogger.warn('Local time out of sync with time server.');
    }
  } catch (e) {
    p2p.mainLogger.warn(e.message);
  }

  // Check if we are first seed node
  const isFirstSeed = p2p._checkIfFirstSeedNode(seedNodes);
  if (!isFirstSeed) {
    p2p.mainLogger.info('You are not the first seed node...');
    return false;
  }
  p2p.mainLogger.info('You are the first seed node!');
  return true;
}

async function joinNetwork(seedNodes) {
  p2p.mainLogger.debug('Clearing P2P state...');
  await p2p.state.clear();

  // Sets our IPs and ports for internal and external network in the database
  await p2p.storage.setProperty('externalIp', p2p.getIpInfo().externalIp);
  await p2p.storage.setProperty('externalPort', p2p.getIpInfo().externalPort);
  await p2p.storage.setProperty('internalIp', p2p.getIpInfo().internalIp);
  await p2p.storage.setProperty('internalPort', p2p.getIpInfo().internalPort);

  if (p2p.isFirstSeed) {
    p2p.mainLogger.debug('Joining network...');

    // context is for testing purposes
    console.log('Doing initial setup for server...');

    const cycleMarker = p2p.state.getCurrentCycleMarker();
    const joinRequest = await p2p._createJoinRequest(cycleMarker);
    p2p.state.startCycles();
    p2p.state.addNewJoinRequest(joinRequest);

    // Sleep for cycle duration before updating status
    // TODO: Make context more deterministic
    await utils.sleep(
      Math.ceil(p2p.state.getCurrentCycleDuration() / 2) * 1000
    );
    const { nextCycleMarker } = p2p.getCycleMarkerInfo();
    p2p.mainLogger.debug(`Public key: ${joinRequest.nodeInfo.publicKey}`);
    p2p.mainLogger.debug(`Next cycle marker: ${nextCycleMarker}`);
    const nodeId = p2p.state.computeNodeId(
      joinRequest.nodeInfo.publicKey,
      nextCycleMarker
    );
    p2p.mainLogger.debug(
      `Computed node ID to be set for context node: ${nodeId}`
    );
    await p2p._setNodeId(nodeId);

    return true;
  }

  const nodeId = await p2p._join(seedNodes);
  if (!nodeId) {
    p2p.mainLogger.info('Unable to join network. Shutting down...');
    return false;
  }
  p2p.mainLogger.info('Successfully joined the network!');
  await p2p._setNodeId(nodeId);
  return true;
}

async function syncToNetwork(activeNodes: Node[]) {
  // If you are first node, there is nothing to sync to
  if (p2p.isFirstSeed) {
    p2p.mainLogger.info('No syncing required...');
    p2p.acceptInternal = true;
    return true;
  }

  // If not first node, we need to sync to network
  p2p.mainLogger.info('Syncing to network...');

  // Get full node info for active nodes
  p2p.mainLogger.debug('Fetching nodeinfo from active nodes...');
  const [nodeInfoResults, nodeInfoErrors] = await fetchNodeInfo(activeNodes);
  for (const err of nodeInfoErrors) {
    p2p.mainLogger.error('Fetch nodeinfo error: ' + err);
  }
  if (checkNodeInfos(nodeInfoResults) === false) {
    await abort(
      '_syncToNetwork > fetchNodeInfo failed. Apoptosis then restarting...'
    );
  }
  p2p.archiverActiveNodes = nodeInfoResults as NodeInfo[];

  // Get hash of nodelist
  p2p.mainLogger.debug('Fetching nodelist hash...');
  const nodelistHashResult = await fetchNodelistHash(p2p.archiverActiveNodes);
  p2p.mainLogger.debug(`Nodelist hash result is: ${nodelistHashResult}.`);
  if (checkNodelistHash(nodelistHashResult) === false) {
    await abort(
      '_syncToNetwork > fetchNodelistHash failed. Apoptosis then restarting...'
    );
  }
  const nodelistHash: string = nodelistHashResult;

  // Get and verify nodelist aganist hash
  p2p.mainLogger.debug('Fetching verified nodelist...');
  const nodelistResult = await fetchNodelist(
    p2p.archiverActiveNodes,
    nodelistHash
  );
  p2p.mainLogger.debug(`Nodelist result is: ${JSON.stringify(nodelistResult)}`);
  if (checkNodelist(nodelistResult) === false) {
    await abort(
      '_syncToNetwork > fetchNodelist failed. Apoptosis then restarting...'
    );
  }
  const nodelist = nodelistResult;

  // Add retrieved nodelist to the state
  await p2p.state.addNodes(nodelist);

  // After we have the node list, we can turn on internal routes
  p2p.acceptInternal = true;

  // Get latest cycle chain
  p2p.mainLogger.debug('Fetching latest cycle chain...');
  const nodes = p2p.state.getActiveNodes();
  const { cycleChain, cycleMarkerCerts } = await _fetchLatestCycleChain(
    p2p.archiverActiveNodes,
    nodes
  );
  p2p.mainLogger.debug(`Retrieved cycle chain: ${JSON.stringify(cycleChain)}`);
  try {
    await p2p.state.addCycles(cycleChain, cycleMarkerCerts);
  } catch (e) {
    p2p.mainLogger.error(
      '_syncToNetwork: ' + e.name + ': ' + e.message + ' at ' + e.stack
    );
    p2p.mainLogger.info('Unable to add cycles. Sync failed...');
    return false;
  }

  // Get in cadence, then start cycles
  const getUnfinalized = async () => {
    p2p.mainLogger.debug('Getting unfinalized cycle data...');
    let cycleMarker;
    try {
      cycleMarker = await p2p._fetchCycleMarkerInternal(
        p2p.state.getActiveNodes()
      );
    } catch (e) {
      p2p.mainLogger.warn(
        'Unable to get cycle marker internally from active nodes. Falling back to seed nodes...'
      );
      try {
        cycleMarker = await p2p._fetchCycleMarkerInternal(
          p2p.archiverActiveNodes
        );
      } catch (err) {
        p2p.mainLogger.error(
          '_syncToNetwork > getUnfinalized: Could not get cycle marker from seed nodes. Apoptosis then Exiting... ' +
            err
        );
        await p2p.initApoptosis();
        process.exit();
      }
    }
    const { cycleStart, cycleDuration } = cycleMarker;
    const currentTime = utils.getTime('s');

    // First we wait until the beginning of the final quarter
    await p2p._waitUntilLastPhase(currentTime, cycleStart, cycleDuration);

    // Then we get the unfinalized cycle data
    let unfinalized;
    try {
      unfinalized = await p2p._fetchUnfinalizedCycle(
        p2p.state.getActiveNodes()
      );
    } catch (e) {
      p2p.mainLogger.warn(
        'Unable to get cycle marker internally from active nodes. Falling back to seed nodes...'
      );
      unfinalized = await p2p._fetchUnfinalizedCycle(p2p.archiverActiveNodes);
    }
    return unfinalized;
  };

  let unfinalized = null;

  // We keep trying to keep our chain and sync and try to get unfinalized cycle data until we are able to get the unfinalized data in time
  while (!unfinalized) {
    await syncUpChainAndNodelist();
    unfinalized = await getUnfinalized();
  }

  // We add the unfinalized cycle data and start cycles
  await p2p.state.addUnfinalizedAndStart(unfinalized);

  p2p.mainLogger.info('Successfully synced to the network!');
  return true;
}

async function syncUpChainAndNodelist() {
  const nodes = p2p.state.getActiveNodes(p2p.isActive() ? p2p.id : null);
  const seedNodes = p2p.archiverActiveNodes;

  p2p.mainLogger.info('Syncing up cycle chain and nodelist...');

  const getCycleMarker = async () => {
    // Get current cycle counter
    let cycleMarker;
    try {
      cycleMarker = await p2p._fetchCycleMarkerInternal(nodes);
    } catch (e) {
      p2p.mainLogger.warn(
        'Could not get cycleMarker from nodes. Querying seedNodes for it...'
      );
      p2p.mainLogger.debug(e);
      try {
        cycleMarker = await p2p._fetchCycleMarkerInternal(seedNodes);
      } catch (err) {
        p2p.mainLogger.error(
          '_syncUpChainAndNodelist > getCycleMarkerSafely> getCycleMarker: Could not get cycleMarker from seedNodes. Apoptosis then Exiting... ' +
            err
        );
        await p2p.initApoptosis();
        process.exit();
      }
    }
    p2p.mainLogger.debug(
      `Fetched cycle marker: ${JSON.stringify(cycleMarker)}`
    );
    return cycleMarker;
  };

  // Gets cycle marker and ensures that we are not at the boundary of a cycle
  const getCycleMarkerSafely = async () => {
    let cycleMarker;
    let isInLastPhase = false;

    // We want to make sure we are not in the last phase, so we don't accidentally miss a cycle
    do {
      cycleMarker = await getCycleMarker();
      isInLastPhase = p2p._isInLastPhase(
        utils.getTime('s'),
        cycleMarker.cycleStart,
        cycleMarker.cycleDuration
      );
      if (!isInLastPhase) break;
      await p2p._waitUntilEndOfCycle(
        utils.getTime('s'),
        cycleMarker.cycleStart,
        cycleMarker.cycleDuration
      );
    } while (isInLastPhase);
    return cycleMarker;
  };

  const { cycleCounter } = await getCycleMarkerSafely();

  const lastCycleCounter = p2p.state.getLastCycleCounter();
  // If our last recorded cycle counter is one less than we currently see, we are synced up
  if (lastCycleCounter === cycleCounter - 1) return true;

  // We want to sync from the cycle directly after our current cycle, until the latest cycle
  const chainStart = lastCycleCounter + 1;
  const chainEnd = cycleCounter;

  const { cycleChain, cycleMarkerCerts } = await p2p._fetchFinalizedChain(
    seedNodes,
    nodes,
    chainStart,
    chainEnd
  );
  p2p.mainLogger.debug(`Retrieved cycle chain: ${JSON.stringify(cycleChain)}`);
  try {
    await p2p.state.addCycles(cycleChain, cycleMarkerCerts);
  } catch (e) {
    p2p.mainLogger.error(
      '_syncUpChainAndNodelist: ' + e.name + ': ' + e.message + ' at ' + e.stack
    );
    p2p.mainLogger.info('Unable to add cycles. Sync up failed...');
    throw new Error('Unable to sync chain. Sync up failed...');
  }

  // DEBUG: to trigger _fetchNodeByPublicKey()
  // const publicKey = p2pContext.seedNodes[0].publicKey
  // console.log(publicKey)
  // console.log(nodes)
  // const node = await p2pContext._fetchNodeByPublicKey(nodes, publicKey)

  // Check through cycles we resynced, gather all nodes we need nodeinfo on (by pubKey)
  // Also keep track of which nodes went active
  // Robust query for all the nodes' node info, and add nodes
  // Then go back through and mark all nodes that you saw as active if they aren't

  // TODO: Refactor: Consider if this needs to be done cycle by cycle or if it can just be done all at once
  const toAdd = [];
  const toSetActive = [];
  const toRemove = [];
  for (const cycle of cycleChain) {
    // If nodes joined in this cycle, add them to toAdd list
    if (cycle.joined.length) {
      for (const publicKey of cycle.joined) {
        toAdd.push(publicKey);
      }
    }

    // If nodes went active in this cycle, add them to toSetActive list
    if (cycle.activated.length) {
      for (const id of cycle.activated) {
        toSetActive.push(id);
      }
    }

    // If nodes were removed in this cycle, make sure to remove them
    if (cycle.removed.length) {
      for (const id of cycle.removed) {
        toRemove.push(id);
      }
    }
  }

  // We populate an array with all the queries we need to make for missing nodes
  p2p.mainLogger.debug(
    `Missed the following nodes joining: ${JSON.stringify(
      toAdd
    )}. Fetching their info to add to nodelist.`
  );
  const queries = [];
  for (const pubKey of toAdd) {
    queries.push(p2p._fetchNodeByPublicKey(nodes, pubKey));
  }
  // We try to get all the nodes that we missed in the given cycles
  const [results, errors] = await utils.robustPromiseAll(queries);
  // Then we add them one by one to our state
  for (const node of results) {
    await p2p.state.addNode(node);
  }
  // TODO: add proper error handling
  if (errors.length) {
    p2p.mainLogger.warn('Errors from _syncUpChainAndNodelist()!');
  }

  // After we finish adding our missing nodes, we try to add any active status updates we missed
  p2p.mainLogger.debug(
    `Missed active updates for the following nodes: ${JSON.stringify(
      toSetActive
    )}. Attempting to update the status for each one.`
  );
  for (const id of toSetActive) {
    await p2p.state.directStatusUpdate(id, 'active');
  }

  p2p.mainLogger.debug(
    `Missed removing the following nodes: ${JSON.stringify(
      toRemove
    )}. Attempting to remove each node.`
  );
  for (const id of toRemove) {
    const node = p2p.state.getNode(id);
    await p2p.state.removeNode(node);
  }
  const synced = await syncUpChainAndNodelist();
  return synced;
}

/** HELPER FUNCTIONS */

async function getActiveNodesFromArchiver() {
  const archiver = p2p.existingArchivers[0];
  const nodeListUrl = `http://${archiver.ip}:${archiver.port}/nodelist`;
  const nodeInfo = p2p.getPublicNodeInfo();
  const { nextCycleMarker: firstCycleMarker } = p2p.getCycleMarkerInfo();
  let seedListSigned;
  try {
    seedListSigned = await http.post(nodeListUrl, {
      nodeInfo,
      firstCycleMarker,
    });
  } catch (e) {
    throw Error(
      `Fatal: Could not get seed list from seed node server ${nodeListUrl}: ` +
        e.message
    );
  }
  p2p.mainLogger.debug(
    `Got signed seed list: ${JSON.stringify(seedListSigned)}`
  );
  return seedListSigned;
}

export async function fetchNodeInfo(activeNodes: Node[]) {
  const getNodeinfo = async (node: Node) => {
    const { nodeInfo }: { nodeInfo: NodeInfo } = await http.get(
      `${node.ip}:${node.port}/nodeinfo`
    );
    return nodeInfo;
  };
  const promises = activeNodes.map(node => getNodeinfo(node));
  return utils.robustPromiseAll(promises);
}
function checkNodeInfos(results: unknown): boolean {
  // [TODO] Check type
  if (exists(results)) {
    if (Array.isArray(results)) {
      if (results.length > 0) {
        if (results.every(() => true)) {
          // [TODO] Check range
          return true;
        }
      }
    }
  }
  return false;
}

async function fetchNodelistHash(nodes: NodeInfo[]) {
  const queryFn = async (node: NodeInfo) => {
    const { nodelistHash } = await p2p.ask(node, 'nodelisthash');
    return { nodelistHash };
  };
  try {
    const [response] = await p2p.robustQuery(nodes, queryFn);
    const { nodelistHash } = response;
    return nodelistHash;
  } catch (err) {
    p2p.mainLogger.error('fetchNodelistHash failed: ' + err);
    return undefined;
  }
}
function checkNodelistHash(results: unknown): boolean {
  // [TODO] Check type and range
  if (exists(results)) {
    return true;
  }
  return false;
}

async function fetchNodelist(nodes, nodelistHash) {
  const queryFn = async node => {
    const { nodelist } = await p2p.ask(node, 'nodelist');
    return { nodelist };
  };
  try {
    const verifyFn = nodelist => p2p._verifyNodelist(nodelist, nodelistHash);
    const { nodelist } = await p2p._sequentialQuery(nodes, queryFn, verifyFn);
    return nodelist;
  } catch (err) {
    p2p.mainLogger.error('fetchNodelistHash failed: ' + err);
    return undefined;
  }
}
function checkNodelist(results: unknown): boolean {
  // [TODO] Check type and range
  if (exists(results)) {
    return true;
  }
  return false;
}

async function _fetchLatestCycleChain(activeNodes, nodes) {
  // Remove archiver active nodes from nodes
  nodes = nodes.filter(
    node => !activeNodes.map(active => active.id).includes(node.id)
  );

  // Get current cycle counter
  let cycleCounter;
  try {
    ({ cycleCounter } = await p2p._fetchCycleMarkerInternal(nodes));
  } catch (e) {
    p2p.mainLogger.warn(
      'Could not get cycleMarker from nodes. Querying seedNodes for it...'
    );
    p2p.mainLogger.debug(e);
    try {
      ({ cycleCounter } = await p2p._fetchCycleMarkerInternal(activeNodes));
    } catch (err) {
      p2p.mainLogger.error(
        '_syncToNetwork > _fetchLatestCycleChain: Could not get cycleMarker from seedNodes. Apoptosis then Exiting... ' +
          err
      );
      await p2p.initApoptosis();
      process.exit();
    }
  }

  // Check for bad cycleCounter data
  if (!cycleCounter || cycleCounter < 0) {
    p2p.mainLogger.error(
      '_syncToNetwork > _fetchLatestCycleChain: Got bad cycleCounter. Apoptosis and Exiting...'
    );
    await p2p.initApoptosis();
    process.exit();
  }

  p2p.mainLogger.debug(`Fetched cycle counter: ${cycleCounter}`);

  // Determine cycle counter numbers to get, at most, the last 1000 cycles
  const chainEnd = cycleCounter;
  const desiredCycles = 1000;
  const chainStart =
    chainEnd -
    (cycleCounter < desiredCycles
      ? cycleCounter
      : cycleCounter - (desiredCycles - 1));

  // Get cycle chain hash
  let cycleChainHash;
  try {
    cycleChainHash = await _fetchCycleChainHash(nodes, chainStart, chainEnd);
  } catch (e) {
    p2p.mainLogger.warn(
      'Could not get cycleChainHash from nodes. Querying seedNodes for it...'
    );
    p2p.mainLogger.debug(e);
    try {
      cycleChainHash = await _fetchCycleChainHash(
        activeNodes,
        chainStart,
        chainEnd
      );
    } catch (err) {
      p2p.mainLogger.error(
        'syncToNetwork > _fetchLatestCycleChain: Could not get cycleChainHash from seed nodes. Apoptosis then Exiting... ' +
          err
      );
      await p2p.initApoptosis();
      process.exit();
    }
  }

  // Check for bad cycleChainHash data
  if (!cycleChainHash || cycleChainHash === '') {
    p2p.mainLogger.error(
      '_syncToNetwork > _fetchLatestCycleChain: Got bad cycleChainHash. Apoptosis and Exiting...'
    );
    await p2p.initApoptosis();
    process.exit();
  }

  p2p.mainLogger.debug(`Fetched cycle chain hash: ${cycleChainHash}`);

  // Get verified cycle chain
  let chainAndCerts;
  try {
    chainAndCerts = await p2p._fetchVerifiedCycleChain(
      nodes,
      cycleChainHash,
      chainStart,
      chainEnd
    );
  } catch (e) {
    p2p.mainLogger.warn(
      '_fetchLatestCycleChain: Could not get verified cycleChain from nodes. Querying seedNodes for it...'
    );
    p2p.mainLogger.debug(e);
    try {
      chainAndCerts = await p2p._fetchVerifiedCycleChain(
        activeNodes,
        cycleChainHash,
        chainStart,
        chainEnd
      );
    } catch (err) {
      p2p.mainLogger.error(
        'syncToNetwork > _fetchVerifiedCycleChain: Could not get cycleChainHash from seed nodes. Apoptosis then Exiting... ' +
          err
      );
      await p2p.initApoptosis();
      process.exit();
    }
  }

  // Check for bad chainAndCerts data
  if (
    !chainAndCerts ||
    Array.isArray(chainAndCerts) ||
    chainAndCerts.length < 1
  ) {
    p2p.mainLogger.error(
      '_syncToNetwork > _fetchLatestCycleChain: Got bad chainAndCerts. Apoptosis and Exiting...'
    );
    await p2p.initApoptosis();
    process.exit();
  }

  return chainAndCerts;
}

export async function _fetchCycleChainHash(nodes, start, end) {
  const queryFn = async node => {
    const { cycleChainHash } = await p2p.ask(node, 'cyclechainhash', {
      start,
      end,
    });
    return { cycleChainHash };
  };
  const [response] = await p2p.robustQuery(nodes, queryFn);
  const { cycleChainHash } = response;
  p2p.mainLogger.debug(
    `Result of robust query to fetch cycle chain hash: ${cycleChainHash}`
  );
  return cycleChainHash;
}

async function abort(message: string) {
  p2p.mainLogger.error(message);
  await p2p.initApoptosis();
  process.exit();
}

function exists(thing: unknown) {
  return thing !== null && typeof thing !== 'undefined';
}
