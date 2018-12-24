const su = require('../../tools/server-start-utils')({
  baseDir: '../..',
  verbose: true,
  nodeUpTimeout: 120000
})

async function main () {
  await su.startServer(9001, 10001, 'active', null, false)
  console.log()

  await Promise.all([
    su.startServer(9002, 10002, 'active', null, false),
    su.startServer(9003, 10003, 'active', null, false)
  ])
}

main()
  .finally(() => {
    su.stopAllServers()
  })
