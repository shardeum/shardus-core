const fs = require('fs')
const path = require('path')
const tar = require('tar')

class Debug {
  constructor (baseDir, logger, storage, network) {
    this.network = network
    this.archiveName = `debug-${network.ipInfo.externalIp}-${network.ipInfo.externalPort}.tar.gz`
    this.archiveFilePath = path.join(baseDir, this.archiveName)
    this.logsDirPath = logger.logDir
    this.dbDirPath = path.parse(storage.storage.storageConfig.options.storage).dir
  }

  async init () {
    this._registerRoutes()
  }

  _registerRoutes () {
    this.network.registerExternalGet('debug', async (req, res) => {
      await createArchive({ output: this.archiveFilePath, logs: this.logsDirPath, db: this.dbDirPath })
      res.download(this.archiveFilePath, this.archiveName)
    })
  }
}

module.exports = Debug

async function createArchive ({ output, logs, db }) {
  output = path.resolve(output)
  logs = path.resolve(logs)
  db = path.resolve(db)

  const tmpDir = output.replace(/\.tar\.gz/, '')
  const outputDir = tmpDir.split(path.sep).slice(0, -1).join(path.sep)

  await copyDirSync(logs, path.join(tmpDir, 'logs'))
  await copyDirSync(db, path.join(tmpDir, 'db'))

  await tar.create({ gzip: true, file: output, cwd: outputDir }, [path.relative(outputDir, tmpDir)])

  rimraf(tmpDir)
}

async function ensureExists (dir) {
  return new Promise((resolve, reject) => {
    fs.mkdir(dir, { recursive: true }, (err) => {
      if (err) {
        // Ignore err if folder exists
        if (err.code === 'EEXIST') resolve()
        // Something else went wrong
        else reject(err)
      } else {
        // Successfully created folder
        resolve()
      }
    })
  })
}

async function copyDirSync (src, tgt) {
  await ensureExists(tgt)
  const files = fs.readdirSync(src)
  for (const file of files) {
    const srcFilePath = path.join(src, file)
    const tgtFilePath = path.join(tgt, file)
    fs.lstatSync(srcFilePath).isDirectory() ? await copyDirSync(srcFilePath, tgt) : fs.copyFileSync(srcFilePath, tgtFilePath)
  }
}

function rimraf (dir) {
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).forEach(function (entry) {
      var entryPath = path.join(dir, entry)
      if (fs.lstatSync(entryPath).isDirectory()) {
        rimraf(entryPath)
      } else {
        fs.unlinkSync(entryPath)
      }
    })
    fs.rmdirSync(dir)
  }
}
