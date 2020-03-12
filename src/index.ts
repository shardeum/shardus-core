import { join } from 'path'
const merge = require('deepmerge')
const { readJsonDir } = require('./utils')
import Shardus from './shardus'
const defaultConfigs = readJsonDir(join(__dirname, 'config'))

const overwriteMerge = (target, source, options) => source

function shardusFactory (configs = {}) {
  return new Shardus(merge(defaultConfigs, configs, { arrayMerge: overwriteMerge }))
}

export default shardusFactory
