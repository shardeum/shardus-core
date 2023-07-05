import { Console } from 'console'
import { PassThrough } from 'stream'
import { join } from 'path'
import { RollingFileStream } from 'streamroller'

export function startSaving(baseDir: string): void {
  // Create a file to save combined stdout and stderr output
  const outFileName = `out.log`
  const stream = new RollingFileStream(join(baseDir, outFileName), 10000000, 10)

  // Create passthroughs that write to stdout, stderr, and the output file
  const outPass = new PassThrough()
  outPass.pipe(process.stdout)
  outPass.pipe(stream)

  const errPass = new PassThrough()
  errPass.pipe(process.stderr)
  errPass.pipe(stream)

  // Monkey patch the global console with a new one that uses our passthroughs
  console = new Console({ stdout: outPass, stderr: errPass }) // eslint-disable-line no-global-assign
}
