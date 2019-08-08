const { join } = require('path')
const merge = require('deepmerge')
const { readJsonDir } = require('./src/utils')
const Shardus = require('./src/shardus')
const defaultConfigs = readJsonDir(join(__dirname, 'config'))

const overwriteMerge = (target, source, options) => source

function shardusFactory (configs = {}) {
  return new Shardus(merge(defaultConfigs, configs, { arrayMerge: overwriteMerge }))
}

module.exports = shardusFactory
