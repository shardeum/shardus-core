const fs = require('fs')
const path = require('path')
const sqlite = require('sqlite')

class Storage {
  /* Expects config to have the properties:
   *   dbDir: <string> Directory that contains the database file.
   *   dbName: <string> Name of the database file.
   */
  constructor (config) {
    _parseConfig(config)
    this.config = config
    this.db = null
    this.initialized = false
  }

  /* Initilizes persistant storage.
   * Returns a promise that is resolved when storage is ready.
   */
  async init () {
    let { dbDir, dbName } = this.config
    await _ensureExists(dbDir)
    // Open or create the given db
    this.db = await sqlite.open(path.join(dbDir, dbName))
    // Create a 'storage' table if it doesn't exist
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
    if (!key || key === undefined) throw new Error('Key cannot be null or undefined.')
    if (val === undefined) throw new Error('Value cannot be undefined.')
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
    else throw new Error('Key does not exist.')
  }
}

function _parseConfig (config) {
  if (!config.dbDir) throw new Error('dbDir not provided in config.')
  if (!config.dbName) throw new Error('dbName not provided in config.')
  try {
    config.dbDir = path.resolve(config.dbDir)
  } catch (e) {
    throw new Error('Invalid dbDir provided.')
  }
}

// From: https://stackoverflow.com/a/21196961
async function _ensureExists (dir) {
  return new Promise((resolve, reject) => {
    fs.mkdir(dir, null, (err) => {
      if (err) {
        // Ignore err if folder exists
        if (err.code === 'EEXIST') resolve()
        // Something else went wrong
        else reject(err)
      } else {
        // Successfully created folder
        resolve()
      }
    })
  })
}

module.exports = Storage
