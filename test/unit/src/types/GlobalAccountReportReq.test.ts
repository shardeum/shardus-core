import { VectorBufferStream } from '../../../../src/utils/serialization/VectorBufferStream'
import {
  serializeGlobalAccountReportResp,
  deserializeGlobalAccountReportResp,
  GlobalAccountReportRespSerializable,
} from '../../../../src/types/GlobalAccountReportResp'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'
import { initAjvSchemas } from '../../../../src/types/ajv/Helpers'

describe('GlobalAccountReportResp Tests', () => {
  beforeAll(() => {
    initAjvSchemas()
  })

  test('Serialize error response with root true', () => {
    const obj: GlobalAccountReportRespSerializable = { error: 'Some error' }
    const stream = new VectorBufferStream(0)
    serializeGlobalAccountReportResp(stream, obj, true)
    stream.position = 0

    expect(stream.readUInt16()).toBe(TypeIdentifierEnum.cGlobalAccountReportResp)
    expect(stream.readUInt8()).toBe(1)
    expect(stream.readUInt8()).toBe(0)
    expect(stream.readString()).toBe('Some error')
  })

  test('Serialize success response with root false', () => {
    const obj: GlobalAccountReportRespSerializable = {
      ready: true,
      combinedHash: 'hash123',
      accounts: [
        { id: 'acc1', hash: 'hash1', timestamp: 123456 },
        { id: 'acc2', hash: 'hash2', timestamp: 654321 },
      ],
    }
    const stream = new VectorBufferStream(0)
    serializeGlobalAccountReportResp(stream, obj, false)
    stream.position = 0

    expect(stream.readUInt8()).toBe(1)
    expect(stream.readUInt8()).toBe(1)
    expect(stream.readString()).toBe('hash123')
    expect(stream.readUInt32()).toBe(2)
    expect(stream.readString()).toBe('acc1')
    expect(stream.readString()).toBe('hash1')
    expect(Number(stream.readBigUInt64())).toBe(123456)
    expect(stream.readString()).toBe('acc2')
    expect(stream.readString()).toBe('hash2')
    expect(Number(stream.readBigUInt64())).toBe(654321)
    expect(stream.readUInt8()).toBe(1)
  })

  test('Deserialize error response', () => {
    const stream = new VectorBufferStream(0)
    stream.writeUInt8(1)
    stream.writeUInt8(0)
    stream.writeString('Some error')
    stream.position = 0

    const result = deserializeGlobalAccountReportResp(stream)
    expect(result).toEqual({ error: 'Some error' })
  })

  test('Deserialize success response', () => {
    const stream = new VectorBufferStream(0)
    stream.writeUInt8(1)
    stream.writeUInt8(1)
    stream.writeString('hash123')
    stream.writeUInt32(2)
    stream.writeString('acc1')
    stream.writeString('hash1')
    stream.writeBigUInt64(BigInt(123456))
    stream.writeString('acc2')
    stream.writeString('hash2')
    stream.writeBigUInt64(BigInt(654321))
    stream.writeUInt8(1)
    stream.position = 0

    const result = deserializeGlobalAccountReportResp(stream)
    expect(result).toEqual({
      ready: true,
      combinedHash: 'hash123',
      accounts: [
        { id: 'acc1', hash: 'hash1', timestamp: 123456 },
        { id: 'acc2', hash: 'hash2', timestamp: 654321 },
      ],
    })
  })

  test('Deserialize with version mismatch', () => {
    const stream = new VectorBufferStream(0)
    stream.writeUInt8(2)
    stream.position = 0

    expect(() => deserializeGlobalAccountReportResp(stream)).toThrow(
      'GlobalAccountReportRespSerializable version mismatch'
    )
  })

  test('Serialize and deserialize with empty accounts array', () => {
    const obj: GlobalAccountReportRespSerializable = {
      ready: true,
      combinedHash: 'hash123',
      accounts: [],
    }
    const stream = new VectorBufferStream(0)
    serializeGlobalAccountReportResp(stream, obj, false)
    stream.position = 0

    const result = deserializeGlobalAccountReportResp(stream)
    expect(result).toEqual(obj)
  })

  test('Serialize and deserialize with null values', () => {
    const obj: GlobalAccountReportRespSerializable = {
      ready: false,
      combinedHash: '',
      accounts: [],
    }
    const stream = new VectorBufferStream(0)
    serializeGlobalAccountReportResp(stream, obj, false)
    stream.position = 0

    const result = deserializeGlobalAccountReportResp(stream)
    expect(result).toEqual(obj)
  })

  test('Round-trip serialization and deserialization', () => {
    const originalObj: GlobalAccountReportRespSerializable = {
      ready: true,
      combinedHash: 'hash123',
      accounts: [
        { id: 'acc1', hash: 'hash1', timestamp: 123456 },
        { id: 'acc2', hash: 'hash2', timestamp: 654321 },
      ],
    }
    const stream = new VectorBufferStream(0)
    serializeGlobalAccountReportResp(stream, originalObj, false)
    stream.position = 0

    const deserializedObj = deserializeGlobalAccountReportResp(stream)
    expect(deserializedObj).toEqual(originalObj)
  })
})
