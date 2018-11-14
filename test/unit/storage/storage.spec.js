const { test } = require('tap')
// The sqlite require will be here until we find necessary to put into a separated util lib
// const sqlite = require('sqlite')
const fs = require('fs')
const path = require('path')

const Storage = require('../../../src/storage')
const Logger = require('../../../src/logger')

const { readLogFile, resetLogFile } = require('../../includes/utils-log')
const { clearTestDb, createTestDb } = require('../../includes/utils-storage')
// const { sleep } = require('../../../src/utils')

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../config/server.json')))
// const models = require('../../../src/storage/models')
let confStorage = module.require(`../../../config/storage.json`)
// let newConfStorage
let storage
let logger = new Logger(path.resolve('./'), config.log)

test('testing initialization property', async t => {
/*
  const failStorage = new Storage(
    logger,
    '../../../',
    { confFile: './config/storage.json' }
  )
*/
  try {
    // const res = await failStorage.listProperties()
    t.fail('Should throw an error')
  } catch (e) {
    t.pass('Should throw an error querying the db without being initialized')
  }
  t.end()
})

// Drop the database if exists and then test the init fn
test('testing init fn', async t => {
  // Don't need an additional defined scope
  // {
  try {
    // newConfStorage = createTestDb(confStorage)
    createTestDb(confStorage)
    resetLogFile()
    storage = new Storage(
      logger,
      '../../../',
      { confFile: './config/storage.json' }
    )
    await storage.init()
    const log = readLogFile('main')
    t.equal(log.includes('Database initialized.'), true, 'the logs should contain the msg of initialization')
  } catch (e) {
    t.threw(e)
  }
  // }
  t.end()
})

// testing set/get cycle methods
test('testing set and add methods for cycles model', async t => {
  let cycle, cycle2
  {
    cycle = {
      certificate: [ 'keyNode1', 'keyNode2' ],
      previous: '00000000',
      marker: 'marker1',
      counter: 1,
      time: Date.now(),
      active: 20,
      desired: 20,
      joined: [ 'new1', 'new2', 'new3' ],
      activated: [ 'activated1', 'activated2' ],
      removed: [ 'removed1', 'removed2' ],
      lost: [ 'lost1' ],
      returned: [ 'returned1' ]
    }
    cycle2 = {
      certificate: [ 'keyNode1', 'keyNode2' ],
      previous: 'marker1',
      marker: 'marker2',
      counter: 2,
      time: Date.now(),
      active: 20,
      desired: 20,
      joined: [ 'new1', 'new2', 'new3' ],
      activated: [ 'activated1', 'activated2' ],
      removed: [ 'removed1', 'removed2' ],
      lost: [ 'lost1' ],
      returned: [ 'returned1' ]
    }
    await storage.addCycles(cycle)
    const res = await storage.listCycles()
    await storage.addCycles(cycle2)
    await t.rejects(storage.addCycles(cycle2), null, 'should throw an error on uniqueKeyConstraint violation')
    t.deepEqual(res[0], cycle, 'should be equal the first element of res to the inserted cycle')
  }

  // Testing deleteByCounter
  {
    await storage.deleteCycleByCounter(cycle.counter)
    let res = await storage.getCycleByCounter(cycle.counter)
    t.notDeepEqual(cycle, res, 'Should assure the row was deleted correctly and its not returning by getCycleByCounter')
    res = await storage.getCycleByMarker(cycle.marker)
    t.notDeepEqual(cycle, res, 'Should assure the row was deleted correctly and its not returning by getCycleByMarker')
    res = await storage.listCycles()
    t.equal(res.length, 1, 'Should have just one row in the cycles table')
  }

  // Testing deleteByMarker
  {
    await storage.deleteCycleByMarker(cycle2.marker)
    let res = await storage.getCycleByCounter(cycle2.counter)
    t.notDeepEqual(cycle2, res, 'Should assure the row was deleted correctly and its not returning by getCycleByCounter')
    res = await storage.getCycleByMarker(cycle2.marker)
    t.notDeepEqual(cycle2, res, 'Should assure the row was deleted correctly and its not returning by getCycleByMarker')
    res = await storage.listCycles()
    t.equal(res.length, 0, 'Should have no row in the cycles table')
  }

  {
    let dummyCycle = {
      counter: 2,
      marker: 'marker2'
    }
    try {
      await storage.addCycles(dummyCycle)
      let res = await storage.getCycles(dummyCycle)
      t.fail(`should throw an error inserting an invalid cycle \n${JSON.stringify(res, null, 2)}`)
    } catch (e) {
      t.pass('should throw an error inserting an invalid cycle')
    }
  }

  t.end()
})

// testing set/get nodes methods
test('testing set and add methods for nodes model', async t => {
  let node
  {
    node = {
      id: '123456',
      internalIp: '192.168.0.100',
      externalIp: '200.20.55.11',
      internalPort: 9999,
      externalPort: 443,
      joinRequestTimestamp: Date.now(),
      address: 'a1b2c3e4f5'
    }
    await storage.addNodes(node)
    const res = await storage.getNodes(node)
    t.deepEqual(res[0], node, 'should be equal the first element of res to the inserted cycle')
    t.pass('passing')
  }

  {
    await storage.deleteNodes(node)
    let res = await storage.getNodes(node)
    t.notDeepEqual(node, res[0], 'Should assure the row was deleted correctly')
    res = await storage.listNodes()
    t.equal(res.length, 0, 'Should have a empty node list in the table nodes')
  }

  {
    let dummyNode = {
      ip: '300.300.300.300'
    }
    try {
      await storage.addNodes(dummyNode)
      t.fail('should throw an error inserting an invalid node')
    } catch (e) {
      t.pass('should throw an error inserting an invalid node')
    }
  }

  t.end()
})

// testing set/get properties methods
test('testing set and add methods for properties model', async t => {
  let property
  {
    property = {
      key: '123456',
      value: {
        ip: '8.8.8.8',
        port: 8080,
        nodes: [
          'node2key', 'node3key'
        ]
      }
    }
    await storage.setProperty(property.key, 'HELLOO')
    await storage.setProperty(property.key, property.value)
    const res = await storage.getProperty(property.key)
    t.deepEqual(res, property.value, 'should be equal the first element of res to the inserted cycle')
    t.pass('passing')
  }

  {
    await storage.deleteProperty(property.key)
    let res = await storage.getProperty(property.key)
    t.notDeepEqual(property.value, res, 'Should assure the row was deleted correctly')
    res = await storage.listProperties()
    t.equal(res.length, 0, 'Should have a empty property list in the table property')
  }

  // // testing listProperties
  // {
  //   let dummyProperty = {
  //     key: '111111',
  //     value: {
  //       value: 100
  //     }
  //   }
  //   await storage.setProperty(dummyProperty.key, dummyProperty.value)
  //   const res = await storage.listProperties()
  //   t.deepEqual(res[0], dummyProperty, 'Should have the inserted property returning from listProperties method')
  // }
  t.end()
})

// testing clear methods
test('testing clearP2pState method', async t => {
  let node = {
    id: '123456',
    internalIp: '192.168.0.100',
    externalIp: '200.20.55.11',
    internalPort: 9999,
    externalPort: 443,
    joinRequestTimestamp: Date.now(),
    address: 'a1b2c3e4f5'
  }
  let cycle = {
    certificate: [ 'keyNode1', 'keyNode2' ],
    previous: '00000000',
    marker: 'marker1',
    counter: 1,
    time: Date.now(),
    active: 20,
    desired: 20,
    joined: [ 'new1', 'new2', 'new3' ],
    activated: [ 'activated1', 'activated2' ],
    removed: [ 'removed1', 'removed2' ],
    lost: [ 'lost1' ],
    returned: [ 'returned1' ]
  }
  let cycle2 = {
    certificate: [ 'keyNode1', 'keyNode2' ],
    previous: 'marker1',
    marker: 'marker2',
    counter: 2,
    time: Date.now(),
    active: 20,
    desired: 20,
    joined: [ 'new1', 'new2', 'new3' ],
    activated: [ 'activated1', 'activated2' ],
    removed: [ 'removed1', 'removed2' ],
    lost: [ 'lost1' ],
    returned: [ 'returned1' ]
  }

  await storage.addNodes(node)
  await storage.addCycles([cycle, cycle2])

  let res
  res = await storage.getNodes(node)
  t.deepEqual(res, [node], 'getNodes should return [node]')
  res = await storage.listCycles()
  t.deepEqual(res, [cycle, cycle2], 'listCycles should return [cycle, cycle2]')

  await storage.clearP2pState()

  res = await storage.getNodes(node)
  t.deepEqual(res, [], 'getNodes should return []')
  res = await storage.listCycles()
  t.deepEqual(res, [], 'listCycles should return []')
  if (confStorage) {
    confStorage.options.storage = 'db/db.sqlite'
    fs.writeFileSync(path.join(__dirname, `../../../config/storage.json`), JSON.stringify(confStorage, null, 2))
    clearTestDb()
  }
  t.end()
})
