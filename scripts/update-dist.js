const execa = require('execa')
const { rm } = require('shelljs')
const { readFileSync } = require('fs')
const { join } = require('path')

// Rm dist/
console.log("Deleting './dist'...")
rm('-rf', './dist')
console.log('Done')
console.log()

// Clone server-dist to dist/ and checkout passed branch
rm('-rf', './dist')
const branch = process.argv[2]
if (!branch) {
  console.error('shardus-global-server-dist branch name required')
  process.exit(1)
}
execa.commandSync('git clone https://gitlab.com/shardus/global/shardus-global-server-dist.git ./dist', { stdio: [0, 1, 2] })
execa.commandSync(`git checkout ${process.argv[2]}`, { cwd: './dist', stdio: [0, 1, 2] })
console.log('Done')
console.log()

// Run build-dist
console.log("Running 'scripts/build-dist.js...'")
execa.commandSync('node scripts/build-dist.js', { stdio: [0, 1, 2] })
console.log()

// Don't do this if 'shardus-global-server-dist' is already up to date
const shardusCommit = execa.commandSync('git rev-parse --short HEAD').stdout
const distCommit = execa.commandSync('git log -1 --pretty=%B', { cwd: './dist' }).stdout.match(/commit ([\w\d]+) of/)[1]
if (shardusCommit === distCommit) {
  console.log(`'shardus-global-server-dist#${branch}' (${distCommit}) already reflects the latest 'shardus-global-server' (${shardusCommit}) commit `)
  process.exit()
}

// Commit to server-dist
console.log(`Comitting and pushing to repo 'shardus-global-server-dist#${branch}'...`)
execa.commandSync('git add .', { cwd: './dist', stdio: [0, 1, 2] })
const commit = execa.commandSync('git rev-parse --short HEAD').stdout
execa.sync('git', ['commit', '-m', `Updated to reflect commit ${commit} of shardus-global-server.`], { cwd: './dist', stdio: [0, 1, 2] })
execa.commandSync('git push', { cwd: './dist', stdio: [0, 1, 2] })
console.log('Done')