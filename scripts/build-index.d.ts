/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import Shardus from './src/shardus' // Path is correct in resulting dist package
import { ShardusConfiguration } from './src/shardus/shardus-types' // Path is correct in resulting dist package
export * from './src/shardus/shardus-types'

declare function shardusFactory(configs?: ShardusConfiguration): Shardus
