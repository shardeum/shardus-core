import path from 'path'
import { NetworkClass } from '../network'
import * as Context from '../p2p/Context'
import zlib from 'zlib'
import Trie from 'trie-prefix-tree'
import { isDebugModeMiddleware, isDebugModeMiddlewareMedium } from '../network/debugMiddleware'
import { nestedCountersInstance } from '../utils/nestedCounters'
const tar = require('tar-fs')
const fs = require('fs')

interface Debug {
  baseDir: string
  network: NetworkClass
  archiveName: string
  files: { [name: string]: string }
}

class Debug {
  constructor(baseDir: string, network: NetworkClass) {
    this.baseDir = baseDir
    this.network = network
    this.archiveName = `debug-${network.ipInfo.externalIp}-${network.ipInfo.externalPort}.tar.gz`
    this.files = {}
    this._registerRoutes()
  }

  addToArchive(src, dest) {
    if (path.isAbsolute(dest)) throw new Error('"dest" must be a relative path.')
    src = path.isAbsolute(src) ? src : path.resolve(path.join(this.baseDir, src))
    this.files[src] = dest
  }

  createArchiveStream() {
    const cwd = process.cwd()
    const filesRel = {}
    for (const src in this.files) {
      const srcRel = path.relative(cwd, src)
      const dest = this.files[src]
      filesRel[srcRel] = dest
    }
    const entries = Object.keys(filesRel)
    const trie = Trie(entries)
    const pack = tar.pack(cwd, {
      entries,
      map: function (header) {
        // Find the closest entry for this item
        let entry = header.name
        while (!trie.isPrefix(entry)) {
          entry = entry.slice(0, -1)
        }
        // Remove srcRel from header.name
        header.name = path.relative(entry, header.name)
        // Prefix dest to whatever remains
        const dest = filesRel[entry]
        header.name = path.normalize(path.join(dest, header.name))
        return header
      },
    })

    return pack
  }

  _registerRoutes() {
    this.network.registerExternalGet('debug', isDebugModeMiddlewareMedium, (req, res) => {
      const archive = this.createArchiveStream()
      const gzip = zlib.createGzip()
      res.set('content-disposition', `attachment; filename="${this.archiveName}"`)
      res.set('content-type', 'application/gzip')
      archive.pipe(gzip).pipe(res)
    })
    this.network.registerExternalGet('debug-logfile', isDebugModeMiddlewareMedium, (req, res) => {
      const requestedFile = req.query.file
      if (typeof requestedFile !== 'string' || !requestedFile) {
        return res.send({ success: false, error: 'Invalid file parameter' })
      }

      const normalizedFile = path.normalize(requestedFile).replace(/^(\.\.[/\\])+/, '')

      const logsAbsolutePath = Object.keys(this.files).find((key) => this.files[key] === './logs')
      if (!logsAbsolutePath) {
        return res.send({ success: false, error: 'Logs directory not found' })
      }

      const filePath = path.join(logsAbsolutePath, normalizedFile)
      if (!filePath.startsWith(logsAbsolutePath)) {
        return res.send({ success: false, error: 'File not found' })
      }

      res.set('Content-Disposition', `attachment; filename="${path.basename(normalizedFile)}"`)
      res.set('Content-Type', 'text/plain')

      const fileStream = fs.createReadStream(filePath)
      fileStream.on('error', (error) => {
        return res.send({ success: false, error: 'Error reading the file' })
      })
      fileStream.pipe(res)
    })
    this.network.registerExternalGet('debug-network-delay', isDebugModeMiddleware, (req, res) => {
      try {
        const delay =
          req.query.delay && typeof req.query.delay === 'string' ? parseInt(req.query.delay) : 120 * 1000
        this.network.setDebugNetworkDelay(delay)
      } catch (e) {
        return res.send({ success: false, error: e.message })
      }
      return res.send({ success: true })
    })
    this.network.registerExternalGet('debug-forcedExpiration', isDebugModeMiddleware, (req, res) => {
      try {
        const forcedExpiration =
          req.query.forcedExpiration && typeof req.query.forcedExpiration === 'string'
            ? req.query.forcedExpiration === 'true'
            : false
        Context.config.debug.forcedExpiration = forcedExpiration
        nestedCountersInstance.countEvent('debug', `forcedExpiration set to ${forcedExpiration}`)
      } catch (e) {
        return res.send({ success: false, error: e.message })
      }
      return res.send({ success: true })
    })
    this.network.registerExternalGet('debug-clearlog', isDebugModeMiddlewareMedium, (req, res) => {
      const requestedFile = req.query.file
      if (typeof requestedFile !== 'string' || !requestedFile) {
        return res.status(400).send({ success: false, error: 'Invalid file parameter' })
      }

      const logsAbsolutePath = Object.keys(this.files).find((key) => this.files[key] === './logs')
      if (!logsAbsolutePath) {
        return res.status(404).send({ success: false, error: 'Logs directory not found' })
      }

      try {
        if (requestedFile === 'all') {
          // Deletes all files in the directory
          const files = fs.readdirSync(logsAbsolutePath)
          for (const file of files) {
            fs.unlinkSync(path.join(logsAbsolutePath, file))
          }
        } else {
          // Deletes the specified file and its related files
          const normalizedFile = path.normalize(requestedFile).replace(/^(\.\.[/\\])+/, '')
          const baseFileName = path.basename(normalizedFile, path.extname(normalizedFile))
          const filePattern = new RegExp(`^${baseFileName}(\\d*)\\.log$`);

          const files = fs.readdirSync(logsAbsolutePath)
          const matchedFiles = files.filter((file) => filePattern.test(file))

          if (matchedFiles.length === 0) {
            return res.status(404).send({ success: false, error: 'File not found' })
          }

          for (const file of matchedFiles) {
            const filePath = path.join(logsAbsolutePath, file)
            if (filePath.startsWith(logsAbsolutePath) && fs.existsSync(filePath)) {
              fs.unlinkSync(filePath)
            }
          }
        }
        res.status(200).send({ success: true })
      } catch (error) {
        res.status(500).send({ success: false, error: `Error clearing log ${requestedFile}` })
      }
    })
  }
}

export default Debug
