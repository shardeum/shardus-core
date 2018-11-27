const path = require('path')
const merge = require('deepmerge')
const Shardus = require('./src/shardus')
const defaultConfig = require('./config/server.json')

defaultConfig.baseDir = path.join(__dirname, defaultConfig.baseDir)

module.exports = (config = {}) => new Shardus(merge(defaultConfig, config))
