const execa = require('execa')
const { rm } = require('shelljs')
const { readFileSync } = require('fs')
const { join } = require('path')

const branch = process.argv[2]
if (!branch) {
  console.error('shardus-global-server-dist branch name required')
  process.exit(1)
}

// Rm dist/
console.log("Deleting './dist'...")
rm('-rf', './dist')
console.log('Done')
console.log()

// Clone server-dist to dist/ and checkout passed branch
execa.commandSync(
  'git clone https://gitlab.com/shardus/global/shardus-global-server-dist.git ./dist',
  { stdio: [0, 1, 2] }
)
execa.commandSync(`git checkout ${process.argv[2]}`, {
  cwd: './dist',
  stdio: [0, 1, 2],
})
console.log('Done')
console.log()

// Run build-dist
console.log("Running 'scripts/build-dist.js...'")
execa.commandSync('node scripts/build-dist.js', { stdio: [0, 1, 2] })
console.log()
