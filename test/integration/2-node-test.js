const su = require('./tools/server-start-utils')({ verbose: true })

async function main () {
  su.startServers(2, null, null, 'id', null, false)
}
main()
