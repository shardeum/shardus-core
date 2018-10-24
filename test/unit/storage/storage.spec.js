const test = require('tap').test
// The sqlite require will be here until we find necessary to put into a separated util lib
const sqlite = require('sqlite')
const path = require('path')

const Storage = require('../../../src/storage/index')

let storage = new Storage({ dbDir: __dirname + '../../../../src/storage/', dbName: 'db.sqlite3' })
let key = '11223344'
let value = {
  name: 'Goku',
  level: 'SSJ Blue'
}

async function dropTable (table) {
  let db
  return new Promise (async (resolve, reject) => {
    try {
      db = await sqlite.open(path.join(__dirname + '/../../../src/storage', '/db.sqlite3'))
      let dropTableQuery = `DROP TABLE IF EXISTS ${table}`
      await db.run(dropTableQuery)
      db.close()
      resolve(true)
    } catch (e) {
      db.close()
      reject(e)
    }
  })
}

async function getAllFromTable (table) {
  let db
  return new Promise (async (resolve, reject) => {
    try {
      db = await sqlite.open(path.join(__dirname + '/../../../src/storage', '/db.sqlite3'))
      const query = `SELECT * FROM ${table}`
      const res = await db.get(query)
      db.close()
      resolve(res)
    } catch (e) {
      db.close()
      reject(e)
    }
  })
}

// Testing set fn
test('should throw an error when inserting something in a inexistent table', async t => {
  await dropTable('storage')
  try {
    const res = await storage.set(key, value)
    t.fail(res, 'This kind of insertion should throw an error')
  } catch (e) {
    t.notEqual(e, null, 'Should throw an error')
    t.end()
  }
})

// Testing get fn
test('should throw an error when getting something from a inexistent table', async t => {
  try {
    const res = await storage.get(key)
    t.fail(res, 'This kind of insertion should throw an error')
  } catch (e) {
    t.notEqual(e, null, 'Should throw an error')
    t.end()
  }
})

// Drop the database if exists and then test the init fn
test('testing init fn', async t => {
  try {
    await dropTable('storage')
    await storage.init()
    const res = await getAllFromTable('storage')
    t.equal(res, undefined, 'The results should be undefined because the table was dropped before init')
  } catch (e) {
    t.threw(e)
  }
  t.end()
})

// Testing set fn
test('create a basic (key, value) and test the set fn', async t => {
  const res = await storage.set(key, value)
  t.notEqual(res, undefined, 'The insertion should return a valid result')
  t.end()
})

// Testing get fn
test('uses the insertion from the previous test and test the get fn', async t => {
  const res = await storage.get(key)
  t.deepEqual(res, value, 'The value should be the exact from the previous test')
  t.end()
})

// Testing get fn
test('uses the insertion from the previous test and test the get fn', async t => {
  const res = await storage.get('aaaabbbb')
  t.deepEqual(res, null, 'Should return null for a inexistent key')
  t.end()
})

// Testing inserting a null key
test('create a basic (key, value) with key as null and test the set fn won\'t allow this kind of insertion', async t => {
  try {
    await storage.set(null, value)
    const res = await storage.get(null)
    t.fail('The insertion with a null key shouldn\'t be allowed')
  } catch (e) {
    t.end()
  }
})

// Testing inserting a null value
test('create a basic (key, value) with value as null and test the set fn won\'t allow this kind of insertion', async t => {
  const key2 = 'freeza'
  try {
    await storage.set(key2, undefined)
    const res = await storage.get(key2)
    t.fail('The insertion with a null value shouldn\'t be allowed')
  } catch (e) {
    t.end()
  }
})
