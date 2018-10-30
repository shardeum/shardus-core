const path = require('path')
const Shardus = require('../../../src/shardus')

let config = require(path.join(__dirname, '../../../config/server.json'))
// increase the timeSync limit to avoid issues in the test
config.syncLimit = 10000

let shardus = new Shardus(config)

async function init () {
  await shardus.setup(config)
  await shardus.shutdown()
}

init ()
