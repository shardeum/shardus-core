const { join, resolve } = require('path')
const { readJsonDir } = require('./utils')
import Shardus from './shardus'

const baseDirPath = resolve(process.argv[2] || './')

// if configs exist in baseDir, use them
// if not, use default configs
let config
try {
  config = readJsonDir(join(baseDirPath, 'config'))
  if (Object.keys(config).length === 0 && config.constructor === Object) throw new Error('Empty configs')
} catch (e) {
  config = readJsonDir(join(__dirname, 'config'))
}
config.server.baseDir = baseDirPath

const shardus = new Shardus(config)

async function init () {
  shardus.setup(null)
  await shardus.start()
  shardus.registerExceptionHandler()
}

init()
