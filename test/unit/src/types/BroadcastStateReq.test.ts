import { Utils } from '@shardus/types'
import { initAjvSchemas } from '../../../../src/types/ajv/Helpers'
import {
  BroadcastStateReq,
  cBroadcastStateReqVersion,
  deserializeBroadcastStateReq,
  serializeBroadcastStateReq,
} from '../../../../src/types/BroadcastStateReq'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'
import { serializeWrappedDataResponse } from '../../../../src/types/WrappedDataResponse'
import { VectorBufferStream } from '../../../../src'

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

describe('BroadcastStateReq Serialization Tests', () => {
  beforeAll(() => {
    initAjvSchemas()
  })
  beforeEach(() => {
    jest.clearAllMocks()
  })
  test('Serialize BroadcastStateReq with Valid Input Correctly, root true', () => {
    const stream = new VectorBufferStream(0)
    const obj: BroadcastStateReq = {
      txid: 'testTxid',
      stateList: [
        {
          accountCreated: true,
          isPartial: true,
          accountId: 'id1',
          stateId: 'stateid2',
          data: {},
          timestamp: 12345678,
        },
      ],
    }
    serializeBroadcastStateReq(stream, obj, true)

    const expectedStream = new VectorBufferStream(0)
    expectedStream.writeUInt16(TypeIdentifierEnum.cBroadcastStateReq)
    expectedStream.writeUInt8(cBroadcastStateReqVersion)
    expectedStream.writeString(obj.txid)
    expectedStream.writeUInt16(obj.stateList.length)
    obj.stateList.forEach((item) => serializeWrappedDataResponse(expectedStream, item))

    expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
  })

  test('Handle Empty StateList Correctly', () => {
    const stream = new VectorBufferStream(0)
    const obj: BroadcastStateReq = { txid: 'testTxid', stateList: [] }
    serializeBroadcastStateReq(stream, obj, true)

    const expectedStream = new VectorBufferStream(0)
    expectedStream.writeUInt16(TypeIdentifierEnum.cBroadcastStateReq)
    expectedStream.writeUInt8(cBroadcastStateReqVersion)
    expectedStream.writeString(obj.txid)
    expectedStream.writeUInt16(obj.stateList.length)
    obj.stateList.forEach((item) => serializeWrappedDataResponse(expectedStream, item))

    expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
  })

  test('Serialize with Root Flag Set to False', () => {
    const stream = new VectorBufferStream(0)
    const obj: BroadcastStateReq = {
      txid: 'testTxid',
      stateList: [
        {
          accountCreated: true,
          isPartial: true,
          accountId: 'id1',
          stateId: 'stateid2',
          data: {},
          timestamp: 12345678,
        },
      ],
    }
    serializeBroadcastStateReq(stream, obj, false)

    const expectedStream = new VectorBufferStream(0)
    expectedStream.writeUInt8(cBroadcastStateReqVersion)
    expectedStream.writeString(obj.txid)
    expectedStream.writeUInt16(obj.stateList.length)
    obj.stateList.forEach((item) => serializeWrappedDataResponse(expectedStream, item))

    expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
  })
})

describe('BroadcastStateReq Deserialization Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })
  test('Deserialize Data Correctly', () => {
    const stream = new VectorBufferStream(0)
    stream.writeUInt8(cBroadcastStateReqVersion)
    stream.writeString('testTxid')
    stream.writeUInt16(1)
    serializeWrappedDataResponse(stream, {
      accountCreated: true,
      isPartial: true,
      accountId: 'id1',
      stateId: 'stateid2',
      data: {},
      timestamp: 12345678,
    })

    stream.position = 0
    const result = deserializeBroadcastStateReq(stream)

    const expected: BroadcastStateReq = {
      txid: 'testTxid',
      stateList: [
        {
          accountCreated: true,
          isPartial: true,
          accountId: 'id1',
          stateId: 'stateid2',
          data: {},
          timestamp: 12345678,
        },
      ],
    }
    expect(result).toEqual(expected)
  })

  test('Throw Error on Version Mismatch', () => {
    const obj: BroadcastStateReq = {
      txid: 'testTxid',
      stateList: [
        {
          accountCreated: true,
          isPartial: true,
          accountId: 'id1',
          stateId: 'stateid2',
          data: {},
          timestamp: 12345678,
        },
      ],
    }
    const stream = new VectorBufferStream(0)
    serializeBroadcastStateReq(stream, obj, false)
    // Manually increase the version number in the buffer to simulate a mismatch
    const buffer = stream.getBuffer()
    buffer[0] = cBroadcastStateReqVersion + 1
    const alteredStream = VectorBufferStream.fromBuffer(buffer)

    expect(() => deserializeBroadcastStateReq(alteredStream)).toThrow('BroadcastStateReq version mismatch')
  })
})

describe('BroadcastStateReq Round-trip Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })
  test('Maintain Data Integrity Through Serialization and Deserialization', () => {
    const stream = new VectorBufferStream(0)
    const obj: BroadcastStateReq = {
      txid: 'testTxid',
      stateList: [
        {
          accountCreated: true,
          isPartial: true,
          accountId: 'id1',
          stateId: 'stateid2',
          data: {},
          timestamp: 12345678,
        },
      ],
    }
    serializeBroadcastStateReq(stream, obj, false)
    stream.position = 0

    const result = deserializeBroadcastStateReq(stream)

    expect(result).toEqual(obj)
  })
})
