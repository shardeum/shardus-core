import { Logger } from 'log4js'
import { logger } from '../Context'

export function initLogging(): void {
  p2pLogger = logger.getLogger('p2p')
}

let p2pLogger: Logger
export function getP2PLogger(): Logger {
  return p2pLogger
}

export function info(...msg: string[]): void {
  const entry = `Join: ${msg.join(' ')}`
  getP2PLogger().info(entry)
}

export function warn(...msg: string[]): void {
  const entry = `Join: ${msg.join(' ')}`
  getP2PLogger().warn(entry)
}

export function error(...msg: string[]): void {
  const entry = `Join: ${msg.join(' ')}`
  getP2PLogger().error(entry)
}
