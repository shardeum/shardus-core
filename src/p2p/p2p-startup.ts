import P2P from '.';
import { EventEmitter } from 'events';
import utils from '../utils';

type P2PType = P2P & EventEmitter;

export interface ArchiverInfo {
  ip: string;
  port: number;
  publicKey: string;
}

export async function startup(context: P2PType): Promise<boolean> {
  // Emit the 'joining' event before attempting to join
  const publicKey = context.crypto.getPublicKey();
  context.mainLogger.debug('Emitting `joining` event.');
  context.emit('joining', publicKey);

  // Get new seednodes and attempt to join until you are successful
  let seedNodes: any[];
  let joined = false;
  // outerJoinAttemps is set to a high number incase we want to build a large network and need the node to keep trying to join for awhile.
  let outerJoinAttemps = 100;
  while (!joined) {
    seedNodes = await context._getSeedNodes();
    context.isFirstSeed = await context._discoverNetwork(seedNodes);

    // Remove yourself from seedNodes if you are present in them but not firstSeed
    const ourIpInfo = context.getIpInfo();
    if (context.isFirstSeed === false) {
      const ourIdx = seedNodes.findIndex(
        (node: { ip: any; port: any }) =>
          node.ip === ourIpInfo.externalIp &&
          node.port === ourIpInfo.externalPort
      );
      if (ourIdx > -1) {
        seedNodes.splice(ourIdx, 1);
      }
    }

    joined = await context._joinNetwork(seedNodes);
    if (joined === false) {
      context.mainLogger.debug(
        'join failed. outer attemps left: ' + outerJoinAttemps
      );
      // if we failed to join exit the flow
      outerJoinAttemps--;
      if (outerJoinAttemps <= 0) {
        context.mainLogger.debug(
          'join failed. no more outer join attempts left'
        );
        return false;
      }
    }
  }

  // Emit the 'joined' event before attempting to sync to the network
  context.mainLogger.debug('Emitting `joined` event.');
  context.emit('joined', context.id, publicKey);

  // Once joined, sync to the network
  await context._syncToNetwork(seedNodes);
  context.emit('initialized');
  return true;
}

export async function _getSeedNodes(context: P2PType) {
  const archiver: ArchiverInfo = context.existingArchivers[0];
  const seedListSigned = await context._getSeedListSigned();
  if (!context.crypto.verify(seedListSigned, archiver.publicKey)) {
    throw Error('Fatal: _getSeedNodes seed list was not signed by archiver!');
  }
  const joinRequest = seedListSigned.joinRequest;
  if (joinRequest) {
    if (context.archivers.addJoinRequest(joinRequest) === false) {
      throw Error(
        'Fatal: _getSeedNodes archivers join request not accepted by us!'
      );
    }
  }
  return seedListSigned.nodeList;
}

export async function _discoverNetwork(context: P2PType, seedNodes) {
  // Check if our time is synced to network time server
  try {
    const timeSynced = await context._checkTimeSynced(context.timeServers);
    if (!timeSynced) {
      context.mainLogger.warn('Local time out of sync with time server.');
    }
  } catch (e) {
    context.mainLogger.warn(e.message);
  }

  // Check if we are first seed node
  const isFirstSeed = context._checkIfFirstSeedNode(seedNodes);
  if (!isFirstSeed) {
    context.mainLogger.info('You are not the first seed node...');
    return false;
  }
  context.mainLogger.info('You are the first seed node!');
  return true;
}

export async function _joinNetwork(context: P2PType, seedNodes) {
  context.mainLogger.debug('Clearing P2P state...');
  await context.state.clear();

  // Sets our IPs and ports for internal and external network in the database
  await context.storage.setProperty(
    'externalIp',
    context.getIpInfo().externalIp
  );
  await context.storage.setProperty(
    'externalPort',
    context.getIpInfo().externalPort
  );
  await context.storage.setProperty(
    'internalIp',
    context.getIpInfo().internalIp
  );
  await context.storage.setProperty(
    'internalPort',
    context.getIpInfo().internalPort
  );

  if (context.isFirstSeed) {
    context.mainLogger.debug('Joining network...');

    // context is for testing purposes
    console.log('Doing initial setup for server...');

    const cycleMarker = context.state.getCurrentCycleMarker();
    const joinRequest = await context._createJoinRequest(cycleMarker);
    context.state.startCycles();
    context.state.addNewJoinRequest(joinRequest);

    // Sleep for cycle duration before updating status
    // TODO: Make context more deterministic
    await utils.sleep(
      Math.ceil(context.state.getCurrentCycleDuration() / 2) * 1000
    );
    const { nextCycleMarker } = context.getCycleMarkerInfo();
    context.mainLogger.debug(`Public key: ${joinRequest.nodeInfo.publicKey}`);
    context.mainLogger.debug(`Next cycle marker: ${nextCycleMarker}`);
    const nodeId = context.state.computeNodeId(
      joinRequest.nodeInfo.publicKey,
      nextCycleMarker
    );
    context.mainLogger.debug(
      `Computed node ID to be set for context node: ${nodeId}`
    );
    await context._setNodeId(nodeId);

    return true;
  }

  const nodeId = await context._join(seedNodes);
  if (!nodeId) {
    context.mainLogger.info('Unable to join network. Shutting down...');
    return false;
  }
  context.mainLogger.info('Successfully joined the network!');
  await context._setNodeId(nodeId);
  return true;
}

export async function _syncToNetwork(context: P2PType, seedNodes) {
  // If you are first node, there is nothing to sync to
  if (context.isFirstSeed) {
    context.mainLogger.info('No syncing required...');
    context.acceptInternal = true;
    return true;
  }

  // If not first seed, we need to sync to network
  context.mainLogger.info('Syncing to network...');

  // Get full node info for seed nodes
  context.mainLogger.debug('Fetching seed node info...');
  context.seedNodes = await context._fetchSeedNodesInfo(seedNodes);

  // Get hash of nodelist
  context.mainLogger.debug('Fetching nodelist hash...');
  const nodelistHash = await context._fetchNodelistHash(context.seedNodes);
  context.mainLogger.debug(`Nodelist hash is: ${nodelistHash}.`);

  // Get and verify nodelist aganist hash
  context.mainLogger.debug('Fetching verified nodelist...');
  const nodelist = await context._fetchVerifiedNodelist(
    context.seedNodes,
    nodelistHash
  );
  context.mainLogger.debug(`Nodelist is: ${JSON.stringify(nodelist)}.`);

  // Add retrieved nodelist to the state
  await context.state.addNodes(nodelist);

  // After we have the node list, we can turn on internal routes
  context.acceptInternal = true;

  context.mainLogger.debug('Fetching latest cycle chain...');
  const nodes = context.state.getActiveNodes();
  const { cycleChain, cycleMarkerCerts } = await context._fetchLatestCycleChain(
    context.seedNodes,
    nodes
  );
  context.mainLogger.debug(`Retrieved cycle chain: ${JSON.stringify(cycleChain)}`);
  try {
    await context.state.addCycles(cycleChain, cycleMarkerCerts);
  } catch (e) {
    context.mainLogger.error(
      '_syncToNetwork: ' + e.name + ': ' + e.message + ' at ' + e.stack
    );
    context.mainLogger.info('Unable to add cycles. Sync failed...');
    return false;
  }

  // Get in cadence, then start cycles

  // let firstTime = true

  const getUnfinalized = async () => {
    context.mainLogger.debug('Getting unfinalized cycle data...');
    let cycleMarker;
    try {
      cycleMarker = await context._fetchCycleMarkerInternal(
        context.state.getActiveNodes()
      );
    } catch (e) {
      context.mainLogger.warn(
        'Unable to get cycle marker internally from active nodes. Falling back to seed nodes...'
      );
      try {
        cycleMarker = await context._fetchCycleMarkerInternal(context.seedNodes);
      } catch (err) {
        context.mainLogger.error(
          '_syncToNetwork > getUnfinalized: Could not get cycle marker from seed nodes. Apoptosis then Exiting... ' +
            err
        );
        context.initApoptosis();
        process.exit();
      }
    }
    const { cycleStart, cycleDuration } = cycleMarker;
    const currentTime = utils.getTime('s');

    // First we wait until the beginning of the final quarter
    await context._waitUntilLastPhase(currentTime, cycleStart, cycleDuration);

    // Then we get the unfinalized cycle data
    let unfinalized;
    try {
      unfinalized = await context._fetchUnfinalizedCycle(
        context.state.getActiveNodes()
      );
    } catch (e) {
      context.mainLogger.warn(
        'Unable to get cycle marker internally from active nodes. Falling back to seed nodes...'
      );
      unfinalized = await context._fetchUnfinalizedCycle(context.seedNodes);
    }
    return unfinalized;
  };

  let unfinalized = null;

  // We keep trying to keep our chain and sync and try to get unfinalized cycle data until we are able to get the unfinalized data in time
  while (!unfinalized) {
    await context._syncUpChainAndNodelist();
    unfinalized = await getUnfinalized();
  }

  // We add the unfinalized cycle data and start cycles
  await context.state.addUnfinalizedAndStart(unfinalized);

  context.mainLogger.info('Successfully synced to the network!');
  return true;
}
