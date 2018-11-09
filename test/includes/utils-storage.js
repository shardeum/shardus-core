const path = require('path')
const fs = require('fs')

// copy the current conf file and then change to use a test db
function createTestDb (confStorage, newDb = null) {
  if (fs.existsSync(path.join(__dirname + '/../../db', '/db.test.sqlite'))) fs.unlinkSync(path.join(__dirname + '/../../db', '/db.test.sqlite'))
  let newConfStorage = Object.assign({}, confStorage)
  newConfStorage.options.storage = newDb ? newDb : 'db/db.test.sqlite'
  fs.writeFileSync(path.join(__dirname, `../../config/storage.json`), JSON.stringify(newConfStorage, null, 2))
  return newConfStorage
}

exports.createTestDb = createTestDb
