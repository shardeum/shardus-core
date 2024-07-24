import { Utils } from '@shardus/types'
import { VectorBufferStream } from '../../../../src'
import {
  RequestStateForTxPostResp,
  cRequestStateForTxPostRespVersion,
  deserializeRequestStateForTxPostResp,
  serializeRequestStateForTxPostResp,
} from '../../../../src/types/RequestStateForTxPostResp'
import { serializeWrappedDataResponse } from '../../../../src/types/WrappedDataResponse'
import { initAjvSchemas } from '../../../../src/types/ajv/Helpers'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'
import { WrappedDataResponse } from '../../../../src/types/WrappedDataResponse'

// Mock the Context module and its nested structure
jest.mock('../../../../src/p2p/Context', () => ({
  setDefaultConfigs: jest.fn(),
  stateManager: {
    app: {
      binarySerializeObject: jest.fn((enumType, data) => Buffer.from(Utils.safeStringify(data), 'utf8')),
      binaryDeserializeObject: jest.fn((enumType, buffer) => Utils.safeJsonParse(buffer.toString('utf8'))),
    },
  },
}))

describe('RequestStateForTxPostResp Tests', () => {
  beforeAll(() => {
    initAjvSchemas()
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Serialization Tests', () => {
    test('Serialize valid data with root true', () => {
      const obj: RequestStateForTxPostResp = {
        stateList: [
          {
            data: 'data1',
            version: 1,
            accountCreated: true,
            isPartial: false,
            accountId: 'accountId1',
            stateId: 'stateId1',
            timestamp: Date.now(),
          } as WrappedDataResponse,
        ],
        beforeHashes: { account1: 'hash1' },
        note: 'test note',
        success: true,
      }
      const stream = new VectorBufferStream(0)
      serializeRequestStateForTxPostResp(stream, obj, true)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt16(TypeIdentifierEnum.cRequestStateForTxPostResp)
      expectedStream.writeUInt8(cRequestStateForTxPostRespVersion)
      expectedStream.writeUInt8(obj.success ? 1 : 0)
      expectedStream.writeString(obj.note)
      expectedStream.writeUInt16(obj.stateList.length)
      Object.entries(obj.beforeHashes).forEach(([key, value]) => {
        expectedStream.writeString(key)
        expectedStream.writeString(value)
      })
      expectedStream.writeUInt16(Object.keys(obj.beforeHashes).length)
      obj.stateList.forEach((item) => serializeWrappedDataResponse(expectedStream, item))
      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('Serialize valid data with root false', () => {
      const obj: RequestStateForTxPostResp = {
        stateList: [
          {
            data: 'data1',
            version: 1,
            accountCreated: true,
            isPartial: false,
            accountId: 'accountId1',
            stateId: 'stateId1',
            timestamp: Date.now(),
          } as WrappedDataResponse,
        ],
        beforeHashes: { account1: 'hash1' },
        note: 'test note',
        success: true,
      }
      const stream = new VectorBufferStream(0)
      serializeRequestStateForTxPostResp(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cRequestStateForTxPostRespVersion)
      expectedStream.writeUInt8(obj.success ? 1 : 0)
      expectedStream.writeString(obj.note)
      expectedStream.writeUInt16(Object.keys(obj.beforeHashes).length)
      Object.entries(obj.beforeHashes).forEach(([key, value]) => {
        expectedStream.writeString(key)
        expectedStream.writeString(value)
      })
      expectedStream.writeUInt16(obj.stateList.length)
      obj.stateList.forEach((item) => serializeWrappedDataResponse(expectedStream, item))
      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('Serialize empty stateList with root false', () => {
      const obj: RequestStateForTxPostResp = {
        stateList: [],
        beforeHashes: { account1: 'hash1' },
        note: 'test note',
        success: true,
      }
      const stream = new VectorBufferStream(0)
      serializeRequestStateForTxPostResp(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cRequestStateForTxPostRespVersion)
      expectedStream.writeUInt8(obj.success ? 1 : 0)
      expectedStream.writeString(obj.note)
      expectedStream.writeUInt16(Object.keys(obj.beforeHashes).length)
      Object.entries(obj.beforeHashes).forEach(([key, value]) => {
        expectedStream.writeString(key)
        expectedStream.writeString(value)
      })
      expectedStream.writeUInt16(obj.stateList.length)
      obj.stateList.forEach((item) => serializeWrappedDataResponse(expectedStream, item))
      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })
  })

  describe('Deserialization Tests', () => {
    test('Deserialize valid data', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cRequestStateForTxPostRespVersion)
      stream.writeUInt8(1) // success
      stream.writeString('test note')
      stream.writeUInt16(1) // beforeHashes length
      stream.writeString('account1')
      stream.writeString('hash1')
      stream.writeUInt16(1) // stateList length
      serializeWrappedDataResponse(stream, {
        accountId: 'accountId1',
        stateId: 'stateId1',
        data: { detail: 'info' },
        timestamp: 123456,
        accountCreated: true,
        isPartial: false,
      })
      stream.position = 0

      const result = deserializeRequestStateForTxPostResp(stream)
      const expected = {
        success: true,
        note: 'test note',
        beforeHashes: { account1: 'hash1' },
        stateList: [
          {
            accountId: 'accountId1',
            stateId: 'stateId1',
            data: { detail: 'info' },
            timestamp: 123456,
            accountCreated: true,
            isPartial: false,
          },
        ],
      }
      expect(result).toEqual(expected)
    })

    test('Version mismatch error', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cRequestStateForTxPostRespVersion + 1)
      stream.position = 0

      expect(() => deserializeRequestStateForTxPostResp(stream)).toThrow(
        'RequestStateForTxPostResp version mismatch'
      )
    })

    test('Deserialize empty stateList', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cRequestStateForTxPostRespVersion)
      stream.writeUInt8(1) // success
      stream.writeString('test note')
      stream.writeUInt16(1) // beforeHashes length
      stream.writeString('account1')
      stream.writeString('hash1')
      stream.writeUInt16(0) // stateList length
      stream.position = 0
      const result = deserializeRequestStateForTxPostResp(stream)
      const expected = {
        stateList: [],
        beforeHashes: { account1: 'hash1' },
        note: 'test note',
        success: true,
      }
      expect(result).toEqual(expected)
    })
  })

  describe('Serialization and Deserialization Together', () => {
    test('Correct round-trip for non-empty stateList', () => {
      const originalObj: RequestStateForTxPostResp = {
        stateList: [
          {
            accountId: 'accountId1',
            stateId: 'stateId1',
            data: { detail: 'info' },
            timestamp: 123456,
            accountCreated: true,
            isPartial: false,
          } as WrappedDataResponse,
        ],
        beforeHashes: { account1: 'hash1' },
        note: 'test note',
        success: true,
      }
      const stream = new VectorBufferStream(0)
      serializeRequestStateForTxPostResp(stream, originalObj, false)
      stream.position = 0

      const deserializedObj = deserializeRequestStateForTxPostResp(stream)
      expect(deserializedObj).toEqual(originalObj)
    })

    test('Correct round-trip for empty stateList', () => {
      const originalObj: RequestStateForTxPostResp = {
        stateList: [],
        beforeHashes: { account1: 'hash1' },
        note: 'test note',
        success: true,
      }
      const stream = new VectorBufferStream(0)
      serializeRequestStateForTxPostResp(stream, originalObj, false)
      stream.position = 0

      const deserializedObj = deserializeRequestStateForTxPostResp(stream)
      expect(deserializedObj).toEqual(originalObj)
    })
  })
})
