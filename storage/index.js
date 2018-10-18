let path = require('path')
let sqlite3 = require('sqlite3').verbose()
let db = new sqlite3.Database(path.join(__dirname, '/db.sqlite3'))

// Initialize the db with a 'storage' table

let initTableQuery = `CREATE TABLE IF NOT EXISTS storage (
  key TEXT PRIMARY KEY,
  value BLOB
)`

db.serialize(function () {
  db.run(initTableQuery)
})

// Helpers to promisify the sqlite3 bindings

function promisify (fn, ...params) {
  return new Promise((resolve, reject) => {
    fn(...params, (err, resp) => {
      if (err) reject(err)
      if (resp) resolve(resp)
      else resolve()
    })
  })
}

db.runPromise = (...params) => promisify(db.run.bind(db), ...params)
db.getPromise = (...params) => promisify(db.get.bind(db), ...params)

// Exposed storage interface

/* Stores the given value with the given key into persistant storage.
 * Returns a promise that resolves when the store operation completes.
 */
exports.set = (key, val) => {
  let stringifiedVal = JSON.stringify(val)
  let setQuery = `INSERT OR REPLACE INTO storage (key, value) VALUES ('${key}', '${stringifiedVal}')`
  return db.runPromise(setQuery)
}

/* Gets the value referenced by the given key from persistant storage.
 * Returns a promise that resolves to the value.
 */
exports.get = async (key) => {
  let getQuery = `SELECT value FROM storage WHERE key IS '${key}'`
  let result = await db.getPromise(getQuery)
  return JSON.parse(result.value)
}
