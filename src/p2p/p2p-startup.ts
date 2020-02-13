import { EventEmitter } from 'events';
import { Logger } from 'log4js';
import Crypto from '../crypto';

type id = string | null;

export async function startup(context: {
  mainLogger: Logger;
  crypto: Crypto;
  isFirstSeed: boolean;
  id: id;
  emit: EventEmitter['emit'];
  _getSeedNodes: () => any;
  _discoverNetwork: (arg0: any) => any;
  getIpInfo: () => any;
  _joinNetwork: (arg0: any) => boolean | PromiseLike<boolean>;
  _syncToNetwork: (arg0: any) => any;
}): Promise<boolean> {
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
        context.mainLogger.debug('join failed. no more outer join attempts left');
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
