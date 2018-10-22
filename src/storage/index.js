const path = require('path')
const sqlite = require('sqlite')

class Storage {
  constructor () {
    this.db = null
    this.initialized = false
  }

  /* Initilizes persistant storage.
   * Returns a promise that is resolved when storage is ready.
   */
  async init () {
    // Initialize the db with a 'storage' table
    this.db = await sqlite.open(path.join(__dirname, '/db.sqlite3'))
    let initTableQuery = `CREATE TABLE IF NOT EXISTS storage (
      key TEXT PRIMARY KEY,
      value BLOB
    )`
    await this.db.run(initTableQuery)
    this.initialized = true
  }

  /* Stores the given value with the given key into persistant storage.
   * Returns a promise that resolves when the store operation completes.
   */
  set (key, val) {
    if (!this.initialized) throw new Error('Storage not initialized.')
    let stringifiedVal = JSON.stringify(val)
    let setQuery = `INSERT OR REPLACE INTO storage (key, value) VALUES ('${key}', '${stringifiedVal}')`
    return this.db.run(setQuery)
  }

  /* Gets the value referenced by the given key from persistant storage.
   * Returns a promise that resolves to the value.
   */
  async get (key) {
    if (!this.initialized) throw new Error('Storage not initialized.')
    let getQuery = `SELECT value FROM storage WHERE key IS '${key}'`
    let result = await this.db.get(getQuery)
    if (result && result.value) return JSON.parse(result.value)
  }
}

module.exports = Storage
