/* eslint-disable no-process-exit */
const execa = require('execa')

const branch = process.argv[2]
if (!branch) {
  console.error('shardus-global-server-dist branch name required')
  process.exit(1)
}

// Don't do this if 'shardus-global-server-dist' is already up to date
const shardusCommit = execa.commandSync('git rev-parse --short HEAD').stdout
const distCommitMsg = execa
  .commandSync('git log -1 --pretty=%B', { cwd: './dist' })
  .stdout.match(/commit ([\w\d]+) of/)
const distCommit = distCommitMsg ? distCommitMsg[1] : undefined
if (shardusCommit === distCommit) {
  console.log(
    `'shardus-global-server-dist#${branch}' (${distCommit}) already reflects the latest 'shardus-global-server' (${shardusCommit}) commit `
  )
  process.exit()
}

// Commit to server-dist
console.log(
  `Comitting and pushing to repo 'shardus-global-server-dist#${branch}'...`
)
execa.commandSync('git add .', { cwd: './dist', stdio: [0, 1, 2] })
const commit = execa.commandSync('git rev-parse --short HEAD').stdout
execa.sync(
  'git',
  [
    'commit',
    '-m',
    `Updated to reflect commit ${commit} of shardus-global-server.`,
  ],
  { cwd: './dist', stdio: [0, 1, 2] }
)
execa.commandSync('git push', { cwd: './dist', stdio: [0, 1, 2] })
console.log('Done')
