const fs = require('fs')
const path = require('path')
const tar = require('tar')

class Debug {
  constructor (baseDir, network) {
    this.baseDir = baseDir
    this.network = network
    this.archiveName = `debug-${network.ipInfo.externalIp}-${network.ipInfo.externalPort}.tar.gz`
    this.archiveFilePath = path.join(baseDir, this.archiveName)
    this.folders = []
    this.files = []
    this._registerRoutes()
  }

  addFolder (src, dest) {
    if (path.isAbsolute(dest)) throw new Error('"dest" must be a relative path.')
    src = path.isAbsolute(src) ? src : path.resolve(path.join(this.baseDir, src))
    this.folders.push([src, dest])
  }

  addFile (src, dest) {
    if (path.isAbsolute(dest)) throw new Error('"dest" must be a relative path.')
    src = path.isAbsolute(src) ? src : path.resolve(path.join(this.baseDir, src))
    this.files.push([src, dest])
  }

  async createArchive (output) {
    output = path.resolve(output)
    const tmpDir = output.replace(/\.tar\.gz/, '')
    const outputDir = tmpDir.split(path.sep).slice(0, -1).join(path.sep)

    for (const [src, dest] of this.folders) {
      const absoluteDest = path.resolve(path.join(tmpDir, dest))
      copyDirSync(src, absoluteDest)
    }
    for (const [src, dest] of this.files) {
      const absoluteDest = path.resolve(path.join(tmpDir, dest))
      fs.copyFileSync(src, absoluteDest)
    }

    await tar.create({ gzip: true, file: output, cwd: outputDir }, [path.relative(outputDir, tmpDir)])
    rimraf(tmpDir)
  }

  _registerRoutes () {
    this.network.registerExternalGet('debug', async (req, res) => {
      await this.createArchive(this.archiveFilePath)
      res.download(this.archiveFilePath, this.archiveName)
    })
  }
}

module.exports = Debug

function ensureExists (dir) {
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    // Ignore err if folder exists
    if (err.code !== 'EEXIST') {
      // Something else went wrong
      throw err
    }
  }
}

function copyDirSync (src, tgt) {
  ensureExists(tgt)
  const files = fs.readdirSync(src)
  for (const file of files) {
    const srcFilePath = path.join(src, file)
    const tgtFilePath = path.join(tgt, file)
    fs.lstatSync(srcFilePath).isDirectory() ? copyDirSync(srcFilePath, tgt) : fs.copyFileSync(srcFilePath, tgtFilePath)
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
