import { ServerMode, StrictServerConfiguration, DevSecurityLevel } from '../shardus/shardus-types'
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
  predicate: (config: DebugConfigurations | Partial<DebugConfigurations>) => boolean
): boolean {
  return isDebugMode() && !!predicate(config.debug || ({} as Partial<DebugConfigurations>))
}

export function isServiceMode(): boolean {
  return config && config.features && config.features.startInServiceMode
}

export function getHashedDevKey(): string {
  return config?.debug?.hashedDevAuth || ''
}

export function getDevPublicKeys(): DebugConfigurations['devPublicKeys'] {
  return config?.debug?.devPublicKeys || {}
}

export function ensureKeySecurity(pubKey: string, level: DevSecurityLevel): boolean {
  const devPublicKeys = getDevPublicKeys()
  // eslint-disable-next-line security/detect-object-injection
  const pkClearance = devPublicKeys[pubKey]
  return pkClearance !== undefined && pkClearance >= level
}

export function getDevPublicKey(key: string): string | null {
  const devPublicKeys = getDevPublicKeys()
  // eslint-disable-next-line security/detect-object-injection
  const pkClearance = devPublicKeys[key]
  if (pkClearance !== undefined) return key
  return null
}

export function getDevPublicKeyMaxLevel(clearance?: DevSecurityLevel): string | null {
  const devPublicKeys = getDevPublicKeys()
  let maxLevel = -Infinity
  let maxKey = null
  for (const key in devPublicKeys) {
    // eslint-disable-next-line security/detect-object-injection
    if (devPublicKeys[key]) {
      // eslint-disable-next-line security/detect-object-injection
      if (clearance && devPublicKeys[key] >= clearance) return key
      else {
        // eslint-disable-next-line security/detect-object-injection
        const level = devPublicKeys[key]
        if (level > maxLevel) {
          maxLevel = level
          maxKey = key
        }
      }
    }
  }
  return maxKey
}

export function getMultisigPublicKeys(): DebugConfigurations['multisigKeys'] {
  return config?.debug?.multisigKeys || {}
}

export function getMultisigPublicKey(key: string): string | null {
  // eslint-disable-next-line security/detect-object-injection
  return getMultisigPublicKeys()[key] !== undefined ? key : null
}

export function ensureMultisigKeySecurity(pubKey: string, level: DevSecurityLevel): boolean {
  // eslint-disable-next-line security/detect-object-injection
  const pkClearance = getMultisigPublicKeys()[pubKey]
  return pkClearance !== undefined && pkClearance >= level
}
