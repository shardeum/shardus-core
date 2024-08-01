import { VectorBufferStream } from '../../../../src'
import {
  cGetAccountQueueCountReqVersion,
  deserializeGetAccountQueueCountReq,
  serializeGetAccountQueueCountReq,
} from '../../../../src/types/GetAccountQueueCountReq'
import { initAjvSchemas } from '../../../../src/types/ajv/Helpers'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'

describe('serializeGetAccountQueueCountReq', () => {
  test('should serialize with root = true', () => {
    const stream = new VectorBufferStream(0)
    const obj = { accountIds: ['account1', 'account2'] }
    serializeGetAccountQueueCountReq(stream, obj, true)

    const expectedStream = new VectorBufferStream(0)
    expectedStream.writeUInt16(TypeIdentifierEnum.cGetAccountQueueCountReq) // typeId
    expectedStream.writeUInt8(cGetAccountQueueCountReqVersion)
    expectedStream.writeUInt32(2) // length
    expectedStream.writeString('account1')
    expectedStream.writeString('account2')

    expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
  })

  test('should serialize with root = false', () => {
    const stream = new VectorBufferStream(0)
    const obj = { accountIds: ['account1', 'account2'] }
    serializeGetAccountQueueCountReq(stream, obj, false)
    const expectedStream = new VectorBufferStream(0)
    expectedStream.writeUInt8(cGetAccountQueueCountReqVersion)
    expectedStream.writeUInt32(2) // length
    expectedStream.writeString('account1')
    expectedStream.writeString('account2')
    true
    expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
  })

  test('should serialize with empty accountIds array', () => {
    const stream = new VectorBufferStream(0)
    const obj = { accountIds: [] }
    serializeGetAccountQueueCountReq(stream, obj, false)
    const expectedStream = new VectorBufferStream(0)
    expectedStream.writeUInt8(cGetAccountQueueCountReqVersion)
    expectedStream.writeUInt32(0) // length
    expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
  })
})

describe('deserializeGetAccountQueueCountReq', () => {
  beforeAll(() => {
    initAjvSchemas()
  })
  test('should deserialize with valid data', () => {
    const stream = new VectorBufferStream(0)
    stream.writeUInt8(cGetAccountQueueCountReqVersion)
    stream.writeUInt32(2) // length
    stream.writeString('account1')
    stream.writeString('account2')

    stream.position = 0
    const result = deserializeGetAccountQueueCountReq(stream)
    expect(result).toEqual({ accountIds: ['account1', 'account2'] })
  })

  test('should throw error with version mismatch', () => {
    const stream = new VectorBufferStream(0)
    const obj = { accountIds: ['account1', 'account2'] }
    serializeGetAccountQueueCountReq(stream, obj, false)
    const buffer = stream.getBuffer()
    buffer[0] = cGetAccountQueueCountReqVersion + 1
    const alteredStream = VectorBufferStream.fromBuffer(buffer)

    expect(() => deserializeGetAccountQueueCountReq(alteredStream)).toThrow(
      'GetAccountQueueCountReq version mismatch'
    )
  })

  test('should deserialize with empty accountIds array', () => {
    const stream = new VectorBufferStream(0)
    const obj = { accountIds: [] }
    serializeGetAccountQueueCountReq(stream, obj, false)
    stream.position = 0
    const result = deserializeGetAccountQueueCountReq(stream)
    expect(result).toEqual({ accountIds: [] })
  })
})

describe('deserializeGetAccountQueueCountReq Serialization and Deserialization Together', () => {
  test.each([{ accountIds: [] }, { accountIds: ['accountId1', 'accountdId2'] }])(
    'should serialize and deserialize maintaining data integrity for %#',
    (originalObj) => {
      const stream = new VectorBufferStream(0)
      serializeGetAccountQueueCountReq(stream, originalObj, false)
      stream.position = 0 // Reset position for reading

      const deserializedObj = deserializeGetAccountQueueCountReq(stream)
      expect(deserializedObj).toEqual(originalObj)
    }
  )
})
