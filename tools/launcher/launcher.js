const vorpal = require('vorpal')()
const startUtils = require('../server-start-utils')('../..')

// start commands

vorpal
  .command('start [num]', 'Starts num servers from the default ports.')
  .action(async function (args) {
    let num = args.num || 1
    if (num > 1) {
      if (num > 20) { if (!await _confirm.call(this)) return }
      await startUtils.startServers(num)
    } else {
      await startUtils.startServer()
    }
  })

vorpal
  .command('start from <ports> <num>', 'Starts num servers from the given ports.')
  .action(async function (args) {
    let num = args.num
    if (num > 0) {
      if (num > 20) { if (!await _confirm.call(this)) return }
      let { extPort, intPort } = _parsePorts(args.ports)
      await startUtils.startServers(num, extPort, intPort)
    }
  })

vorpal
  .command('start on <ports...>', 'Starts servers on the given external/internal port/s.')
  .action(async function (args) {
    let promises = args.ports.map(pair => {
      let { extPort, intPort } = _parsePorts(pair)
      return startUtils.startServer(extPort, intPort)
    })
    await Promise.all(promises)
  })

vorpal
  .command('start all', 'Starts all stopped servers.')
  .action(async function (args) {
    await startUtils.startAllStoppedServers()
  })

// stop commands

vorpal
  .command('stop all', 'Stops all running servers.')
  .action(async function (args) {
    await startUtils.stopAllServers()
  })

vorpal
  .command('stop <ports...>', 'Stops the servers on the given external ports.')
  .action(async function (args) {
    let promises = args.ports.map(pair => {
      let { extPort } = _parsePorts(pair)
      return startUtils.stopServer(extPort)
    })
    await Promise.all(promises)
  })

// del commands

vorpal
  .command('del all', 'Stops and deletes all servers.')
  .action(async function (args) {
    await startUtils.deleteAllServers()
  })

vorpal
  .command('del <ports...>', 'Stops and deletes the servers on the given external ports.')
  .action(async function (args) {
    let promises = args.ports.map(pair => {
      let { extPort } = _parsePorts(pair)
      return startUtils.deleteServer(extPort)
    })
    await Promise.all(promises)
  })

// list command

vorpal
  .command('list', 'Lists all servers.')
  .action(function (args, cb) {
    let serverList = Object.values(startUtils.servers).map(server => {
      if (server.process) server.process = 'running'
      else server.process = 'stopped'
      return server
    })
    this.log(serverList)
    cb()
  })

vorpal
  .delimiter('launcher$')
  .show()

// Exit handlers for cleanup

process.on('SIGTERM', () => {
  startUtils.stopAllServers()
  process.exit()
})
process.on('SIGINT', () => {
  startUtils.stopAllServers()
  process.exit()
})
process.on('SIGHUP', () => {
  startUtils.stopAllServers()
  process.exit()
})
process.on('exit', () => {
  startUtils.stopAllServers()
})

// Utility fns

function _parsePorts (ports) {
  let [ extPort, intPort ] = ports.replace(',', '').split(':')
  extPort = Number(extPort) || null
  intPort = Number(intPort) || null
  return { extPort, intPort }
}

async function _confirm () {
  let resp = await this.prompt([{ type: 'input', name: 'sure', message: 'Are you sure? [y/N]:' }])
  return resp.sure.toLowerCase() === 'y'
}
