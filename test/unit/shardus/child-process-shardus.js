const path = require('path')
const Shardus = require('../../../src/shardus')
const { sleep } = require('../../../src/utils')

let config = module.require(path.join(__dirname, '../../../config/server.json'))
config.baseDir = '.'
config.log.confFile = 'config/logs.json'
config.storage.confFile = './config/storage.json'
config.syncLimit = 100000

let shardus = new Shardus(config)

process.on('message', async (msg) => {
  if (msg === 'getCycleMarkerInfo') {
    await shardus.setup(config)
    await sleep(Math.ceil(config.cycleDuration * 0.80) * 1000)
    let cycleMarkerInfo = shardus.p2p.getCycleMarkerInfo()
    let nodeAddress = shardus.p2p._getThisNodeInfo().address
    process.send({ cycleMarkerInfo, nodeAddress })
  } else if (msg === 'shutdown') {
    process.exit()
  }
})
