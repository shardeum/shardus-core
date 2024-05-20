import { VectorBufferStream } from '../../../../src/utils/serialization/VectorBufferStream'
import {
  GetAccountDataByListResp,
  cGetAccountDataByListRespVersion,
  deserializeGetAccountDataByListResp,
  serializeGetAccountDataByListResp,
} from '../../../../src/types/GetAccountDataByListResp'
import { serializeWrappedData } from '../../../../src/types/WrappedData'
import { initAjvSchemas } from '../../../../src/types/ajv/Helpers'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'
import { DeSerializeFromJsonString, SerializeToJsonString } from '../../../../src/utils'

// Mock the Context module and its nested structure
jest.mock('../../../../src/p2p/Context', () => ({
  setDefaultConfigs: jest.fn(),
  stateManager: {
    app: {
      binarySerializeObject: jest.fn((enumType, data) => Buffer.from(SerializeToJsonString(data), 'utf8')),
      binaryDeserializeObject: jest.fn((enumType, buffer) =>
        DeSerializeFromJsonString(buffer.toString('utf8'))
      ),
    },
  },
}))

describe('GetAccountDataByListResp Serialization and Deserialization', () => {
  beforeAll(() => {
    initAjvSchemas()
  })
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Serialization', () => {
    describe('Valid Data Cases', () => {
      test('should serialize non-null accountData correctly with root true', () => {
        const obj: GetAccountDataByListResp = {
          accountData: [
            { accountId: 'acc123', stateId: 'state456', data: { detail: 'info' }, timestamp: 123456 },
          ],
        }
        const stream = new VectorBufferStream(0)
        serializeGetAccountDataByListResp(stream, obj, true)

        const expectedStream = new VectorBufferStream(0)
        expectedStream.writeUInt16(TypeIdentifierEnum.cGetAccountDataByListResp)
        expectedStream.writeUInt8(cGetAccountDataByListRespVersion) // version

        expectedStream.writeUInt8(1)
        expectedStream.writeUInt16(obj.accountData.length)
        for (const item of obj.accountData) {
          serializeWrappedData(expectedStream, item)
        }

        expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
      })

      test('should serialize non-null accountData correctly with root false', () => {
        const obj: GetAccountDataByListResp = {
          accountData: [
            { accountId: 'acc123', stateId: 'state456', data: { detail: 'info' }, timestamp: 123456 },
          ],
        }
        const stream = new VectorBufferStream(0)
        serializeGetAccountDataByListResp(stream, obj, false)

        const expectedStream = new VectorBufferStream(0)
        expectedStream.writeUInt8(cGetAccountDataByListRespVersion) // version
        expectedStream.writeUInt8(1)
        expectedStream.writeUInt16(obj.accountData.length)
        for (const item of obj.accountData) {
          serializeWrappedData(expectedStream, item)
        }

        expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
      })

      test('should handle null accountData correctly', () => {
        const obj: GetAccountDataByListResp = {
          accountData: null,
        }
        const stream = new VectorBufferStream(0)
        serializeGetAccountDataByListResp(stream, obj, false)

        const expectedStream = new VectorBufferStream(0)
        expectedStream.writeUInt8(cGetAccountDataByListRespVersion) // version
        expectedStream.writeUInt8(0) // Indicate that accountData is null

        expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
      })

      test('should serialize empty accountData array correctly', () => {
        const obj: GetAccountDataByListResp = {
          accountData: [],
        }
        const stream = new VectorBufferStream(0)
        serializeGetAccountDataByListResp(stream, obj, false)

        const expectedStream = new VectorBufferStream(0)
        expectedStream.writeUInt8(cGetAccountDataByListRespVersion) // version
        expectedStream.writeUInt8(1)
        expectedStream.writeUInt16(obj.accountData.length)
        for (const item of obj.accountData) {
          serializeWrappedData(expectedStream, item)
        }

        expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
      })
    })

    describe('Error Handling', () => {
      test('should throw validation error for invalid data', () => {
        const obj: any = {
          accountData: [
            { accountId: null, stateId: 'state456', data: { detail: 'info' }, timestamp: 123456 },
          ],
        }
        const stream = new VectorBufferStream(0)
        expect(() => serializeGetAccountDataByListResp(stream, obj, false)).toThrow('Data validation error')
      })
    })
  })

  describe('Deserialization', () => {
    test('should deserialize data correctly', () => {
      const obj = {
        accountData: [
          { accountId: 'acc123', stateId: 'state456', data: { detail: 'info' }, timestamp: 123456 },
        ],
      }
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetAccountDataByListRespVersion) // version
      stream.writeUInt8(1)
      stream.writeUInt16(obj.accountData.length)
      for (const item of obj.accountData) {
        serializeWrappedData(stream, item)
      }
      stream.position = 0 // Reset position for reading

      const expectedObj = deserializeGetAccountDataByListResp(stream)
      expect(expectedObj).toEqual({
        accountData: [
          {
            accountId: 'acc123',
            stateId: 'state456',
            data: { detail: 'info' },
            timestamp: 123456,
            syncData: undefined,
          },
        ],
      })
    })

    test('should handle null accountData correctly during deserialization', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetAccountDataByListRespVersion) // version
      stream.writeUInt8(0) // data presence indicator
      stream.position = 0 // Reset position for reading

      const obj = deserializeGetAccountDataByListResp(stream)
      expect(obj).toEqual({
        accountData: null,
      })
    })

    test('should throw version mismatch error', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetAccountDataByListRespVersion + 1) // incorrect version
      stream.position = 0 // Reset position for reading

      expect(() => deserializeGetAccountDataByListResp(stream)).toThrow(
        'GetAccountDataByListResp version mismatch'
      )
    })
  })

  describe('GetAccountDataByListResp Serialization and Deserialization Together', () => {
    test('should serialize and deserialize data correctly', () => {
      const originalObj: GetAccountDataByListResp = {
        accountData: [
          { accountId: 'acc123', stateId: 'state456', data: { detail: 'info' }, timestamp: 123456 },
        ],
      }

      // Serialize
      const stream = new VectorBufferStream(0)
      serializeGetAccountDataByListResp(stream, originalObj, false)
      stream.position = 0 // Reset stream position for reading

      // Deserialize
      const deserializedObj = deserializeGetAccountDataByListResp(stream)

      // Check that deserialized object matches original object
      expect(deserializedObj).toEqual(originalObj)
    })

    test('should handle null accountData during serialization and deserialization', () => {
      const originalObj: GetAccountDataByListResp = {
        accountData: null,
      }

      const stream = new VectorBufferStream(0)
      serializeGetAccountDataByListResp(stream, originalObj, false)
      stream.position = 0 // Reset stream position for reading

      const deserializedObj = deserializeGetAccountDataByListResp(stream)
      expect(deserializedObj).toEqual(originalObj)
    })

    test('should process empty accountData array during serialization and deserialization', () => {
      const originalObj: GetAccountDataByListResp = {
        accountData: [],
      }

      const stream = new VectorBufferStream(0)
      serializeGetAccountDataByListResp(stream, originalObj, false)
      stream.position = 0 // Reset stream position for reading

      const deserializedObj = deserializeGetAccountDataByListResp(stream)
      expect(deserializedObj).toEqual(originalObj)
    })
  })
})
