const Shardus = require('./src/shardus')
const config = require('./config/server.json')

const shardus = new Shardus(config)

async function init () {
  await shardus.setup(config)
  shardus.registerExceptionHandler()
}

init()
