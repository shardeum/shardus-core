import { join } from 'path'
import merge from 'deepmerge'
import { readJsonDir } from './utils'
import Shardus from './shardus'
const defaultConfigs = readJsonDir(join(__dirname, 'config'))

const overwriteMerge = (target, source, options) => source

function shardusFactory(configs = {}) {
  return new Shardus(
    merge(defaultConfigs, configs, { arrayMerge: overwriteMerge })
  )
}

export default shardusFactory
