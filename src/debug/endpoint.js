const express = require('express')
const app = express()
const path = require('path')
const tar = require('tar-fs')
const zlib = require('zlib')
const Trie = require('trie-prefix-tree')

const args = process.argv.slice(2)
const baseDir = args[0]
const ipInfo = JSON.parse(args[1])
const port = ipInfo.externalPort + 2000
const archiveName = `debug-${ipInfo.externalIp}-${ipInfo.externalPort}.tar.gz`
const files = {}

process.on('message', ({ src, dest }) => {
  addToArchive(src, dest)
})

function addToArchive (src, dest) {
  if (path.isAbsolute(dest)) console.log('DEBUG: "dest" must be a relative path.')
  src = path.isAbsolute(src) ? src : path.resolve(path.join(baseDir, src))
  files[src] = dest
}

function createArchiveStream () {
  const cwd = process.cwd()
  const filesRel = {}
  for (const src in files) {
    const srcRel = path.relative(cwd, src)
    const dest = files[src]
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

app.get('/debug', (req, res) => {
  const archive = createArchiveStream()
  const gzip = zlib.createGzip()
  res.set('content-disposition', `attachment; filename="${archiveName}"`)
  res.set('content-type', 'application/gzip')
  archive.pipe(gzip).pipe(res)
})

app.listen(port, () => console.log(`DEBUG: Debug server started on port ${port}`))
