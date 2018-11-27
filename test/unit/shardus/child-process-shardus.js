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
  switch (msg) {
    case ('getCycleMarkerInfo'):
      await shardus.setup(config)
      let cycleMarkerInfo
      let checkInterval = setInterval(async () => {
        cycleMarkerInfo = shardus.p2p.getCycleMarkerInfo()
        // console.log(cycleMarkerInfo)
        if (cycleMarkerInfo.cycleCounter === 1 || cycleMarkerInfo.cycleCounter > 1) { // wait until second cycle
          clearInterval(checkInterval)
          await sleep(5000)
          console.log('last cycle is...')
          console.log(shardus.p2p.state.getLastCycle())
          cycleMarkerInfo = shardus.p2p.getCycleMarkerInfo()
          let nodeAddress = shardus.p2p._getThisNodeInfo().address
          console.log(cycleMarkerInfo)
          clearInterval(checkInterval)
          process.send({ cycleMarkerInfo, nodeAddress })
        }
      }, 500)
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
    case ('_submitJoin'):
      await shardus.setup(config)
      const seedNodes = await shardus.p2p._getSeedNodes()
      const { currentCycleMarker } = await shardus.p2p._getNetworkCycleMarker(seedNodes)
      const joinRequest = await shardus.p2p._createJoinRequest(currentCycleMarker)
      await shardus.p2p._submitJoin(seedNodes, joinRequest)
      process.send({ joinRequest })
      break
    case ('shutdown'):
      await shardus.shutdown()
  }
})
