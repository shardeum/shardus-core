import { VectorBufferStream } from '../../../../src/utils/serialization/VectorBufferStream'
import {
  cGetAccountDataByListReqVersion,
  deserializeGetAccountDataByListReq,
  serializeGetAccountDataByListReq,
} from '../../../../src/types/GetAccountDataByListReq'
import { initAjvSchemas } from '../../../../src/types/ajv/Helpers'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'

describe('GetAccountDataByListReq Tests', () => {
  beforeAll(() => {
    initAjvSchemas() // Initialize AJV schemas if this is part of the schema validation setup
  })

  describe('Serialization Tests', () => {
    test('Serialize valid data with root true', () => {
      const obj = { accountIds: ['acc123', 'acc456'] }
      const stream = new VectorBufferStream(0)
      serializeGetAccountDataByListReq(stream, obj, true)
      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt16(TypeIdentifierEnum.cGetAccountDataByListReq)
      expectedStream.writeUInt8(cGetAccountDataByListReqVersion)
      expectedStream.writeUInt32(2)
      expectedStream.writeString('acc123')
      expectedStream.writeString('acc456')

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('Serialize empty array with root false', () => {
      const obj = { accountIds: [] }
      const stream = new VectorBufferStream(0)
      serializeGetAccountDataByListReq(stream, obj, false)
      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetAccountDataByListReqVersion)
      expectedStream.writeUInt32(0)

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })
  })

  describe('Deserialization Tests', () => {
    test('Deserialize valid data', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetAccountDataByListReqVersion)
      stream.writeUInt32(2)
      stream.writeString('acc123')
      stream.writeString('acc456')
      stream.position = 0

      const result = deserializeGetAccountDataByListReq(stream)
      expect(result).toEqual({ accountIds: ['acc123', 'acc456'] })
    })

    test('Deserialize empty array', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetAccountDataByListReqVersion)
      stream.writeUInt32(0)
      stream.position = 0

      const result = deserializeGetAccountDataByListReq(stream)
      expect(result).toEqual({ accountIds: [] })
    })

    test('Version mismatch error', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetAccountDataByListReqVersion + 1) // incorrect version
      stream.position = 0

      expect(() => deserializeGetAccountDataByListReq(stream)).toThrow(
        'GetAccountDataByListReq version mismatch'
      )
    })
  })

  describe('GetAccountDataByListReq Serialization and Deserialization Together', () => {
    test('Correct round-trip for non-empty array', () => {
      const originalObj = { accountIds: ['acc123', 'acc456'] }
      const stream = new VectorBufferStream(0)
      serializeGetAccountDataByListReq(stream, originalObj, false)
      stream.position = 0 // Reset for reading

      const deserializedObj = deserializeGetAccountDataByListReq(stream)
      expect(deserializedObj).toEqual(originalObj)
    })

    test('Correct round-trip for empty array', () => {
      const originalObj = { accountIds: [] }
      const stream = new VectorBufferStream(0)
      serializeGetAccountDataByListReq(stream, originalObj, false)
      stream.position = 0 // Reset for reading

      const deserializedObj = deserializeGetAccountDataByListReq(stream)
      expect(deserializedObj).toEqual(originalObj)
    })
  })
})
