import { ServerMode, StrictServerConfiguration } from '../shardus/shardus-types'
import { config } from '../p2p/Context'

export type DebugConfigurations = StrictServerConfiguration['debug']

export function isDebugMode(): boolean {
  return !!(
    config &&
    config.mode &&
    config.mode.toLowerCase &&
    config.mode.toLowerCase() === ServerMode.Debug
  )
}

export function isDebugModeAnd(
  predicate: (
    config: DebugConfigurations | Partial<DebugConfigurations>
  ) => boolean
): boolean {
  return (
    isDebugMode() &&
    !!predicate(config.debug || ({} as Partial<DebugConfigurations>))
  )
}

export function getHashedDevKey(): string {
  if (config && config.debug && config.debug.hashedDevAuth) {
    return config.debug.hashedDevAuth
  }
  return ''
}
export function getDevPublicKey(): string {
  if (config && config.debug && config.debug.devPublicKey) {
    return config.debug.devPublicKey
  }
  return ''
}

