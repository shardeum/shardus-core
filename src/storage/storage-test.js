const Storage = require('./index.js')

let config = [
  'database',
  'username',
  'password',
  {
    host: 'localhost',
    dialect: 'sqlite',
    operatorsAliases: false,
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    },
    storage: 'db/db.sqlite'
  }
]

async function main () {
  let storage = new Storage(config)
  let keys = {
    publicKey: 'abc',
    secretKey: '123'
  }
  await storage.init()
  await storage.addKeypair(keys)
}
main()
