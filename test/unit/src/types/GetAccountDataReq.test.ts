import { VectorBufferStream } from '../../../../src/utils/serialization/VectorBufferStream'
import {
  GetAccountDataReqSerializable,
  serializeGetAccountDataReq,
  deserializeGetAccountDataReq,
} from '../../../../src/types/GetAccountDataReq'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'
import { initAjvSchemas } from '../../../../src/types/ajv/Helpers'

const cGetAccountDataReqVersion = 1

describe('GetAccountDataReqSerializable Serialization and Deserialization', () => {
  beforeAll(() => {
    initAjvSchemas()
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Serialization', () => {
    test('should serialize data correctly with root true', () => {
      const obj: GetAccountDataReqSerializable = {
        accountStart: 'a'.repeat(64),
        accountEnd: 'b'.repeat(64),
        tsStart: 123456789,
        maxRecords: 100,
        offset: 10,
        accountOffset: 'offset789',
      }
      const stream = new VectorBufferStream(0)
      serializeGetAccountDataReq(stream, obj, true)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt16(TypeIdentifierEnum.cGetAccountDataReq)
      expectedStream.writeUInt8(cGetAccountDataReqVersion)
      expectedStream.writeString(obj.accountStart)
      expectedStream.writeString(obj.accountEnd)
      expectedStream.writeBigUInt64(BigInt(obj.tsStart))
      expectedStream.writeBigUInt64(BigInt(obj.maxRecords))
      expectedStream.writeBigUInt64(BigInt(obj.offset))
      expectedStream.writeString(obj.accountOffset)

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should serialize data correctly with root false', () => {
      const obj: GetAccountDataReqSerializable = {
        accountStart: 'a'.repeat(64),
        accountEnd: 'b'.repeat(64),
        tsStart: 123456789,
        maxRecords: 100,
        offset: 10,
        accountOffset: 'offset789',
      }
      const stream = new VectorBufferStream(0)
      serializeGetAccountDataReq(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetAccountDataReqVersion)
      expectedStream.writeString(obj.accountStart)
      expectedStream.writeString(obj.accountEnd)
      expectedStream.writeBigUInt64(BigInt(obj.tsStart))
      expectedStream.writeBigUInt64(BigInt(obj.maxRecords))
      expectedStream.writeBigUInt64(BigInt(obj.offset))
      expectedStream.writeString(obj.accountOffset)

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should handle edge case with empty strings', () => {
      const obj: GetAccountDataReqSerializable = {
        accountStart: '',
        accountEnd: '',
        tsStart: 0,
        maxRecords: 0,
        offset: 0,
        accountOffset: '',
      }
      const stream = new VectorBufferStream(0)
      serializeGetAccountDataReq(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetAccountDataReqVersion)
      expectedStream.writeString(obj.accountStart)
      expectedStream.writeString(obj.accountEnd)
      expectedStream.writeBigUInt64(BigInt(obj.tsStart))
      expectedStream.writeBigUInt64(BigInt(obj.maxRecords))
      expectedStream.writeBigUInt64(BigInt(obj.offset))
      expectedStream.writeString(obj.accountOffset)

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })
  })

  describe('Deserialization', () => {
    test('should deserialize data correctly', () => {
      const obj: GetAccountDataReqSerializable = {
        accountStart: 'a'.repeat(64),
        accountEnd: 'b'.repeat(64),
        tsStart: 123456789,
        maxRecords: 100,
        offset: 10,
        accountOffset: 'offset789',
      }
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetAccountDataReqVersion)
      stream.writeString(obj.accountStart)
      stream.writeString(obj.accountEnd)
      stream.writeBigUInt64(BigInt(obj.tsStart))
      stream.writeBigUInt64(BigInt(obj.maxRecords))
      stream.writeBigUInt64(BigInt(obj.offset))
      stream.writeString(obj.accountOffset)
      stream.position = 0

      const deserializedObj = deserializeGetAccountDataReq(stream)
      expect(deserializedObj).toEqual(obj)
    })

    test('should handle edge case with empty strings', () => {
      const obj: GetAccountDataReqSerializable = {
        accountStart: '',
        accountEnd: '',
        tsStart: 0,
        maxRecords: 0,
        offset: 0,
        accountOffset: '',
      }
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetAccountDataReqVersion)
      stream.writeString(obj.accountStart)
      stream.writeString(obj.accountEnd)
      stream.writeBigUInt64(BigInt(obj.tsStart))
      stream.writeBigUInt64(BigInt(obj.maxRecords))
      stream.writeBigUInt64(BigInt(obj.offset))
      stream.writeString(obj.accountOffset)
      stream.position = 0

      const deserializedObj = deserializeGetAccountDataReq(stream)
      expect(deserializedObj).toEqual(obj)
    })

    test('should throw version mismatch error', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetAccountDataReqVersion + 1)
      stream.position = 0

      expect(() => deserializeGetAccountDataReq(stream)).toThrow('GetAccountDataReq version mismatch')
    })

    test('should handle large numbers', () => {
      const obj: GetAccountDataReqSerializable = {
        accountStart: 'a'.repeat(64),
        accountEnd: 'b'.repeat(64),
        tsStart: Number.MAX_SAFE_INTEGER,
        maxRecords: Number.MAX_SAFE_INTEGER,
        offset: Number.MAX_SAFE_INTEGER,
        accountOffset: 'offset789',
      }
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetAccountDataReqVersion)
      stream.writeString(obj.accountStart)
      stream.writeString(obj.accountEnd)
      stream.writeBigUInt64(BigInt(obj.tsStart))
      stream.writeBigUInt64(BigInt(obj.maxRecords))
      stream.writeBigUInt64(BigInt(obj.offset))
      stream.writeString(obj.accountOffset)
      stream.position = 0

      const deserializedObj = deserializeGetAccountDataReq(stream)
      expect(deserializedObj).toEqual(obj)
    })
  })

  describe('Serialization and Deserialization Together', () => {
    test('should serialize and deserialize data correctly', () => {
      const originalObj: GetAccountDataReqSerializable = {
        accountStart: 'a'.repeat(64),
        accountEnd: 'b'.repeat(64),
        tsStart: 123456789,
        maxRecords: 100,
        offset: 10,
        accountOffset: 'offset789',
      }

      const stream = new VectorBufferStream(0)
      serializeGetAccountDataReq(stream, originalObj, false)
      stream.position = 0

      const deserializedObj = deserializeGetAccountDataReq(stream)
      expect(deserializedObj).toEqual(originalObj)
    })

    test('should handle edge case with empty strings during serialization and deserialization', () => {
      const originalObj: GetAccountDataReqSerializable = {
        accountStart: '',
        accountEnd: '',
        tsStart: 0,
        maxRecords: 0,
        offset: 0,
        accountOffset: '',
      }

      const stream = new VectorBufferStream(0)
      serializeGetAccountDataReq(stream, originalObj, false)
      stream.position = 0

      const deserializedObj = deserializeGetAccountDataReq(stream)
      expect(deserializedObj).toEqual(originalObj)
    })

    test('should handle large numbers during serialization and deserialization', () => {
      const originalObj: GetAccountDataReqSerializable = {
        accountStart: 'a'.repeat(64),
        accountEnd: 'b'.repeat(64),
        tsStart: Number.MAX_SAFE_INTEGER,
        maxRecords: Number.MAX_SAFE_INTEGER,
        offset: Number.MAX_SAFE_INTEGER,
        accountOffset: 'offset789',
      }

      const stream = new VectorBufferStream(0)
      serializeGetAccountDataReq(stream, originalObj, false)
      stream.position = 0

      const deserializedObj = deserializeGetAccountDataReq(stream)
      expect(deserializedObj).toEqual(originalObj)
    })
  })
})
