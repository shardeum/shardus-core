const { createWriteStream } = require('fs')
const { Console } = require('console')
const { PassThrough } = require('stream')
const { join } = require('path')

function startSaving (baseDir) {
  // Create a file to save combined stdout and stderr output
  const outFileName = `out-${getTimestamp()}.txt`
  const outFile = createWriteStream(join(baseDir, outFileName))

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

/**
 * From https://stackoverflow.com/a/17415677
 * Returns the current datetime as a zoned ISO timestamp
 */
function getTimestamp () {
  const date = new Date()
  let pad = function (num) {
    let norm = Math.floor(Math.abs(num))
    return (norm < 10 ? '0' : '') + norm
  }
  return date.getFullYear() +
    '-' + pad(date.getMonth() + 1) +
    '-' + pad(date.getDate()) +
    'T' + pad(date.getHours()) +
    '-' + pad(date.getMinutes()) +
    '-' + pad(date.getSeconds()) +
    '-' + pad(date.getMilliseconds())
}
