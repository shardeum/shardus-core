const { createWriteStream } = require('fs')
const { Console } = require('console')
const { PassThrough } = require('stream')
const { join } = require('path')

function startSaving(baseDir) {
  // Create a file to save combined stdout and stderr output
  const outFileName = `out.log`
  const outFile = createWriteStream(join(baseDir, outFileName), { flags: 'a' })

  // Create passthroughs that write to stdout, stderr, and the output file
  const outPass = new PassThrough()
  outPass.pipe(process.stdout)
  outPass.pipe(outFile)

  const errPass = new PassThrough()
  errPass.pipe(process.stderr)
  errPass.pipe(outFile)

  // Monkey patch the global console with a new one that uses our passthroughs
  console = new Console({ stdout: outPass, stderr: errPass }) // eslint-disable-line no-global-assign
}

exports.startSaving = startSaving
