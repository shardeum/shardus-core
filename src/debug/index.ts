import path from 'path'
import Network from '../network'
import zlib from 'zlib'
import Trie from 'trie-prefix-tree'
const tar = require('tar-fs')

interface Debug {
  baseDir: string
  network: Network
  archiveName: string
  files: {[name: string]: string}
}

class Debug {
  constructor (baseDir: string, network: Network) {
    this.baseDir = baseDir
    this.network = network
    this.archiveName = `debug-${network.ipInfo.externalIp}-${network.ipInfo.externalPort}.tar.gz`
    this.files = {}
    this._registerRoutes()
  }

  addToArchive (src, dest) {
    if (path.isAbsolute(dest)) throw new Error('"dest" must be a relative path.')
    src = path.isAbsolute(src) ? src : path.resolve(path.join(this.baseDir, src))
    this.files[src] = dest
  }

  createArchiveStream () {
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
      }
    })

    return pack
  }

  _registerRoutes () {
    this.network.registerExternalGet('debug', (req, res) => {
      const archive = this.createArchiveStream()
      const gzip = zlib.createGzip()
      res.set('content-disposition', `attachment; filename="${this.archiveName}"`)
      res.set('content-type', 'application/gzip')
      archive.pipe(gzip).pipe(res)
    })
  }
}

export default Debug
