import { Sign } from '../../../../../src/state-manager/state-manager-types'
import { removeDuplicateSignatures } from '../../../../../src/utils/functions/signs'

describe('removeDuplicateSignatures', () => {
  it('should remove duplicate Sign objects based on `owner` and `sig`', () => {
    const signatures: Sign[] = [
      { owner: 'owner1', sig: 'signature1' },
      { owner: 'owner2', sig: 'signature2' },
      { owner: 'owner1', sig: 'signature1' },
      { owner: 'owner3', sig: 'signature3' },
      { owner: 'owner2', sig: 'signature2' },
    ]

    const result = removeDuplicateSignatures(signatures)

    expect(result).toEqual([
      { owner: 'owner1', sig: 'signature1' },
      { owner: 'owner2', sig: 'signature2' },
      { owner: 'owner3', sig: 'signature3' },
    ])
  })

  it('should return an empty array if input array is empty', () => {
    const signatures: Sign[] = []

    const result = removeDuplicateSignatures(signatures)

    expect(result).toEqual([])
  })

  it('should not remove Sign objects with different `owner` or `sig` values', () => {
    const signatures: Sign[] = [
      { owner: 'owner1', sig: 'signature1' },
      { owner: 'owner2', sig: 'signature2' },
    ]

    const result = removeDuplicateSignatures(signatures)

    expect(result).toEqual([
      { owner: 'owner1', sig: 'signature1' },
      { owner: 'owner2', sig: 'signature2' },
    ])
  })

  it('should handle an array with all duplicate Sign objects', () => {
    const signatures: Sign[] = [
      { owner: 'owner1', sig: 'signature1' },
      { owner: 'owner1', sig: 'signature1' },
      { owner: 'owner1', sig: 'signature1' },
    ]

    const result = removeDuplicateSignatures(signatures)

    expect(result).toEqual([{ owner: 'owner1', sig: 'signature1' }])
  })

  it('should maintain the order of the first unique Sign objects', () => {
    const signatures: Sign[] = [
      { owner: 'owner1', sig: 'signature1' },
      { owner: 'owner2', sig: 'signature2' },
      { owner: 'owner1', sig: 'signature1' },
      { owner: 'owner3', sig: 'signature3' },
      { owner: 'owner2', sig: 'signature2' },
    ]

    const result = removeDuplicateSignatures(signatures)

    expect(result).toEqual([
      { owner: 'owner1', sig: 'signature1' },
      { owner: 'owner2', sig: 'signature2' },
      { owner: 'owner3', sig: 'signature3' },
    ])
  })
})
