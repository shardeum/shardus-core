import { VectorBufferStream } from '../../../../src/utils/serialization/VectorBufferStream'
import {
  GetAccountDataWithQueueHintsReqSerializable,
  serializeGetAccountDataWithQueueHintsReq,
  deserializeGetAccountDataWithQueueHintsReq,
} from '../../../../src/types/GetAccountDataWithQueueHintsReq'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'

const cGetAccountDataWithQueueHintsReqVersion = 1 // taken from GetAccountDataWithQueueHintsReq

describe('GetAccountDataWithQueueHintsReq Serialization and Deserialization', () => {
  describe('Serialization', () => {
    test('should serialize data with root true', () => {
      const obj: GetAccountDataWithQueueHintsReqSerializable = {
        accountIds: ['id1', 'id2', 'id3'],
      }
      const stream = new VectorBufferStream(0)
      serializeGetAccountDataWithQueueHintsReq(stream, obj, true)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt16(TypeIdentifierEnum.cGetAccountDataWithQueueHintsReq)
      expectedStream.writeUInt8(cGetAccountDataWithQueueHintsReqVersion)
      expectedStream.writeUInt32(obj.accountIds.length)
      for (const accountId of obj.accountIds) {
        expectedStream.writeString(accountId)
      }

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should serialize data with root false', () => {
      const obj: GetAccountDataWithQueueHintsReqSerializable = {
        accountIds: ['id1', 'id2', 'id3'],
      }
      const stream = new VectorBufferStream(0)
      serializeGetAccountDataWithQueueHintsReq(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetAccountDataWithQueueHintsReqVersion)
      expectedStream.writeUInt32(obj.accountIds.length)
      for (const accountId of obj.accountIds) {
        expectedStream.writeString(accountId)
      }

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should serialize data with empty accountIds array', () => {
      const obj: GetAccountDataWithQueueHintsReqSerializable = {
        accountIds: [],
      }
      const stream = new VectorBufferStream(0)
      serializeGetAccountDataWithQueueHintsReq(stream, obj, true)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt16(TypeIdentifierEnum.cGetAccountDataWithQueueHintsReq)
      expectedStream.writeUInt8(cGetAccountDataWithQueueHintsReqVersion)
      expectedStream.writeUInt32(0)

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should serialize data with single account ID', () => {
      const obj: GetAccountDataWithQueueHintsReqSerializable = {
        accountIds: ['id1'],
      }
      const stream = new VectorBufferStream(0)
      serializeGetAccountDataWithQueueHintsReq(stream, obj, true)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt16(TypeIdentifierEnum.cGetAccountDataWithQueueHintsReq)
      expectedStream.writeUInt8(cGetAccountDataWithQueueHintsReqVersion)
      expectedStream.writeUInt32(1)
      expectedStream.writeString('id1')

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should serialize data with large number of account IDs', () => {
      const obj: GetAccountDataWithQueueHintsReqSerializable = {
        accountIds: Array.from({ length: 10000 }, (_, i) => `id${i}`),
      }
      const stream = new VectorBufferStream(0)
      serializeGetAccountDataWithQueueHintsReq(stream, obj, true)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt16(TypeIdentifierEnum.cGetAccountDataWithQueueHintsReq)
      expectedStream.writeUInt8(cGetAccountDataWithQueueHintsReqVersion)
      expectedStream.writeUInt32(obj.accountIds.length)
      for (const accountId of obj.accountIds) {
        expectedStream.writeString(accountId)
      }

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should throw error when accountIds array contains null', () => {
      const obj: GetAccountDataWithQueueHintsReqSerializable = {
        accountIds: ['id1', null, 'id3'],
      }
      const stream = new VectorBufferStream(0)

      // Expect an error to be thrown when serializing with null values in accountIds
      expect(() => serializeGetAccountDataWithQueueHintsReq(stream, obj, true)).toThrow()
    })
  })

  describe('Deserialization', () => {
    test('should deserialize correctly', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetAccountDataWithQueueHintsReqVersion)
      stream.writeUInt32(3)
      stream.writeString('id1')
      stream.writeString('id2')
      stream.writeString('id3')
      stream.position = 0

      const result = deserializeGetAccountDataWithQueueHintsReq(stream)
      expect(result).toEqual({
        accountIds: ['id1', 'id2', 'id3'],
      })
    })

    test('should throw a version mismatch error if the version number does not match', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetAccountDataWithQueueHintsReqVersion + 1)
      stream.writeUInt32(3)
      stream.writeString('id1')
      stream.writeString('id2')
      stream.writeString('id3')
      stream.position = 0

      expect(() => deserializeGetAccountDataWithQueueHintsReq(stream)).toThrow(
        'GetAccountDataWithQueueHintsReq version mismatch'
      )
    })

    test('should deserialize empty string', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetAccountDataWithQueueHintsReqVersion)
      stream.writeUInt32(3)
      stream.writeString('abc123')
      stream.writeString('')
      stream.writeString('ghi789')
      stream.position = 0 // Reset position for reading

      const obj = deserializeGetAccountDataWithQueueHintsReq(stream)

      expect(obj).toEqual({
        accountIds: ['abc123', '', 'ghi789'],
      })
    })

    test('should deserialize with empty array', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetAccountDataWithQueueHintsReqVersion)
      stream.writeUInt32(0) // Writing empty array
      stream.position = 0 // Reset position for reading

      const obj = deserializeGetAccountDataWithQueueHintsReq(stream)

      expect(obj).toEqual({
        accountIds: [],
      })
    })

    test('should deserialize with special characters', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetAccountDataWithQueueHintsReqVersion)
      stream.writeUInt32(4)
      stream.writeString('!@#$%^&*()')
      stream.writeString('abc123')
      stream.writeString('<>?/\\')
      stream.writeString('ghi789')
      stream.position = 0 // Reset position for reading

      const obj = deserializeGetAccountDataWithQueueHintsReq(stream)

      expect(obj).toEqual({
        accountIds: ['!@#$%^&*()', 'abc123', '<>?/\\', 'ghi789'],
      })
    })
  })

  describe('Serialization and Deserialization Integrity', () => {
    test('should maintain data integrity through serialization and deserialization', () => {
      const obj: GetAccountDataWithQueueHintsReqSerializable = {
        accountIds: ['id1', 'id2', 'id3', 'id4'],
      }
      const stream = new VectorBufferStream(0)
      serializeGetAccountDataWithQueueHintsReq(stream, obj, false)
      stream.position = 0 // Reset for reading

      const deserializedObj = deserializeGetAccountDataWithQueueHintsReq(stream)
      expect(deserializedObj).toEqual(obj)
    })
  })
})
