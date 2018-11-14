const test = require('tap').test
const Logger = require('../../../src/logger')
const { sleep } = require('../../../src/utils')
const path = require('path')
// const fs = require('fs')

const { readLogFile } = require('../../includes/utils-log')

let logger
let loggerConfig = {
  dir: '/logs',
  confFile: '/config/logs.json',
  files: {
    main: 'main.log',
    fatal: 'fatal.log',
    net: 'net.log'
  }
}

test('Create logger instance', t => {
  try {
    logger = new Logger(path.resolve('./'), loggerConfig)
    t.equal(logger instanceof Logger, true, 'Instanciated Logger')
  } catch (e) {
    t.fail(e)
  }
  t.end()
})

test('Create a debug log entry in main log', async t => {
  try {
    let logFileBefore = readLogFile('main')
    let logMessage = 'Log Test ' + Date.now()
    let logMain = logger.getLogger('main')
    logMain.info(logMessage)
    await sleep(100)
    let logFileAfter = readLogFile('main')
    if (!logFileAfter) {
      t.fail('Log file were not created')
    } else {
      if (logFileBefore) {
        t.equal(logFileAfter.split('\n').length > logFileBefore.split('\n').length, true, 'A line has been added to the main log')
      }
      t.equal(logFileAfter.includes(`${logMessage}`), true, `The log message has been added to the main log as [DEBUG]`)
    }
  } catch (e) {
    t.fail(e)
  }
  t.end()
})

test('Throw error when instantiate Logger with invalid argument', t => {
  try {
    // disable standard lint for line below becaues it expected
    let invalidLogger = new Logger(false, loggerConfig)// eslint-disable-line
    t.fail('Logger has instanciated with invalid "dir" argument')
  } catch (e) {
    t.pass('Prevent the instanciation of Logger with incorrect "dir" argument')
  }
  t.end()
})

test('Throw error when instantiate Logger with invalid "confFile" in config object', t => {
  try {
    // disable standard lint for line below becaues it expected
    let invalidLogger = new Logger('/', { confFile: false, ...loggerConfig })// eslint-disable-line
    t.fail('Logger has successfuly instanciated with invalid "confFile" argument')
  } catch (e) {
    t.pass('Prevent the instanciation of Logger with incorrect "confFile" argument in config object argument')
  }
  t.end()
})

test('Throw error when instantiate Logger with invalid "files" argument in confFile in config object', t => {
  try {
    // disable standard lint for line below becaues it expected
    let invalidLogger = new Logger('/', { files: '', ...loggerConfig })// eslint-disable-line
    t.fail('Logger has successfuly instanciated with invalid "files" argument')
  } catch (e) {
    t.pass('Prevent the instanciation of Logger with incorrect "files" argument in config object argument')
  }
  t.end()
})

test('Throw error when instantiate Logger with a "confFile" argument for a file that doesn\'t exists', t => {
  try {
    // disable standard lint for line below becaues it expected
    let invalidLogger = new Logger('/', { confFile: 'config.json', ...loggerConfig })// eslint-disable-line
    t.fail('Logger has successfuly instanciated with a "confFile" argument for a file that doesn\'t exists')
  } catch (e) {
    t.pass('Prevent the instanciation of Logger with a "confFile" argument for a file that doesn\'t exists')
  }
  t.end()
})

test('Throw error when trying to log to an non-valid target', t => {
  try {
    let logger = new Logger('/', loggerConfig)
    logger.log('Invalid log', 'invalid', 'debug')
    t.fail('Logger has successfuly instanciated with a "confFile" argument for a file that doesn\'t exists')
  } catch (e) {
    t.pass('Prevent the instanciation of Logger with a "confFile" argument for a file that doesn\'t exists')
  }
  t.end()
})
