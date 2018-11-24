const path = require('path')
const Shardus = require('../../../src/shardus')
const { sleep, getTime } = require('../../../src/utils')

let config = module.require(path.join(__dirname, '../../../config/server.json'))
config.baseDir = '.'
config.log.confFile = 'config/logs.json'
config.storage.confFile = './config/storage.json'
config.syncLimit = 100000

let shardus = new Shardus(config)

process.on('message', async (msg) => {
  switch (msg) {
    case ('getCycleMarkerInfo'):
      await shardus.setup(config)
      await sleep(Math.ceil(config.cycleDuration * 0.80) * 1000)
      let cycleMarkerInfo = shardus.p2p.getCycleMarkerInfo()
      let nodeAddress = shardus.p2p._getThisNodeInfo().address
      process.send({ cycleMarkerInfo, nodeAddress })
      break
    case ('getLatestCycles'):
      await shardus.setup(config)
      await sleep(Math.ceil(config.cycleDuration * 2.0) * 1000)
      let latestCycles = shardus.p2p.getLatestCycles(2)
      process.send({ latestCycles })
      break
    case ('_join'):
      await shardus.setup(config)
      await sleep(Math.ceil(config.cycleDuration * 0.1) * 1000)
      let joined = await shardus.p2p._join()
      process.send({ joined })
      break
    case ('_waitUntilJoinPhase'):
      await shardus.setup(config)
      let currentTime = getTime('s')
      let cycleStart = currentTime - 3
      let duration = config.cycleDuration
      await shardus.p2p._waitUntilJoinPhase(currentTime, cycleStart, duration)
      process.send({ message: 'done' })
      break
    case ('shutdown'):
      await shardus.shutdown()
  }
})
