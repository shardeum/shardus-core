const path = require('path')
const sqlite = require('sqlite')

let db = null
let initialized = false

/* Initilizes persistant storage.
 * Returns a promise that is resolved when storage is ready.
 */
exports.init = async () => {
  // Initialize the db with a 'storage' table
  db = await sqlite.open(path.join(__dirname, '/db.sqlite3'))
  let initTableQuery = `CREATE TABLE IF NOT EXISTS storage (
    key TEXT PRIMARY KEY,
    value BLOB
  )`
  await db.run(initTableQuery)
  initialized = true
}

/* Stores the given value with the given key into persistant storage.
 * Returns a promise that resolves when the store operation completes.
 */
exports.set = (key, val) => {
  if (!initialized) throw new Error('Storage not initialized.')
  let stringifiedVal = JSON.stringify(val)
  let setQuery = `INSERT OR REPLACE INTO storage (key, value) VALUES ('${key}', '${stringifiedVal}')`
  return db.run(setQuery)
}

/* Gets the value referenced by the given key from persistant storage.
 * Returns a promise that resolves to the value.
 */
exports.get = async (key) => {
  if (!initialized) throw new Error('Storage not initialized.')
  let getQuery = `SELECT value FROM storage WHERE key IS '${key}'`
  let result = await db.get(getQuery)
  return JSON.parse(result.value)
}
