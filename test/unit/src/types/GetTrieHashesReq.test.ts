import { VectorBufferStream } from '../../../../src'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'
import {
  GetTrieHashesRequest,
  cGetTrieHashesReqVersion,
  deserializeGetTrieHashesReq,
  serializeGetTrieHashesReq,
} from '../../../../src/types/GetTrieHashesReq'

/*
  export type GetTrieHashesRequest = {
  radixList: string[]
}
  */

describe('GetTrieHashesRequest Serialization & Deserialization', () => {
  describe('GetTrieHashesRequest Serialization', () => {
    test('should serialize with root true', () => {
      const obj: GetTrieHashesRequest = {
        radixList: ['abc123', 'def456', 'ghi789', 'jkl012', 'mno345'],
      }

      const stream = new VectorBufferStream(0)
      serializeGetTrieHashesReq(stream, obj, true)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt16(TypeIdentifierEnum.cGetTrieHashesReq)
      expectedStream.writeUInt8(cGetTrieHashesReqVersion)
      expectedStream.writeUInt32(obj.radixList.length)
      for (const radix of obj.radixList) {
        expectedStream.writeString(radix)
      }

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should serialize with root false', () => {
      const obj: GetTrieHashesRequest = {
        radixList: ['abc123', 'def456', 'ghi789', 'jkl012', 'mno345'],
      }

      const stream = new VectorBufferStream(0)
      serializeGetTrieHashesReq(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetTrieHashesReqVersion)
      expectedStream.writeUInt32(obj.radixList.length)
      for (const radix of obj.radixList) {
        expectedStream.writeString(radix)
      }

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should serialize with characters', () => {
      const obj: GetTrieHashesRequest = {
        radixList: ['abc!23', 'def@56', 'ghi7)9', 'jk?012', 'mno#45'],
      }

      const stream = new VectorBufferStream(0)
      serializeGetTrieHashesReq(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetTrieHashesReqVersion)
      expectedStream.writeUInt32(obj.radixList.length)
      for (const radix of obj.radixList) {
        expectedStream.writeString(radix)
      }

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should serialize with empty strings', () => {
      const obj: GetTrieHashesRequest = {
        radixList: ['abc123', '', 'ghi789', '', 'mno345'],
      }

      const stream = new VectorBufferStream(0)
      serializeGetTrieHashesReq(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetTrieHashesReqVersion)
      expectedStream.writeUInt32(obj.radixList.length)
      for (const radix of obj.radixList) {
        expectedStream.writeString(radix)
      }

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should serialize with empty array', () => {
      const obj: GetTrieHashesRequest = {
        radixList: [],
      }

      const stream = new VectorBufferStream(0)
      serializeGetTrieHashesReq(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetTrieHashesReqVersion)
      expectedStream.writeUInt32(obj.radixList.length)
      for (const radix of obj.radixList) {
        expectedStream.writeString(radix)
      }

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should not serialize with null radixList', () => {
      const obj: GetTrieHashesRequest = {
        radixList: null,
      }

      const stream = new VectorBufferStream(0)
      expect(() => serializeGetTrieHashesReq(stream, obj)).toThrow(Error)
    })

    test('should serialize with a very large array', () => {
      const radixList = new Array(1000).fill('radixValue')

      const obj: GetTrieHashesRequest = {
        radixList,
      }

      const stream = new VectorBufferStream(0)
      serializeGetTrieHashesReq(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetTrieHashesReqVersion)
      expectedStream.writeUInt32(radixList.length)
      for (const radix of radixList) {
        expectedStream.writeString(radix)
      }

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })
  })

  describe('GetTrieHashesRequest Deserialization', () => {
    test('should deserialize successfully', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetTrieHashesReqVersion)
      stream.writeUInt32(5)
      stream.writeString('abc123')
      stream.writeString('def456')
      stream.writeString('ghi789')
      stream.writeString('jkl012')
      stream.writeString('mno345')
      stream.position = 0 // Reset position for reading

      const obj = deserializeGetTrieHashesReq(stream)

      expect(obj).toEqual({
        radixList: ['abc123', 'def456', 'ghi789', 'jkl012', 'mno345'],
      })
    })
    test('should throw error on unsupported version', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetTrieHashesReqVersion + 1)
      stream.writeUInt32(3)
      stream.writeString('abc123')
      stream.writeString('def456')
      stream.writeString('ghi789')
      stream.position = 0 // Reset position for reading

      expect(() => deserializeGetTrieHashesReq(stream)).toThrow(Error)
    })
    test('should deserialize empty string', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetTrieHashesReqVersion)
      stream.writeUInt32(3)
      stream.writeString('abc123')
      stream.writeString('')
      stream.writeString('ghi789')
      stream.position = 0 // Reset position for reading

      const obj = deserializeGetTrieHashesReq(stream)

      expect(obj).toEqual({
        radixList: ['abc123', '', 'ghi789'],
      })
    })
    test('should deserialize with empty array', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetTrieHashesReqVersion)
      stream.writeUInt32(0)
      stream.position = 0 // Reset position for reading

      const obj = deserializeGetTrieHashesReq(stream)

      expect(obj).toEqual({
        radixList: [],
      })
    })
    test('should deserialize with special characters', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetTrieHashesReqVersion)
      stream.writeUInt32(4)
      stream.writeString('!@#$%^&*()')
      stream.writeString('abc123')
      stream.writeString('<>?/\\')
      stream.writeString('ghi789')
      stream.position = 0 // Reset position for reading

      const obj = deserializeGetTrieHashesReq(stream)

      expect(obj).toEqual({
        radixList: ['!@#$%^&*()', 'abc123', '<>?/\\', 'ghi789'],
      })
    })
  })

  describe('GetTrieHashesRequesr Serialization & Deserialization Done Together', () => {
    const obj: GetTrieHashesRequest = {
      radixList: ['abc123', 'def456', 'ghi789', 'jkl012', 'mno345'],
    }

    const stream = new VectorBufferStream(0)
    serializeGetTrieHashesReq(stream, obj)
    stream.position = 0 // Reset position for reading

    const new_obj = deserializeGetTrieHashesReq(stream)

    expect(new_obj).toEqual(obj)
  })
})
