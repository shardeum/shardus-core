const path = require('path')
const Shardus = require('./src/shardus')
const baseDirPath = process.argv[2]

let configPath = baseDirPath ? path.resolve(baseDirPath, 'config', 'server.json') : './config/server.json'
const config = require(configPath)

const shardus = new Shardus(config)

async function init () {
  await shardus.setup(config)
  shardus.registerExceptionHandler()
}

init()
