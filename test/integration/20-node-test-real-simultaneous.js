const su = require('../../tools/server-start-utils')({
  baseDir: '../..',
  verbose: true,
  nodeUpTimeout: 720000
})

async function main () {
  const promises = new Array(20).fill().map((curr, idx) => su.startServer(9001 + idx, 10001 + idx))
  try {
    await Promise.all(promises)
  } catch (e) {
    console.log(e)
  }
}

main()
