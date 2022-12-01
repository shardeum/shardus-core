import merge from 'deepmerge'

import Shardus from './shardus'
import * as ShardusTypes from './shardus/shardus-types'
import { compareObjectShape } from './utils'

export { default as Shardus } from './shardus'
export { ShardusTypes }

export {nestedCountersInstance} from './utils/nestedCounters'

// Temporary private export to avoid digging into shardus source code for
// functions it otherwise wasn't exporting. ATTOW we have not decided on whether
// a more permanent solution is proper.
import { addressToPartition, partitionInWrappingRange, findHomeNode } from './state-manager/shardFunctions'
import SHARDUS_CONFIG from './config'
export const __ShardFunctions = {
  addressToPartition,
  partitionInWrappingRange,
  findHomeNode,
}

const defaultConfigs: ShardusTypes.StrictShardusConfiguration = SHARDUS_CONFIG

const overwriteMerge = (target, source, options) => source

export function shardusFactory(configs = {}, opts?: { customStringifier?: (val: any) => string }) {
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

  return new Shardus(mergedConfigs, opts)
}
