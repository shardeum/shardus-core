import { StrictShardusConfiguration } from '../shardus/shardus-types'
import LOGS_CONFIG from './logs'
import SERVER_CONFIG from './server'
import STORAGE_CONFIG from './storage'

const SHARDUS_CONFIG: StrictShardusConfiguration = {
  server: SERVER_CONFIG,
  logs: LOGS_CONFIG,
  storage: STORAGE_CONFIG,
}

export default SHARDUS_CONFIG
