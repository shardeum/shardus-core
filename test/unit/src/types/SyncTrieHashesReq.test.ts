import { VectorBufferStream } from '../../../../src/utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'
import { initAjvSchemas } from '../../../../src/types/ajv/Helpers'
import {
  SyncTrieHashesRequest,
  serializeSyncTrieHashesReq,
  deserializeSyncTrieHashesReq,
} from '../../../../src/types/SyncTrieHashesReq'

const cSyncTrieHashesReqVersion = 1

describe('SyncTrieHashesRequest Serialization & Deserialization', () => {
  beforeAll(() => {
    initAjvSchemas()
  })

  describe('SyncTrieHashesRequest Serialization', () => {
    test('should serialize with root true', () => {
      const obj: SyncTrieHashesRequest = {
        cycle: 123,
        nodeHashes: [
          { radix: 'abc123', hash: 'hash1' },
          { radix: 'def456', hash: 'hash2' },
          { radix: 'ghi789', hash: 'hash3' },
        ],
      }
      const stream = new VectorBufferStream(0)
      serializeSyncTrieHashesReq(stream, obj, true)
      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt16(TypeIdentifierEnum.cSyncTrieHashesReq)
      expectedStream.writeUInt8(cSyncTrieHashesReqVersion)
      expectedStream.writeBigUInt64(BigInt(obj.cycle))
      expectedStream.writeUInt32(obj.nodeHashes.length)
      for (const nodeHash of obj.nodeHashes) {
        expectedStream.writeString(nodeHash.radix)
        expectedStream.writeString(nodeHash.hash)
      }
      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should serialize with root false', () => {
      const obj: SyncTrieHashesRequest = {
        cycle: 123,
        nodeHashes: [
          { radix: 'abc123', hash: 'hash1' },
          { radix: 'def456', hash: 'hash2' },
          { radix: 'ghi789', hash: 'hash3' },
        ],
      }
      const stream = new VectorBufferStream(0)
      serializeSyncTrieHashesReq(stream, obj, false)
      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cSyncTrieHashesReqVersion)
      expectedStream.writeBigUInt64(BigInt(obj.cycle))
      expectedStream.writeUInt32(obj.nodeHashes.length)
      for (const nodeHash of obj.nodeHashes) {
        expectedStream.writeString(nodeHash.radix)
        expectedStream.writeString(nodeHash.hash)
      }
      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should serialize with characters for radix and hash', () => {
      const obj: SyncTrieHashesRequest = {
        cycle: 123,
        nodeHashes: [
          { radix: 'abc!23', hash: 'hash!1' },
          { radix: 'def@56', hash: 'hash@2' },
          { radix: 'ghi7)9', hash: 'hash)3' },
        ],
      }
      const stream = new VectorBufferStream(0)
      serializeSyncTrieHashesReq(stream, obj, false)
      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cSyncTrieHashesReqVersion)
      expectedStream.writeBigUInt64(BigInt(obj.cycle))
      expectedStream.writeUInt32(obj.nodeHashes.length)
      for (const nodeHash of obj.nodeHashes) {
        expectedStream.writeString(nodeHash.radix)
        expectedStream.writeString(nodeHash.hash)
      }
      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should serialize with empty strings for redix and hash', () => {
      const obj: SyncTrieHashesRequest = {
        cycle: 123,
        nodeHashes: [
          { radix: '', hash: 'hash1' },
          { radix: '', hash: '' },
          { radix: 'ghi789', hash: '' },
        ],
      }
      const stream = new VectorBufferStream(0)
      serializeSyncTrieHashesReq(stream, obj, false)
      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cSyncTrieHashesReqVersion)
      expectedStream.writeBigUInt64(BigInt(obj.cycle))
      expectedStream.writeUInt32(obj.nodeHashes.length)
      for (const nodeHash of obj.nodeHashes) {
        expectedStream.writeString(nodeHash.radix)
        expectedStream.writeString(nodeHash.hash)
      }
      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should serialize with empty array for nodeHashes', () => {
      const obj: SyncTrieHashesRequest = {
        cycle: 123,
        nodeHashes: [],
      }
      const stream = new VectorBufferStream(0)
      serializeSyncTrieHashesReq(stream, obj, false)
      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cSyncTrieHashesReqVersion)
      expectedStream.writeBigUInt64(BigInt(obj.cycle))
      expectedStream.writeUInt32(obj.nodeHashes.length)
      for (const nodeHash of obj.nodeHashes) {
        expectedStream.writeString(nodeHash.radix)
        expectedStream.writeString(nodeHash.hash)
      }
      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should not serialize with null nodeHashes', () => {
      const obj: SyncTrieHashesRequest = {
        cycle: 123,
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        nodeHashes: null,
      }
      const stream = new VectorBufferStream(0)
      expect(() => serializeSyncTrieHashesReq(stream, obj)).toThrow(Error)
    })

    test('should serialize with a very large nodeHashes array', () => {
      const obj: SyncTrieHashesRequest = {
        cycle: 123,
        nodeHashes: Array(10000)
          .fill(0)
          .map((_, i) => {
            return { radix: `radix${i}`, hash: `hash${i}` }
          }),
      }
      const stream = new VectorBufferStream(0)
      serializeSyncTrieHashesReq(stream, obj)
    })
  })

  describe('SyncTrieHashesRequest Deserialization', () => {
    test('should deserialize successfully', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cSyncTrieHashesReqVersion)
      stream.writeBigUInt64(BigInt(123))
      stream.writeUInt32(3)
      stream.writeString('abc123')
      stream.writeString('hash1')
      stream.writeString('def456')
      stream.writeString('hash2')
      stream.writeString('ghi789')
      stream.writeString('hash3')
      stream.position = 0 // Reset position for reading
      const obj = deserializeSyncTrieHashesReq(stream)
      expect(obj).toEqual({
        cycle: 123,
        nodeHashes: [
          { radix: 'abc123', hash: 'hash1' },
          { radix: 'def456', hash: 'hash2' },
          { radix: 'ghi789', hash: 'hash3' },
        ],
      })
    })

    test('should throw error on unsupported version', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cSyncTrieHashesReqVersion + 1)
      stream.writeBigUInt64(BigInt(123))
      stream.writeUInt32(3)
      stream.writeString('abc123')
      stream.writeString('hash1')
      stream.writeString('def456')
      stream.writeString('hash2')
      stream.writeString('ghi789')
      stream.writeString('hash3')
      stream.position = 0 // Reset position for reading
      expect(() => deserializeSyncTrieHashesReq(stream)).toThrow(Error)
    })

    test('should deserialize empty string for radix and hash', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cSyncTrieHashesReqVersion)
      stream.writeBigUInt64(BigInt(123))
      stream.writeUInt32(3)
      stream.writeString('')
      stream.writeString('hash1')
      stream.writeString('')
      stream.writeString('')
      stream.writeString('ghi789')
      stream.writeString('')
      stream.position = 0 // Reset position for reading
      const obj = deserializeSyncTrieHashesReq(stream)
      expect(obj).toEqual({
        cycle: 123,
        nodeHashes: [
          { radix: '', hash: 'hash1' },
          { radix: '', hash: '' },
          { radix: 'ghi789', hash: '' },
        ],
      })
    })

    test('should deserialize with empty nodeHashes array', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cSyncTrieHashesReqVersion)
      stream.writeBigUInt64(BigInt(123))
      stream.writeUInt32(0)
      stream.position = 0 // Reset position for reading
      const obj = deserializeSyncTrieHashesReq(stream)
      expect(obj).toEqual({
        cycle: 123,
        nodeHashes: [],
      })
    })

    test('should deserialize with a very large nodeHashes array', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cSyncTrieHashesReqVersion)
      stream.writeBigUInt64(BigInt(123))
      stream.writeUInt32(10000)
      for (let i = 0; i < 10000; i++) {
        stream.writeString(`radix${i}`)
        stream.writeString(`hash${i}`)
      }
      stream.position = 0 // Reset position for reading
      const obj = deserializeSyncTrieHashesReq(stream)
      expect(obj.nodeHashes.length).toEqual(10000)
    })
    test('should deserialize with special characters for radix and hash', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cSyncTrieHashesReqVersion)
      stream.writeBigUInt64(BigInt(123))
      stream.writeUInt32(3)
      stream.writeString('abc!23')
      stream.writeString('hash!1')
      stream.writeString('def@56')
      stream.writeString('hash@2')
      stream.writeString('ghi7)9')
      stream.writeString('hash)3')
      stream.position = 0 // Reset position for reading
      const obj = deserializeSyncTrieHashesReq(stream)
      expect(obj).toEqual({
        cycle: 123,
        nodeHashes: [
          { radix: 'abc!23', hash: 'hash!1' },
          { radix: 'def@56', hash: 'hash@2' },
          { radix: 'ghi7)9', hash: 'hash)3' },
        ],
      })
    })
  })

  describe('SyncTrieHashesRequest Serialization & Deserialization Done Together', () => {
    test('should serialize and deserialize successfully', () => {
      const obj: SyncTrieHashesRequest = {
        cycle: 123,
        nodeHashes: [
          { radix: 'abc123', hash: 'hash1' },
          { radix: 'def456', hash: 'hash2' },
          { radix: 'ghi789', hash: 'hash3' },
        ],
      }
      const stream = new VectorBufferStream(0)
      serializeSyncTrieHashesReq(stream, obj)
      stream.position = 0 // Reset position for reading
      const new_obj = deserializeSyncTrieHashesReq(stream)
      expect(new_obj).toEqual(obj)
    })
  })
})
