const test = require('tap').test
const fs = require('fs')
const path = require('path')

const Logger = require('../../../src/logger')
const Storage = require('../../../src/storage')
const Crypto = require('../../../src/crypto')
// const ExitHandler = require('../../../src/exit-handler')
// keeping legacy code that does not pass standard: unused var
const { clearTestDb, createTestDb } = require('../../includes/utils-storage')// eslint-disable-line

// let configFilePath = path.join(__dirname, '../../../config/logs.json')
let loggerConfig = {
  dir: '/logs',
  confFile: '/config/logs.json',
  files: {
    main: 'main.log',
    fatal: 'fatal.log',
    net: 'net.log'
  }
}

let logger = new Logger(path.resolve('./'), loggerConfig)
let confStorage = module.require(`../../../config/storage.json`)
// let newConfStorage = createTestDb(confStorage)
let storage = new Storage(
  logger,
  '../../../',
  { confFile: './config/storage.json' }
)
let crypto = new Crypto(logger, storage)

function isValidHex (str) {
  if (typeof str !== 'string') { return false }
  try {
    parseInt(str, 16)
  } catch (e) {
    return false
  }
  return true
}

function hex2bin (hex) {
  let bin = ''
  for (let i = 0; i < hex.length; i++) {
    bin += parseInt(hex[i], 16).toString(2).padStart(4, '0')
  }
  return bin
}

// testing the instance of crypto
test('Should instantiate the Crypto object correctly', async t => {
  t.equal(crypto instanceof Crypto, true, 'crypto should be an instance of Crypto')
  t.end()
})

// testing the init method
test('Should init the object correctly and store the key into the database', async t => {
  await storage.init()
  await crypto.init()
  const keys = { publicKey: crypto.keypair.publicKey, secretKey: crypto.keypair.secretKey }
  const storedKeys = await storage.getProperty('keypair')
  t.deepEqual(crypto.keypair, keys, 'The key object structure should be equal to this structure')
  t.deepEqual(storedKeys, crypto.keypair, 'The keypair should be stored in the database')
  t.end()
})

// testing _generateKeypair method
test('Should return a valid keypair from _generateKeypair', async t => {
  const keypair = crypto._generateKeypair()
  t.equal(isValidHex(keypair.publicKey), true, 'publicKey should be a valid hex')
  t.equal(isValidHex(keypair.secretKey), true, 'secretKey should be a valid hex')
  t.end()
})

let testTx = {
  src: '0'.repeat(64),
  tgt: crypto.keypair.publicKey,
  amt: 10
}

// testing sign method
test('Should sign an object correctly', async t => {
  const newObj = crypto.sign(testTx)
  t.notEqual(newObj.sign, null, 'the new signed object should have the propery sign')
  t.equal(isValidHex(newObj.sign.owner), true, 'the sign.owner property should be a valid hex')
  t.equal(isValidHex(newObj.sign.sig), true, 'the sign.sig property should be a valid hex')
  t.equal(crypto.keypair.publicKey, newObj.sign.owner, 'The sign.owner should be equal to the publicKey of the object')
  t.equal(testTx.sign, undefined, 'the used object should not be changed')
  t.end()
})

// testing verify method
test('Should verify a signed object correctly', async t => {
  const newObj = crypto.sign(testTx)
  try {
    t.equal(crypto.verify(newObj), true, 'the sign should be validated correctly')
  } catch (e) {
    t.fail('Invalid sign')
  }
  t.end()
})

// testing hash method
test('Should verify a signed object correctly', async t => {
  if (confStorage) {
    confStorage.options.storage = 'db/db.sqlite'
    fs.writeFileSync(path.join(__dirname, `../../../config/storage.json`), JSON.stringify(confStorage, null, 2))
    clearTestDb()
  }
  t.equal(isValidHex(crypto.hash(testTx)), true, 'should generate a valid hex from the hash of an object')
  t.end()
})

// testing ProofOfwork methods
test('Should compute a proof of work correctly', async t => {
  let seed = 'abc'
  let difficulty = 16
  let { nonce, hash } = await crypto.getComputeProofOfWork(seed, difficulty)
  let verifyHash = crypto.hash({ seed, nonce })
  t.equal(verifyHash, hash, 'returned hash should match independently computed hash')
  t.equal(parseInt(hex2bin(hash).substring(0, difficulty), 2), 0, 'returned hash should have at least difficulty number of leading 0 bits')
  t.end()
})
