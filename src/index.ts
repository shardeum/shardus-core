import { join } from 'path'
import merge from 'deepmerge'
import { readJsonDir } from './utils'
import Shardus from './shardus'
const defaultConfigs = {
  server: require('./config/server.json'),
  logs: require('./config/logs.json'),
  storage: require('./config/storage.json')
}

const overwriteMerge = (target, source, options) => source

function shardusFactory(configs = {}) {
  return new Shardus(
    merge(defaultConfigs, configs, { arrayMerge: overwriteMerge })
  )
}

export default shardusFactory
