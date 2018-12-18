const { join } = require('path')
const merge = require('deepmerge')
const { readJsonDir } = require('./src/utils')
const Shardus = require('./src/shardus')
const defaultConfigs = readJsonDir(join(__dirname, 'config'))

function shardusFactory (configs = {}) {
  return new Shardus(merge(defaultConfigs, configs))
}

module.exports = shardusFactory
