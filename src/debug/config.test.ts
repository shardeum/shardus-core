import SERVER_CONFIG from '../config/server'
import { setConfig } from '../p2p/Context'
import { ServerMode, StrictServerConfiguration } from '../shardus/shardus-types'
import { DebugConfigurations, isDebugMode, isDebugModeAnd } from './index'

test('debug > isDebugMode > Should return true if config mode is DEBUG', () => {
  const config = SERVER_CONFIG
  config.mode = ServerMode.Debug

  setConfig(config)

  const isDebug = isDebugMode()

  expect(isDebug).toBe(true)
})

test('debug > isDebugMode > Should return false if config mode is Release', () => {
  const config = SERVER_CONFIG
  config.mode = ServerMode.Release

  setConfig(config)

  const isDebug = isDebugMode()

  expect(isDebug).toBe(false)
})

test('debug > isDebugMode > Should default to false if config mode does not exist', () => {
  const config = {}

  setConfig(config as StrictServerConfiguration)

  const isDebug = isDebugMode()

  expect(isDebug).toBe(false)
})

test('debug > isDebugMode > Should default to false if config mode is not explicit', () => {
  const config = SERVER_CONFIG as any
  config.mode = 'blah'

  setConfig(config as StrictServerConfiguration)

  const isDebug = isDebugMode()

  expect(isDebug).toBe(false)
})

test('debug > isDebugModeAnd > Should run the predicate if config is debug mode', () => {
  const config = SERVER_CONFIG
  config.mode = ServerMode.Debug

  setConfig(config)

  const mockPredicate = jest.fn()

  isDebugModeAnd(mockPredicate)

  expect(mockPredicate).toHaveBeenCalled()
})

test('debug > isDebugModeAnd > Should NOT run the predicate if config is not debug mode', () => {
  const config = {}

  setConfig(config as StrictServerConfiguration)

  const mockPredicate = jest.fn()

  isDebugModeAnd(mockPredicate)

  expect(mockPredicate).not.toHaveBeenCalled()
})

test('debug > isDebugModeAnd > Should provide the debug configurations to the predicate', () => {
  const debugConfig = {}
  const config = SERVER_CONFIG as any
  config.mode = ServerMode.Debug
  config.debug = debugConfig

  setConfig(config)

  const mockPredicate = jest.fn()

  isDebugModeAnd(mockPredicate)

  expect(mockPredicate).toHaveBeenCalledWith(debugConfig)
})

test('debug > isDebugModeAnd > Should return true if predicate is true', () => {
  const config = SERVER_CONFIG
  config.mode = ServerMode.Debug

  setConfig(config)

  const result = isDebugModeAnd(() => true)

  expect(result).toEqual(true)
})

test('debug > isDebugModeAnd > Should return true if predicate is false', () => {
  const config = SERVER_CONFIG
  config.mode = ServerMode.Debug

  setConfig(config)

  const result = isDebugModeAnd(() => false)

  expect(result).toEqual(false)
})
