import { EventEmitter } from 'events'
import {p2p as P2P} from './Wrapper'
import Crypto from '../crypto'
import Logger, {logFlags} from '../logger'
import { NetworkClass } from '../network'
import Shardus from '../shardus'
import {
  LogsConfiguration,
  ShardusConfiguration,
  StorageConfiguration,
} from '../shardus/shardus-types'
import StateManager from '../state-manager'
import Storage from '../storage'
import Reporter from '../reporter'

export type P2PModuleContext = typeof P2P

export let p2p: P2PModuleContext
export let logger: Logger
export let crypto: Crypto
export let network: NetworkClass
export let shardus: Shardus
export let stateManager: StateManager
export let storage: Storage
export let io
export let config: ShardusConfiguration
export let defaultConfigs: {
  server: ShardusConfiguration
  logs: LogsConfiguration
  storage: StorageConfiguration
}
export let reporter: Reporter

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

export function setStorageContext(context) {
  storage = context
}

export function setIOContext(context) {
  io = context
}

export function setReporterContext(context) {
  reporter = context
}

export function setConfig(conf) {
  config = conf
}

export function setDefaultConfigs(conf) {
  defaultConfigs = conf
}
