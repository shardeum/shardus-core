const execa = require('execa')
const { rm } = require('shelljs')

// Delete ./dist
rm('-rf', './dist')
console.log("Deleted './dist'")

// git clone https://gitlab.com/shardus/shardus-globla-server-dist.git ./dist
execa.commandSync('git clone https://gitlab.com/shardus/global/shardus-global-server-dist.git ./dist', { stdio: [0, 1, 2] })

// npm run webpack and build-compile
execa.commandSync('webpack', { stdio: [0, 1, 2] })
execa.commandSync('node scripts/build-compile.js', { stdio: [0, 1, 2] })

// cwd: ./dist; npm i
execa.commandSync('npm i', { cwd: './dist', stdio: [0, 1, 2] })
