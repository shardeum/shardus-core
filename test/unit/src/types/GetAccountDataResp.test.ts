import { VectorBufferStream } from '../../../../src/utils/serialization/VectorBufferStream'
import {
  GetAccountDataRespSerializable,
  deserializeGetAccountDataResp,
  serializeGetAccountDataResp,
} from '../../../../src/types/GetAccountDataResp'
import { serializeWrappedData } from '../../../../src/types/WrappedData'
import { initAjvSchemas } from '../../../../src/types/ajv/Helpers'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'

// Mock the Context module and its nested structure
jest.mock('../../../../src/p2p/Context', () => ({
  setDefaultConfigs: jest.fn(),
  stateManager: {
    app: {
      binarySerializeObject: jest.fn((enumType, data) => Buffer.from(JSON.stringify(data), 'utf8')),
      binaryDeserializeObject: jest.fn((enumType, buffer) => JSON.parse(buffer.toString('utf8'))),
    },
  },
}))

const cGetAccountDataRespVersion = 1

describe('GetAccountDataRespSerializable Serialization and Deserialization', () => {
  beforeAll(() => {
    initAjvSchemas()
  })
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Serialization', () => {
    test('should serialize data correctly with root true', () => {
      const obj: GetAccountDataRespSerializable = {
        data: {
          wrappedAccounts: [
            {
              accountId: 'acc123',
              stateId: 'state456',
              data: { detail: 'info' },
              timestamp: 123456,
              syncData: { syncDetail: 'syncInfo' },
            },
          ],
          lastUpdateNeeded: true,
          wrappedAccounts2: [
            {
              accountId: 'acc789',
              stateId: 'state012',
              data: { detail: 'info2' },
              timestamp: 654321,
              syncData: { syncDetail: 'syncInfo2' },
            },
          ],
          highestTs: 987654,
          delta: 123,
        },
        errors: [],
      }
      const stream = new VectorBufferStream(0)
      serializeGetAccountDataResp(stream, obj, true)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt16(TypeIdentifierEnum.cGetAccountDataResp)
      expectedStream.writeUInt8(cGetAccountDataRespVersion)
      expectedStream.writeUInt8(1)
      expectedStream.writeUInt16(obj.data.wrappedAccounts.length)
      for (const item of obj.data.wrappedAccounts) {
        serializeWrappedData(expectedStream, item)
      }
      expectedStream.writeUInt8(obj.data.lastUpdateNeeded ? 1 : 0)
      expectedStream.writeUInt16(obj.data.wrappedAccounts2.length)
      for (const item of obj.data.wrappedAccounts2) {
        serializeWrappedData(expectedStream, item)
      }
      expectedStream.writeBigUInt64(BigInt(obj.data.highestTs))
      expectedStream.writeBigUInt64(BigInt(obj.data.delta))
      expectedStream.writeUInt8(1)
      expectedStream.writeUInt16(obj.errors.length)

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should serialize data correctly with root false', () => {
      const obj: GetAccountDataRespSerializable = {
        data: {
          wrappedAccounts: [
            {
              accountId: 'acc123',
              stateId: 'state456',
              data: { detail: 'info' },
              timestamp: 123456,
              syncData: { syncDetail: 'syncInfo' },
            },
          ],
          lastUpdateNeeded: true,
          wrappedAccounts2: [
            {
              accountId: 'acc789',
              stateId: 'state012',
              data: { detail: 'info2' },
              timestamp: 654321,
              syncData: { syncDetail: 'syncInfo2' },
            },
          ],
          highestTs: 987654,
          delta: 123,
        },
        errors: [],
      }
      const stream = new VectorBufferStream(0)
      serializeGetAccountDataResp(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetAccountDataRespVersion)
      expectedStream.writeUInt8(1)
      expectedStream.writeUInt16(obj.data.wrappedAccounts.length)
      for (const item of obj.data.wrappedAccounts) {
        serializeWrappedData(expectedStream, item)
      }
      expectedStream.writeUInt8(obj.data.lastUpdateNeeded ? 1 : 0)
      expectedStream.writeUInt16(obj.data.wrappedAccounts2.length)
      for (const item of obj.data.wrappedAccounts2) {
        serializeWrappedData(expectedStream, item)
      }
      expectedStream.writeBigUInt64(BigInt(obj.data.highestTs))
      expectedStream.writeBigUInt64(BigInt(obj.data.delta))
      expectedStream.writeUInt8(1)
      expectedStream.writeUInt16(obj.errors.length)

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should handle null data correctly', () => {
      const obj: GetAccountDataRespSerializable = {
        data: undefined,
        errors: [],
      }
      const stream = new VectorBufferStream(0)
      serializeGetAccountDataResp(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetAccountDataRespVersion)
      expectedStream.writeUInt8(0)
      expectedStream.writeUInt8(1)
      expectedStream.writeUInt16(obj.errors.length)

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should handle null errors correctly', () => {
      const obj: GetAccountDataRespSerializable = {
        data: {
          wrappedAccounts: [
            {
              accountId: 'acc123',
              stateId: 'state456',
              data: { detail: 'info' },
              timestamp: 123456,
              syncData: { syncDetail: 'syncInfo' },
            },
          ],
          lastUpdateNeeded: true,
          wrappedAccounts2: [
            {
              accountId: 'acc789',
              stateId: 'state012',
              data: { detail: 'info2' },
              timestamp: 654321,
              syncData: { syncDetail: 'syncInfo2' },
            },
          ],
          highestTs: 987654,
          delta: 123,
        },
        errors: undefined,
      }
      const stream = new VectorBufferStream(0)
      serializeGetAccountDataResp(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetAccountDataRespVersion)
      expectedStream.writeUInt8(1)
      expectedStream.writeUInt16(obj.data.wrappedAccounts.length)
      for (const item of obj.data.wrappedAccounts) {
        serializeWrappedData(expectedStream, item)
      }
      expectedStream.writeUInt8(obj.data.lastUpdateNeeded ? 1 : 0)
      expectedStream.writeUInt16(obj.data.wrappedAccounts2.length)
      for (const item of obj.data.wrappedAccounts2) {
        serializeWrappedData(expectedStream, item)
      }
      expectedStream.writeBigUInt64(BigInt(obj.data.highestTs))
      expectedStream.writeBigUInt64(BigInt(obj.data.delta))
      expectedStream.writeUInt8(0)

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should serialize empty errors array correctly', () => {
      const obj: GetAccountDataRespSerializable = {
        data: {
          wrappedAccounts: [
            {
              accountId: 'acc123',
              stateId: 'state456',
              data: { detail: 'info' },
              timestamp: 123456,
              syncData: { syncDetail: 'syncInfo' },
            },
          ],
          lastUpdateNeeded: true,
          wrappedAccounts2: [
            {
              accountId: 'acc789',
              stateId: 'state012',
              data: { detail: 'info2' },
              timestamp: 654321,
              syncData: { syncDetail: 'syncInfo2' },
            },
          ],
          highestTs: 987654,
          delta: 123,
        },
        errors: [],
      }
      const stream = new VectorBufferStream(0)
      serializeGetAccountDataResp(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetAccountDataRespVersion)
      expectedStream.writeUInt8(1)
      expectedStream.writeUInt16(obj.data.wrappedAccounts.length)
      for (const item of obj.data.wrappedAccounts) {
        serializeWrappedData(expectedStream, item)
      }
      expectedStream.writeUInt8(obj.data.lastUpdateNeeded ? 1 : 0)
      expectedStream.writeUInt16(obj.data.wrappedAccounts2.length)
      for (const item of obj.data.wrappedAccounts2) {
        serializeWrappedData(expectedStream, item)
      }
      expectedStream.writeBigUInt64(BigInt(obj.data.highestTs))
      expectedStream.writeBigUInt64(BigInt(obj.data.delta))
      expectedStream.writeUInt8(1)
      expectedStream.writeUInt16(obj.errors.length)

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should handle empty wrappedAccounts array correctly', () => {
      const obj: GetAccountDataRespSerializable = {
        data: {
          wrappedAccounts: [],
          lastUpdateNeeded: true,
          wrappedAccounts2: [],
          highestTs: 987654,
          delta: 123,
        },
        errors: [],
      }
      const stream = new VectorBufferStream(0)
      serializeGetAccountDataResp(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetAccountDataRespVersion)
      expectedStream.writeUInt8(1)
      expectedStream.writeUInt16(obj.data.wrappedAccounts.length)
      expectedStream.writeUInt8(obj.data.lastUpdateNeeded ? 1 : 0)
      expectedStream.writeUInt16(obj.data.wrappedAccounts2.length)
      expectedStream.writeBigUInt64(BigInt(obj.data.highestTs))
      expectedStream.writeBigUInt64(BigInt(obj.data.delta))
      expectedStream.writeUInt8(1)
      expectedStream.writeUInt16(obj.errors.length)

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })
  })

  describe('Deserialization', () => {
    test('should deserialize data correctly', () => {
      const obj = {
        data: {
          wrappedAccounts: [
            {
              accountId: 'acc123',
              stateId: 'state456',
              data: { detail: 'info' },
              timestamp: 123456,
              syncData: { syncDetail: 'syncInfo' },
            },
          ],
          lastUpdateNeeded: true,
          wrappedAccounts2: [
            {
              accountId: 'acc789',
              stateId: 'state012',
              data: { detail: 'info2' },
              timestamp: 654321,
              syncData: { syncDetail: 'syncInfo2' },
            },
          ],
          highestTs: 987654,
          delta: 123,
        },
        errors: [],
      }
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetAccountDataRespVersion)
      stream.writeUInt8(1)
      stream.writeUInt16(obj.data.wrappedAccounts.length)
      for (const item of obj.data.wrappedAccounts) {
        serializeWrappedData(stream, item)
      }
      stream.writeUInt8(obj.data.lastUpdateNeeded ? 1 : 0)
      stream.writeUInt16(obj.data.wrappedAccounts2.length)
      for (const item of obj.data.wrappedAccounts2) {
        serializeWrappedData(stream, item)
      }
      stream.writeBigUInt64(BigInt(obj.data.highestTs))
      stream.writeBigUInt64(BigInt(obj.data.delta))
      stream.writeUInt8(1)
      stream.writeUInt16(obj.errors.length)
      stream.position = 0

      const expectedObj = deserializeGetAccountDataResp(stream)
      expect(expectedObj).toEqual(obj)
    })

    test('should handle null data correctly during deserialization', () => {
      const obj = {
        data: undefined,
        errors: [],
      }
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetAccountDataRespVersion)
      stream.writeUInt8(0)
      stream.writeUInt8(1)
      stream.writeUInt16(obj.errors.length)
      stream.position = 0

      const expectedObj = deserializeGetAccountDataResp(stream)
      expect(expectedObj).toEqual(obj)
    })

    test('should handle null errors correctly during deserialization', () => {
      const obj = {
        data: {
          wrappedAccounts: [
            {
              accountId: 'acc123',
              stateId: 'state456',
              data: { detail: 'info' },
              timestamp: 123456,
              syncData: { syncDetail: 'syncInfo' },
            },
          ],
          lastUpdateNeeded: true,
          wrappedAccounts2: [
            {
              accountId: 'acc789',
              stateId: 'state012',
              data: { detail: 'info2' },
              timestamp: 654321,
              syncData: { syncDetail: 'syncInfo2' },
            },
          ],
          highestTs: 987654,
          delta: 123,
        },
        errors: undefined,
      }
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetAccountDataRespVersion)
      stream.writeUInt8(1)
      stream.writeUInt16(obj.data.wrappedAccounts.length)
      for (const item of obj.data.wrappedAccounts) {
        serializeWrappedData(stream, item)
      }
      stream.writeUInt8(obj.data.lastUpdateNeeded ? 1 : 0)
      stream.writeUInt16(obj.data.wrappedAccounts2.length)
      for (const item of obj.data.wrappedAccounts2) {
        serializeWrappedData(stream, item)
      }
      stream.writeBigUInt64(BigInt(obj.data.highestTs))
      stream.writeBigUInt64(BigInt(obj.data.delta))
      stream.writeUInt8(0)
      stream.position = 0

      const expectedObj = deserializeGetAccountDataResp(stream)
      expect(expectedObj).toEqual(obj)
    })

    test('should handle empty wrappedAccounts array correctly during deserialization', () => {
      const obj = {
        data: {
          wrappedAccounts: [],
          lastUpdateNeeded: true,
          wrappedAccounts2: [],
          highestTs: 987654,
          delta: 123,
        },
        errors: [],
      }
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetAccountDataRespVersion)
      stream.writeUInt8(1)
      stream.writeUInt16(obj.data.wrappedAccounts.length)
      stream.writeUInt8(obj.data.lastUpdateNeeded ? 1 : 0)
      stream.writeUInt16(obj.data.wrappedAccounts2.length)
      stream.writeBigUInt64(BigInt(obj.data.highestTs))
      stream.writeBigUInt64(BigInt(obj.data.delta))
      stream.writeUInt8(1)
      stream.writeUInt16(obj.errors.length)
      stream.position = 0

      const expectedObj = deserializeGetAccountDataResp(stream)
      expect(expectedObj).toEqual(obj)
    })

    test('should throw version mismatch error', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetAccountDataRespVersion + 1)
      stream.position = 0

      expect(() => deserializeGetAccountDataResp(stream)).toThrow('GetAccountDataResp version mismatch')
    })

    test('should deserialize data correctly when data is present', () => {
      const obj = {
        data: {
          wrappedAccounts: [
            {
              accountId: 'acc123',
              stateId: 'state456',
              data: { detail: 'info' },
              timestamp: 123456,
              syncData: { syncDetail: 'syncInfo' },
            },
          ],
          lastUpdateNeeded: true,
          wrappedAccounts2: [
            {
              accountId: 'acc789',
              stateId: 'state012',
              data: { detail: 'info2' },
              timestamp: 654321,
              syncData: { syncDetail: 'syncInfo2' },
            },
          ],
          highestTs: 987654,
          delta: 123,
        },
        errors: [],
      }
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetAccountDataRespVersion)
      stream.writeUInt8(1) // data is present
      stream.writeUInt16(obj.data.wrappedAccounts.length)
      for (const item of obj.data.wrappedAccounts) {
        serializeWrappedData(stream, item)
      }
      stream.writeUInt8(obj.data.lastUpdateNeeded ? 1 : 0)
      stream.writeUInt16(obj.data.wrappedAccounts2.length)
      for (const item of obj.data.wrappedAccounts2) {
        serializeWrappedData(stream, item)
      }
      stream.writeBigUInt64(BigInt(obj.data.highestTs))
      stream.writeBigUInt64(BigInt(obj.data.delta))
      stream.writeUInt8(1) // errors is not null
      stream.writeUInt16(obj.errors.length) // write empty array length
      stream.position = 0

      const expectedObj = deserializeGetAccountDataResp(stream)
      expect(expectedObj).toEqual(obj)
    })
  })

  describe('Serialization and Deserialization Together', () => {
    test('should serialize and deserialize data correctly', () => {
      const originalObj: GetAccountDataRespSerializable = {
        data: {
          wrappedAccounts: [
            {
              accountId: 'acc123',
              stateId: 'state456',
              data: { detail: 'info' },
              timestamp: 123456,
              syncData: { syncDetail: 'syncInfo' },
            },
          ],
          lastUpdateNeeded: true,
          wrappedAccounts2: [
            {
              accountId: 'acc789',
              stateId: 'state012',
              data: { detail: 'info2' },
              timestamp: 654321,
              syncData: { syncDetail: 'syncInfo2' },
            },
          ],
          highestTs: 987654,
          delta: 123,
        },
        errors: [],
      }

      const stream = new VectorBufferStream(0)
      serializeGetAccountDataResp(stream, originalObj, false)
      stream.position = 0

      const deserializedObj = deserializeGetAccountDataResp(stream)
      expect(deserializedObj).toEqual(originalObj)
    })

    test('should handle null data during serialization and deserialization', () => {
      const originalObj: GetAccountDataRespSerializable = {
        data: undefined,
        errors: [],
      }

      const stream = new VectorBufferStream(0)
      serializeGetAccountDataResp(stream, originalObj, false)
      stream.position = 0

      const deserializedObj = deserializeGetAccountDataResp(stream)
      expect(deserializedObj).toEqual(originalObj)
    })

    test('should handle empty wrappedAccounts array during serialization and deserialization', () => {
      const originalObj: GetAccountDataRespSerializable = {
        data: {
          wrappedAccounts: [],
          lastUpdateNeeded: true,
          wrappedAccounts2: [],
          highestTs: 987654,
          delta: 123,
        },
        errors: [],
      }

      const stream = new VectorBufferStream(0)
      serializeGetAccountDataResp(stream, originalObj, false)
      stream.position = 0

      const deserializedObj = deserializeGetAccountDataResp(stream)
      expect(deserializedObj).toEqual(originalObj)
    })
  })
})
