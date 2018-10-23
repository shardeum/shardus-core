const path = require('path')
const Storage = require(path.resolve(__dirname, 'src/storage'))

;(async () => {
  let storage = new Storage({ dbDir: 'database/', dbName: 'db.sqlite3' })
  await storage.init()
  await storage.set('thing1', { a: 1, b: '2' })
  console.log(await storage.get('thing1'))
  await storage.set('thing2', [ 'abc', 123 ])
  console.log(await storage.get('thing2'))
  await storage.set('thing1', 'one more thing!')
  console.log(await storage.get('thing1'))
  try {
    console.log(await storage.get('nonExistantThing'))
  } catch (e) {
    console.log(e.message)
  }
})()
