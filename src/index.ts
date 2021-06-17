import { join } from 'path'
import merge from 'deepmerge'
import { readJsonDir } from './utils'
import Shardus from './shardus'
export { default as Shardus } from './shardus'
import * as ShardusTypes from './shardus/shardus-types'
export {ShardusTypes}

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
