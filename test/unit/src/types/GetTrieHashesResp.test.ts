import { VectorBufferStream } from '../../../../src'
import { initAjvSchemas } from '../../../../src/types/ajv/Helpers'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'
import {
  GetTrieHashesResponse,
  deserializeGetTrieHashesResp,
  serializeGetTrieHashesResp,
} from '../../../../src/types/GetTrieHashesResp'

const cGetTrieHashesRespVersion = 1 // taken from getTrieHashesResponse

describe('GetTrieHashesResponse Serialization & Deserialization', () => {
  beforeAll(() => {
    initAjvSchemas()
  })

  describe('GetTrieHashesResponse Serialization', () => {
    test('should serialize with root true', () => {
      const obj: GetTrieHashesResponse = {
        nodeHashes: [
          { radix: 'abc123', hash: 'hash1' },
          { radix: 'def456', hash: 'hash2' },
          { radix: 'ghi789', hash: 'hash3' },
        ],
        nodeId: 'node123',
      }

      const stream = new VectorBufferStream(0)
      serializeGetTrieHashesResp(stream, obj, true)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt16(TypeIdentifierEnum.cGetTrieHashesResp)
      expectedStream.writeUInt8(cGetTrieHashesRespVersion)
      if (obj.nodeId) expectedStream.writeString(obj.nodeId)
      expectedStream.writeUInt32(obj.nodeHashes.length)
      for (const { radix, hash } of obj.nodeHashes) {
        expectedStream.writeString(radix)
        expectedStream.writeString(hash)
      }

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should serialize with root false', () => {
      const obj: GetTrieHashesResponse = {
        nodeHashes: [
          { radix: 'abc123', hash: 'hash1' },
          { radix: 'def456', hash: 'hash2' },
          { radix: 'ghi789', hash: 'hash3' },
        ],
        nodeId: 'node123',
      }

      const stream = new VectorBufferStream(0)
      serializeGetTrieHashesResp(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetTrieHashesRespVersion)
      if (obj.nodeId) expectedStream.writeString(obj.nodeId)
      expectedStream.writeUInt32(obj.nodeHashes.length)
      for (const { radix, hash } of obj.nodeHashes) {
        expectedStream.writeString(radix)
        expectedStream.writeString(hash)
      }

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should serialize with empty nodeId', () => {
      const obj: GetTrieHashesResponse = {
        nodeHashes: [
          { radix: 'abc123', hash: 'hash1' },
          { radix: 'def456', hash: 'hash2' },
        ],
        nodeId: '',
      }

      const stream = new VectorBufferStream(0)
      serializeGetTrieHashesResp(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetTrieHashesRespVersion)
      expectedStream.writeString('')
      expectedStream.writeUInt32(obj.nodeHashes.length)
      for (const { radix, hash } of obj.nodeHashes) {
        expectedStream.writeString(radix)
        expectedStream.writeString(hash)
      }

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should serialize with empty nodeHashes array', () => {
      const obj: GetTrieHashesResponse = {
        nodeHashes: [],
        nodeId: 'node123',
      }

      const stream = new VectorBufferStream(0)
      serializeGetTrieHashesResp(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetTrieHashesRespVersion)
      if (obj.nodeId) expectedStream.writeString(obj.nodeId)
      expectedStream.writeUInt32(0)

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should serialize with a very large nodeHashes array', () => {
      const nodeHashes = new Array(1000).fill({ radix: 'radixValue', hash: 'hashValue' })

      const obj: GetTrieHashesResponse = {
        nodeHashes,
        nodeId: 'node123',
      }

      const stream = new VectorBufferStream(0)
      serializeGetTrieHashesResp(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetTrieHashesRespVersion)
      if (obj.nodeId) expectedStream.writeString(obj.nodeId)
      expectedStream.writeUInt32(nodeHashes.length)
      for (const { radix, hash } of nodeHashes) {
        expectedStream.writeString(radix)
        expectedStream.writeString(hash)
      }

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should not serialize with null nodeHashes', () => {
      const obj: GetTrieHashesResponse = {
        nodeHashes: null,
        nodeId: 'node123',
      }

      const stream = new VectorBufferStream(0)
      expect(() => serializeGetTrieHashesResp(stream, obj)).toThrow(Error)
    })

    test('should serialize with null nodeId since it is optional', () => {
      const obj: GetTrieHashesResponse = {
        nodeHashes: [
          { radix: 'abc123', hash: 'hash1' },
          { radix: 'def456', hash: 'hash2' },
        ],
        nodeId: null,
      }

      const stream = new VectorBufferStream(0)
      serializeGetTrieHashesResp(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetTrieHashesRespVersion)
      expectedStream.writeString('')
      expectedStream.writeUInt32(obj.nodeHashes.length)
      for (const { radix, hash } of obj.nodeHashes) {
        expectedStream.writeString(radix)
        expectedStream.writeString(hash)
      }

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should serialize with undefined nodeId', () => {
      const obj: GetTrieHashesResponse = {
        nodeHashes: [
          { radix: 'abc123', hash: 'hash1' },
          { radix: 'def456', hash: 'hash2' },
        ],
        nodeId: undefined,
      }

      const stream = new VectorBufferStream(0)
      serializeGetTrieHashesResp(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetTrieHashesRespVersion)
      expectedStream.writeString('')
      expectedStream.writeUInt32(obj.nodeHashes.length)
      for (const { radix, hash } of obj.nodeHashes) {
        expectedStream.writeString(radix)
        expectedStream.writeString(hash)
      }

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })
  })

  describe('GetTrieHashesResponse Deserialization', () => {
    test('should deserialize with valid objects', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetTrieHashesRespVersion)
      stream.writeString('node123')
      stream.writeUInt32(3)
      stream.writeString('abc123')
      stream.writeString('hash1')
      stream.writeString('def456')
      stream.writeString('hash2')
      stream.writeString('ghi789')
      stream.writeString('hash3')

      stream.position = 0 // Reset position for reading
      const obj = deserializeGetTrieHashesResp(stream)

      const expectedObj: GetTrieHashesResponse = {
        nodeHashes: [
          { radix: 'abc123', hash: 'hash1' },
          { radix: 'def456', hash: 'hash2' },
          { radix: 'ghi789', hash: 'hash3' },
        ],
        nodeId: 'node123',
      }

      expect(obj).toEqual(expectedObj)
    })

    test('should deserialize with empty nodeId', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetTrieHashesRespVersion)
      stream.writeString('')
      stream.writeUInt32(2)
      stream.writeString('abc123')
      stream.writeString('hash1')
      stream.writeString('def456')
      stream.writeString('hash2')

      stream.position = 0 // Reset position for reading
      const obj = deserializeGetTrieHashesResp(stream)

      const expectedObj: GetTrieHashesResponse = {
        nodeHashes: [
          { radix: 'abc123', hash: 'hash1' },
          { radix: 'def456', hash: 'hash2' },
        ],
        nodeId: '',
      }

      expect(obj).toEqual(expectedObj)
    })

    test('should deserialize with empty nodeHashes array', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetTrieHashesRespVersion)
      stream.writeString('node123')
      stream.writeUInt32(0)

      stream.position = 0 // Reset position for reading
      const obj = deserializeGetTrieHashesResp(stream)

      const expectedObj: GetTrieHashesResponse = {
        nodeHashes: [],
        nodeId: 'node123',
      }

      expect(obj).toEqual(expectedObj)
    })

    test('should deserialize with a very large nodeHashes array', () => {
      const nodeHashes = new Array(1000).fill({ radix: 'radixValue', hash: 'hashValue' })

      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetTrieHashesRespVersion)
      stream.writeString('node123')
      stream.writeUInt32(nodeHashes.length)
      for (const { radix, hash } of nodeHashes) {
        stream.writeString(radix)
        stream.writeString(hash)
      }

      stream.position = 0 // Reset position for reading
      const obj = deserializeGetTrieHashesResp(stream)

      const expectedObj: GetTrieHashesResponse = {
        nodeHashes,
        nodeId: 'node123',
      }

      expect(obj).toEqual(expectedObj)
    })

    test('should not deserialize with unsupported version', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetTrieHashesRespVersion + 1)
      stream.writeString('node123')
      stream.writeUInt32(0)

      stream.position = 0 // Reset position for reading
      expect(() => deserializeGetTrieHashesResp(stream)).toThrow(
        'Unsupported version in deserializeGetTrieHashesResp'
      )
    })
  })

  describe('GetTrieHashesResponse Serialization & Deserialization Done Together', () => {
    test('should serialize and deserialize successfully', () => {
      const obj: GetTrieHashesResponse = {
        nodeHashes: [
          { radix: 'abc123', hash: 'hash1' },
          { radix: 'def456', hash: 'hash2' },
          { radix: 'ghi789', hash: 'hash3' },
        ],
        nodeId: 'node123',
      }

      const stream = new VectorBufferStream(0)
      serializeGetTrieHashesResp(stream, obj)
      stream.position = 0 // Reset position for reading

      const new_obj = deserializeGetTrieHashesResp(stream)

      expect(new_obj).toEqual(obj)
    })
  })
})
