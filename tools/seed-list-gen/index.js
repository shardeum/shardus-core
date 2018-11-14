const crypto = require('shardus-crypto-utils')
const config = require('./config.json')
const fs = require('fs')
const path = require('path')

let seedList
const outputFile = config.outFile
const keyFile = config.keypair
let keys

if (fs.existsSync(path.join(__dirname, config.inFile))) {
  seedList = JSON.parse(fs.readFileSync(path.join(__dirname, config.inFile)))
} else {
  seedList = null
}

// make sure there is a valid node list file
if (!seedList) throw Error('Seed node list not given in `inFile` field of config.json or the file is empty.')
if (!seedList.seedNodes) throw Error('seedNodes property is undefined in seed nodes list')

// Make sure there is a valid keypair
try {
  if (!fs.existsSync(keyfile)) throw Error('No valid keypair file found')
  keys = JSON.parse(fs.readFileSync(keyFile))
  if (!keys.publicKey || !keys.secretKey) throw new Error('Missing pk/sk in the keypair file')
} catch (e) {
  // If no valid keypair, create one and write it to the specified inFile,
  crypto('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')
  keys = crypto.generateKeypair()
  fs.writeFileSync(path.join(__dirname, keyFile), JSON.stringify(keys, null, 2))
  console.log(`New keypair has been generated and stored in ${keyFile} `)
} finally {
  // Sign seedList
  crypto.signObj(seedList, keys.secretKey, keys.publicKey)
  // Write JSONified signed seedList
  fs.writeFileSync(path.join(__dirname, outputFile), JSON.stringify(seedList, null, 2))
}
