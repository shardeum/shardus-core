const test = require('tap').test
const path = require('path')
const { spawn } = require('child_process')

const { sleep } = require('../../../src/utils')
const ExitHandler = require('../../../src/exit-handler/index')

let exitHandler = new ExitHandler()
let obj = {
  syncCount: 0,
  asyncCount: 100
}

var addSync = function (o) {
  o.syncCount += 10
}

var addAsync = function (o) {
  return new Promise ((resolve, reject) => {
    setTimeout(() => {
      o.asyncCount += 100
      resolve(true)
    }, 500)
  })
}

var syncFn = new addSync(obj)
var asyncFn = new addAsync(obj)

// Testing registerAsync
test('should execute correctly a sync fn passed by the method registerSync', async t => {
  exitHandler.registerSync('module1', syncFn)
  exitHandler.syncFuncs['module1']
  t.equal(obj.syncCount, 10, 'obj.syncCout should be incremented by 10')
  t.end()
})

// Testing registerAsync
test('should execute correctly an async fn passed by the method registerAsync', async t => {
  exitHandler.registerAsync('module1', asyncFn)
  await exitHandler.asyncFuncs['module1']
  t.equal(obj.asyncCount, 200, 'obj.syncCout should be incremented by 100')
  t.end()
})

// Testing registerAsync
test('should run all fn defined in child-process.js after a graceful shutdown', async t => {
  let server = spawn('node', [path.join(__dirname, 'child-process.js')])
  let results = []
  server.stdout.on('data', (data) => results.push(data.toString().replace('\n', '')))
  await sleep(2000)
  t.equal(results.includes('1'), true, 'must include the result of 3 % 1 from the asyncFunc registered in child-process.js')
  t.equal(results.includes('4'), true, 'must include the result of 2 * 2 from the syncFunc registered in child-process.js')
  t.end()
})
