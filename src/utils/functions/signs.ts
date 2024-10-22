import { Sign } from '../../state-manager/state-manager-types'

export function removeDuplicateSignatures(signatures: Sign[]): Sign[] {
  const seenOwners = new Set<string>()
  const uniqueSignatures = []

  for (const sign of signatures) {
    if (!seenOwners.has(sign.owner)) {
      seenOwners.add(sign.owner)
      uniqueSignatures.push(sign)
    }
  }

  return uniqueSignatures
}
