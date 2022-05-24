import { StrictLogsConfiguration } from '../shardus/shardus-types'

const LOGS_CONFIG: StrictLogsConfiguration = {
  saveConsoleOutput: true,
  dir: 'logs',
  files: { main: '', fatal: '', net: '', app: '' },
  options: {
    appenders: {
      out: { type: 'console' },
      main: { type: 'file', maxLogSize: 10000000, backups: 10 },
      app: { type: 'file', maxLogSize: 10000000, backups: 10 },
      p2p: { type: 'file', maxLogSize: 10000000, backups: 10 },
      snapshot: { type: 'file', maxLogSize: 10000000, backups: 10 },
      cycle: { type: 'file', maxLogSize: 10000000, backups: 10 },
      fatal: { type: 'file', maxLogSize: 10000000, backups: 10 },
      errorFile: { type: 'file', maxLogSize: 10000000, backups: 10 },
      errors: { type: 'logLevelFilter', level: 'ERROR', appender: 'errorFile' },
      net: { type: 'file', maxLogSize: 10000000, backups: 10 },
      playback: { type: 'file', maxLogSize: 10000000, backups: 10 },
      shardDump: { type: 'file', maxLogSize: 10000000, backups: 10 },
      statsDump: { type: 'file', maxLogSize: 10000000, backups: 10 },
    },
    categories: {
      default: { appenders: ['out'], level: 'trace' },
      app: { appenders: ['app', 'errors'], level: 'trace' },
      main: { appenders: ['main', 'errors'], level: 'trace' },
      p2p: { appenders: ['p2p'], level: 'trace' },
      snapshot: { appenders: ['snapshot'], level: 'trace' },
      cycle: { appenders: ['cycle'], level: 'trace' },
      fatal: { appenders: ['fatal'], level: 'fatal' },
      net: { appenders: ['net'], level: 'trace' },
      playback: { appenders: ['playback'], level: 'trace' },
      shardDump: { appenders: ['shardDump'], level: 'trace' },
      statsDump: { appenders: ['statsDump'], level: 'trace' },
    },
  },
}

export default LOGS_CONFIG
