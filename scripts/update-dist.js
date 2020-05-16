const execa = require('execa')
const { rm } = require('shelljs')
const { readFileSync } = require('fs')
const { join } = require('path')

// Don't do this if 'shardus-global-server-dist' is already up to date
const shardusCommit = execa.commandSync('git rev-parse --short HEAD').stdout
const reflectedDistCommit = execa.commandSync('git log -1 --pretty=%B', { cwd: './dist' }).stdout.match(/commit ([\w\d]+) of/)[1]
if (shardusCommit === reflectedDistCommit) {
  console.log(`'shardus-global-server-dist' (${reflectedDistCommit}) already reflects the latest 'shardus-global-server' (${shardusCommit}) commit `)
  process.exit()
}

// npm run build
execa.commandSync('npm run build', { stdio: [0, 1, 2] })

// cwd: ./dist; git add .
execa.commandSync('git add .', { cwd: './dist', stdio: [0, 1, 2] })

// cwd: ./dist; git commit -m "Updated to reflect commit <COMMIT> of shardus-global-server."
const commit = execa.commandSync('git rev-parse --short HEAD').stdout
execa.sync('git', ['commit', '-m', `Updated to reflect commit ${commit} of shardus-global-server.`], { cwd: './dist', stdio: [0, 1, 2] })

// cwd: ./dist; git push
execa.commandSync('git push', { cwd: './dist', stdio: [0, 1, 2] })
