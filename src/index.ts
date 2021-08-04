import merge from 'deepmerge'

import Shardus from './shardus'
import * as ShardusTypes from './shardus/shardus-types'

export { default as Shardus } from './shardus'
export { ShardusTypes }

const defaultConfigs = {
  server: require('./config/server.json'),
  logs: require('./config/logs.json'),
  storage: require('./config/storage.json'),
}

const overwriteMerge = (target, source, options) => source

export function shardusFactory(configs = {}) {
  return new Shardus(
    merge(defaultConfigs, configs, { arrayMerge: overwriteMerge })
  )
}
