import merge from 'deepmerge'

import Shardus from './shardus'
import * as ShardusTypes from './shardus/shardus-types'
import { compareObjectShape } from './utils'

export { default as Shardus } from './shardus'
export { ShardusTypes }

const defaultConfigs = {
  server: require('./config/server.json'),
  logs: require('./config/logs.json'),
  storage: require('./config/storage.json'),
}

const overwriteMerge = (target, source, options) => source

export function shardusFactory(configs = {}) {
  const mergedConfigs = merge(defaultConfigs, configs, {
    arrayMerge: overwriteMerge,
  })

  const { isValid, error } = compareObjectShape(defaultConfigs, mergedConfigs)

  if (error) {
    const fRed = '\x1b[31m' //fg red
    const bYellow = '\x1b[43m' //bg yellow
    const defectiveObjectPath = `${fRed}${bYellow}${error.defectiveChain.join('.')}\x1b[0m`
    const msg = `Unacceptable config object shape, defective settings detected: ${defectiveObjectPath}`

    console.log(
      '\x1b[1m', //bold, bright
      '\x1b[31m', //fg red
      'INVALID CONFIG OBJECT PROPERTY OR TYPE MISMATCH OCCURS:',
      `${defectiveObjectPath}`
    )
    console.log(
      '\x1b[36m', //cyan
      'For more information on configuration object, check the documentation',
      '\x1b[0m' //color reset
    )

    throw new Error(msg)
  }

  return new Shardus(mergedConfigs)
}
