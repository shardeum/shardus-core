import { Sign } from '../../state-manager/state-manager-types'

export function removeDuplicateSignatures(signatures: Sign[]): Sign[] {
  const seen = new Set<string>()
  const uniqueSignatures = []

  for (const sign of signatures) {
    const key = `${sign.owner}-${sign.sig}`

    if (!seen.has(key)) {
      seen.add(key)
      uniqueSignatures.push(sign)
    }
  }

  return uniqueSignatures
}
