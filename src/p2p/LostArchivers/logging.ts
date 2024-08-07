import { logger } from '../Context';
import { Logger } from 'log4js';

let p2pLogger: Logger;

export function initLogging(): void {
  p2pLogger = logger.getLogger('p2p');
}

export function info(...msg: unknown[]): void {
  const entry = `LostArchivers: ${msg.join(' ')}`;
  p2pLogger.info(entry);
}

export function warn(...msg: unknown[]): void {
  const entry = `LostArchivers: ${msg.join(' ')}`;
  p2pLogger.warn(entry);
}

export function error(...msg: unknown[]): void {
  const entry = `LostArchivers: ${msg.join(' ')}`;
  p2pLogger.error(entry);
}
