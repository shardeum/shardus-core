import { Utils } from '@shardus/types'
import { VectorBufferStream } from '../../../../src'
import {
  GetAccountDataByHashesResp,
  cGetAccountDataByHashesRespVersion,
  deserializeGetAccountDataByHashesResp,
  serializeGetAccountDataByHashesResp,
} from '../../../../src/types/GetAccountDataByHashesResp'
import { serializeWrappedData } from '../../../../src/types/WrappedData'
import { initAjvSchemas } from '../../../../src/types/ajv/Helpers'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'

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

describe('GetAccountDataByHashesResp Tests', () => {
  beforeAll(() => {
    initAjvSchemas()
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })
  describe('Serialization Tests', () => {
    test('Serialize Data with Valid Input Correctly, root true', () => {
      const stream = new VectorBufferStream(0)
      const obj: GetAccountDataByHashesResp = {
        accounts: [{ accountId: 'acc123', stateId: 'state456', data: { detail: 'info' }, timestamp: 123456 }],
        stateTableData: [
          {
            accountId: 'acc123',
            txId: 'tx123',
            txTimestamp: '1625097600',
            stateBefore: 'hash123',
            stateAfter: 'hash456',
          },
        ],
      }
      serializeGetAccountDataByHashesResp(stream, obj, true)

      // Create the expected stream that simulates the correct serialization output
      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt16(TypeIdentifierEnum.cGetAccountDataByHashesResp)
      expectedStream.writeUInt8(cGetAccountDataByHashesRespVersion)
      expectedStream.writeUInt32(obj.accounts.length)
      obj.accounts.forEach((account) => {
        serializeWrappedData(expectedStream, account)
      })
      expectedStream.writeUInt32(obj.stateTableData.length)
      obj.stateTableData.forEach((data) => {
        expectedStream.writeString(data.accountId)
        expectedStream.writeString(data.txId)
        expectedStream.writeString(data.txTimestamp)
        expectedStream.writeString(data.stateBefore)
        expectedStream.writeString(data.stateAfter)
      })

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('Handle Empty Arrays Correctly', () => {
      const stream = new VectorBufferStream(0)
      const obj: GetAccountDataByHashesResp = { accounts: [], stateTableData: [] }
      serializeGetAccountDataByHashesResp(stream, obj, false)
      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetAccountDataByHashesRespVersion)
      expectedStream.writeUInt32(obj.accounts.length)
      expectedStream.writeUInt32(obj.stateTableData.length)
      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('Serialize with Root Flag Set to False', () => {
      const stream = new VectorBufferStream(0)
      const obj: GetAccountDataByHashesResp = {
        accounts: [{ accountId: 'acc123', stateId: 'state456', data: { detail: 'info' }, timestamp: 123456 }],
        stateTableData: [],
      }
      serializeGetAccountDataByHashesResp(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetAccountDataByHashesRespVersion)
      expectedStream.writeUInt32(obj.accounts.length)
      obj.accounts.forEach((account) => {
        serializeWrappedData(expectedStream, account)
      })
      expectedStream.writeUInt32(obj.stateTableData.length)
      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('Multiple Entries in Accounts and StateTableData', () => {
      const stream = new VectorBufferStream(0)
      const obj: GetAccountDataByHashesResp = {
        accounts: [
          { accountId: 'acc1', stateId: 'state1', data: { detail: 'info1' }, timestamp: 100000 },
          { accountId: 'acc2', stateId: 'state2', data: { detail: 'info2' }, timestamp: 100001 },
        ],
        stateTableData: [
          {
            accountId: 'acc1',
            txId: 'tx1',
            txTimestamp: '100000',
            stateBefore: 'before1',
            stateAfter: 'after1',
          },
          {
            accountId: 'acc2',
            txId: 'tx2',
            txTimestamp: '100001',
            stateBefore: 'before2',
            stateAfter: 'after2',
          },
        ],
      }
      serializeGetAccountDataByHashesResp(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetAccountDataByHashesRespVersion)
      expectedStream.writeUInt32(obj.accounts.length)
      obj.accounts.forEach((account) => {
        serializeWrappedData(expectedStream, account)
      })
      expectedStream.writeUInt32(obj.stateTableData.length)
      obj.stateTableData.forEach((data) => {
        expectedStream.writeString(data.accountId)
        expectedStream.writeString(data.txId)
        expectedStream.writeString(data.txTimestamp)
        expectedStream.writeString(data.stateBefore)
        expectedStream.writeString(data.stateAfter)
      })

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    // Deserialization tests
    test('Deserialize Data Correctly', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetAccountDataByHashesRespVersion) // Version

      // Prepare account data for serialization
      const account = {
        accountId: 'acc123',
        stateId: 'state456',
        data: { detail: 'info' },
        timestamp: 123456,
      }
      // Simulate how account data would be serialized based on your application's method
      stream.writeUInt32(1) // Length of accounts
      serializeWrappedData(stream, account)
      // Prepare stateTableData for serialization
      stream.writeUInt32(1) // Length of stateTableData
      stream.writeString('acc123')
      stream.writeString('tx123')
      stream.writeString('1625097600')
      stream.writeString('hash123')
      stream.writeString('hash456')

      stream.position = 0
      const result = deserializeGetAccountDataByHashesResp(stream)

      // Expected object
      const expected = {
        accounts: [
          {
            accountId: 'acc123',
            stateId: 'state456',
            data: { detail: 'info' },
            timestamp: 123456,
          },
        ],
        stateTableData: [
          {
            accountId: 'acc123',
            txId: 'tx123',
            txTimestamp: '1625097600',
            stateBefore: 'hash123',
            stateAfter: 'hash456',
          },
        ],
      }
      expect(result).toEqual(expected)
    })

    test('Throw Error on Version Mismatch', () => {
      const stream = new VectorBufferStream(0)
      const obj: GetAccountDataByHashesResp = {
        accounts: [
          {
            accountId: 'acc123',
            stateId: 'state456',
            data: { detail: 'info' },
            timestamp: 123456,
          },
        ],
        stateTableData: [
          {
            accountId: 'acc123',
            txId: 'tx123',
            txTimestamp: '1625097600',
            stateBefore: 'hash123',
            stateAfter: 'hash456',
          },
        ],
      }

      serializeGetAccountDataByHashesResp(stream, obj, false)
      // Manually increase the version number in the buffer to simulate a mismatch
      const buffer = stream.getBuffer()
      buffer[0] = cGetAccountDataByHashesRespVersion + 1
      const alteredStream = VectorBufferStream.fromBuffer(buffer)
      expect(() => deserializeGetAccountDataByHashesResp(alteredStream)).toThrow(
        `GetAccountDataByHashesRespDeserializer expected version ${cGetAccountDataByHashesRespVersion}, got ${
          cGetAccountDataByHashesRespVersion + 1
        }`
      )
    })
  })

  test('Deserialization Error Handling for Missing Fields', () => {
    const stream = new VectorBufferStream(0)
    stream.writeUInt8(cGetAccountDataByHashesRespVersion) // Correct version
    stream.writeUInt32(0) // No accounts
    stream.writeUInt32(0) // No stateTableData
    stream.position = 0
    const result = deserializeGetAccountDataByHashesResp(stream)
    const expected = { accounts: [], stateTableData: [] }
    expect(result).toEqual(expected)
  })

  // Round-trip tests
  test('Maintain Data Integrity Through Serialization and Deserialization', () => {
    const stream = new VectorBufferStream(0)
    const obj: GetAccountDataByHashesResp = {
      accounts: [{ accountId: 'acc123', stateId: 'state456', data: { detail: 'info' }, timestamp: 123456 }],
      stateTableData: [
        {
          accountId: 'acc123',
          txId: 'tx123',
          txTimestamp: '1625097600',
          stateBefore: 'hash123',
          stateAfter: 'hash456',
        },
      ],
    }
    serializeGetAccountDataByHashesResp(stream, obj, false)
    stream.position = 0
    const result = deserializeGetAccountDataByHashesResp(stream)
    expect(result).toEqual(obj)
  })

  // Null Values for Optional Fields
  test('Null Values for Optional Fields', () => {
    const stream = new VectorBufferStream(0)
    const obj: GetAccountDataByHashesResp = {
      accounts: [{ accountId: 'acc123', stateId: 'state456', data: null, timestamp: 123456 }],
      stateTableData: [],
    }
    serializeGetAccountDataByHashesResp(stream, obj, false)
    stream.position = 0
    const result = deserializeGetAccountDataByHashesResp(stream)
    expect(result.accounts[0].data).toBeNull()
  })
})
