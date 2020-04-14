import { EventEmitter } from 'events'
import P2P from '.'
import Crypto from '../crypto'
import Logger from '../logger'
import { NetworkClass } from '../network'
import Shardus from '../shardus'
import StateManager from '../state-manager'
import { ShardusConfiguration } from '../shardus/shardus-types'

export type P2PModuleContext = P2P & EventEmitter

export let p2p: P2PModuleContext
export let logger: Logger
export let crypto: Crypto
export let network: NetworkClass
export let shardus: Shardus
export let stateManager: StateManager
export let config: ShardusConfiguration

export function setP2pContext(context: P2PModuleContext) {
  p2p = context
}

export function setLoggerContext(context) {
  logger = context
}

export function setCryptoContext(context) {
  crypto = context
}

export function setNetworkContext(context) {
  network = context
}

export function setShardusContext(context) {
  shardus = context
}

export function setStateManagerContext(context) {
  stateManager = context
}

export function setConfig (conf) {
  config = conf
}