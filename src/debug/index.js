const fs = require('fs')
const { join, resolve, parse } = require('path')
const archiver = require('archiver')

class Debug {
  constructor (baseDir, logger, storage, network) {
    this.network = network
    this.archiveName = `debug-${network.ipInfo.externalIp}-${network.ipInfo.externalPort}.zip`
    this.archiveFilePath = resolve(join(baseDir, this.archiveName))
    this.logsDirPath = logger.logDir
    this.dbDirPath = parse(storage.storage.storageConfig.options.storage).dir
  }

  async init () {
    this._registerRoutes()
  }

  _registerRoutes () {
    this.network.registerExternalGet('debug', async (req, res) => {
      await this._createArchive({ output: this.archiveFilePath, logs: this.logsDirPath, db: this.dbDirPath })
      res.download(this.archiveFilePath, this.archiveName)
    })
  }

  _createArchive ({ output, logs, db }) {
    return new Promise((resolve, reject) => {
      const archive = archiver('zip', { zlib: { level: 9 } })
      const stream = fs.createWriteStream(output)
      stream.on('close', resolve)
      archive.on('error', reject)
      archive.pipe(stream)
      archive.directory(logs, 'logs')
      archive.directory(db, 'db')
      archive.finalize()
    })
  }
}

module.exports = Debug
