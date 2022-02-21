import merge from 'deepmerge'

import Shardus from './shardus'
import * as ShardusTypes from './shardus/shardus-types'
import { compareObjShape } from './utils'

export { default as Shardus } from './shardus'
export { ShardusTypes }

const defaultConfigs = {
  server: require('./config/server.json'),
  logs: require('./config/logs.json'),
  storage: require('./config/storage.json'),
}

const overwriteMerge = (target, source, options) => source

export function shardusFactory(configs = {}) {
  const mergedConfigs = merge(defaultConfigs, configs, {
    arrayMerge: overwriteMerge,
  })

  if (!compareObjShape(defaultConfigs, mergedConfigs)) {
    throw Error(
      'Fatal: malformed config settings, unacceptable config object !!'
    )
  }

  return new Shardus(mergedConfigs)
}
