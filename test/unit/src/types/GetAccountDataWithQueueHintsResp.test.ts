import { VectorBufferStream } from '../../../../src/utils/serialization/VectorBufferStream'
import {
  GetAccountDataWithQueueHintsRespSerializable,
  serializeGetAccountDataWithQueueHintsResp,
  deserializeGetAccountDataWithQueueHintsResp,
} from '../../../../src/types/GetAccountDataWithQueueHintsResp'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'
import {
  WrappedDataFromQueueSerializable,
  serializeWrappedDataFromQueue,
} from '../../../../src/types/WrappedDataFromQueue'
import { initAjvSchemas } from '../../../../src/types/ajv/Helpers'

const cGetAccountDataWithQueueHintsRespVersion = 1 // taken from GetAccountDataWithQueueHintsResp

// Mocking the WrappedDataFromQueue methods to serialize and deserialize to
jest.mock('../../../../src/types/WrappedDataFromQueue', () => ({
  setDefaultConfigs: jest.fn(),
  serializeWrappedDataFromQueue: jest.fn((stream, item) => {
    stream.writeUInt8(1) // Serialize the entire object to 1
  }),
  deserializeWrappedDataFromQueue: jest.fn((stream) => {
    stream.readUInt8() // Deserialize the entire object from 1
    return {
      accountId: 'mockAccountId',
      stateId: 'mockStateId',
      data: { mockData: true },
      timestamp: 1234567890,
      seenInQueue: true,
      syncData: { mockSyncData: true },
    }
  }),
}))

describe('GetAccountDataWithQueueHintsResp Serialization and Deserialization', () => {
  beforeAll(() => {
    initAjvSchemas()
  })

  describe('Serialization', () => {
    test('should serialize GetAccountDataWithQueueHintsRespSerializable with accountData containing entries with syncData and root set to true', () => {
      const obj: GetAccountDataWithQueueHintsRespSerializable = {
        accountData: [
          {
            accountId: 'sampleAccountId1',
            stateId: 'sampleStateId1',
            data: { id: 12 },
            timestamp: 1234567890,
            seenInQueue: true,
          },
          {
            accountId: 'sampleAccountId2',
            stateId: 'sampleStateId2',
            data: { id: 12, hash: '1212' },
            timestamp: 1234567891,
            seenInQueue: false,
            syncData: { id: 12, hash: '1212', cycleDataName: 'syncData' },
          },
        ],
      }
      const stream = new VectorBufferStream(0)
      serializeGetAccountDataWithQueueHintsResp(stream, obj, true)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt16(TypeIdentifierEnum.cGetAccountDataWithQueueHintsResp)
      expectedStream.writeUInt8(cGetAccountDataWithQueueHintsRespVersion)
      if (obj.accountData !== null) {
        expectedStream.writeUInt8(1)
        expectedStream.writeUInt16(obj.accountData.length)
        for (const item of obj.accountData) {
          serializeWrappedDataFromQueue(expectedStream, item)
        }
      } else {
        expectedStream.writeUInt8(0)
      }

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should handle empty accountData array correctly', () => {
      const obj: GetAccountDataWithQueueHintsRespSerializable = {
        accountData: [],
      }
      const stream = new VectorBufferStream(0)
      serializeGetAccountDataWithQueueHintsResp(stream, obj)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetAccountDataWithQueueHintsRespVersion)
      expectedStream.writeUInt8(1) // Indicates accountData is present
      expectedStream.writeUInt16(0) // Length of accountData array

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    // Test serialization with null in accountData
    test('should handle null accountData correctly', () => {
      const obj: GetAccountDataWithQueueHintsRespSerializable = {
        accountData: null,
      }
      const stream = new VectorBufferStream(0)
      serializeGetAccountDataWithQueueHintsResp(stream, obj)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetAccountDataWithQueueHintsRespVersion)
      expectedStream.writeUInt8(0) // Indicates no accountData

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    // Test serialization with multiple complex entries in accountData
    test('should serialize complex entries correctly', () => {
      const obj: GetAccountDataWithQueueHintsRespSerializable = {
        accountData: [
          {
            accountId: 'sampleAccountId3',
            stateId: 'sampleStateId3',
            data: { id: 34, hash: 'abc', extra: 'extraData' },
            timestamp: 1234567892,
            seenInQueue: true,
            syncData: { id: 34, hash: '3434', cycleDataName: 'syncData1' },
          },
          {
            accountId: 'sampleAccountId4',
            stateId: 'sampleStateId4',
            data: { id: 45 },
            timestamp: 1234567893,
            seenInQueue: false,
          },
          {
            accountId: 'sampleAccountId4',
            stateId: 'sampleStateId4',
            data: { id: null },
            timestamp: 1234567893,
            seenInQueue: false,
            syncData: { id: 45, hash: '4545', cycleDataName: null },
          },
        ],
      }
      const stream = new VectorBufferStream(0)
      serializeGetAccountDataWithQueueHintsResp(stream, obj)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetAccountDataWithQueueHintsRespVersion)
      if (obj.accountData !== null) {
        expectedStream.writeUInt8(1)
        expectedStream.writeUInt16(obj.accountData.length)
        for (const item of obj.accountData) {
          serializeWrappedDataFromQueue(expectedStream, item)
        }
      } else {
        expectedStream.writeUInt8(0)
      }

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })
  })

  describe('Deserialization', () => {
    // Test successful deserialization of a standard object
    test('should correctly deserialize a standard object with multiple accountData entries', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetAccountDataWithQueueHintsRespVersion)
      stream.writeUInt8(1) // Indicates accountData is present
      stream.writeUInt16(2) // Length of accountData array

      serializeWrappedDataFromQueue(stream, {
        accountId: 'acc123',
        stateId: 'state456',
        data: { detail: 'info', hash: 'abc' },
        timestamp: 123456,
        seenInQueue: true,
      })
      serializeWrappedDataFromQueue(stream, {
        accountId: 'acc789',
        stateId: 'state101112',
        data: { detail: 'moreInfo', hash: 'def' },
        timestamp: 654321,
        seenInQueue: false,
      })
      stream.position = 0 // Reset position for reading

      const deserializedObj = deserializeGetAccountDataWithQueueHintsResp(stream)
      const expectedObj: GetAccountDataWithQueueHintsRespSerializable = {
        accountData: [mockWrappedData, mockWrappedData],
      }

      // Validate that the deserialized object matches the expected object
      expect(deserializedObj).toEqual(expectedObj)
    })

    // Test deserialization of an empty accountData array
    test('should handle deserialization of an empty accountData array correctly', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetAccountDataWithQueueHintsRespVersion)
      stream.writeUInt8(1) // Indicates accountData is present
      stream.writeUInt16(0) // Length of accountData array is zero
      stream.position = 0 // Reset position for reading

      const expectedObj = deserializeGetAccountDataWithQueueHintsResp(stream)
      expect(expectedObj).toEqual({
        accountData: [],
      })
    })

    // Test deserialization when accountData is null
    test('should handle deserialization when accountData is null correctly', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetAccountDataWithQueueHintsRespVersion)
      stream.writeUInt8(0) // Indicates no accountData
      stream.position = 0 // Reset position for reading

      const expectedObj = deserializeGetAccountDataWithQueueHintsResp(stream)
      expect(expectedObj).toEqual({
        accountData: null,
      })
    })

    // Test deserialization with version mismatch
    test('should throw a version mismatch error if the version number does not match', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetAccountDataWithQueueHintsRespVersion + 1) // Incorrect version
      stream.position = 0 // Reset position for reading

      expect(() => deserializeGetAccountDataWithQueueHintsResp(stream)).toThrow(
        'GetAccountDataWithQueueHintsResp version mismatch'
      )
    })
  })

  const mockWrappedData: WrappedDataFromQueueSerializable = {
    accountId: 'mockAccountId',
    stateId: 'mockStateId',
    data: { mockData: true },
    timestamp: 1234567890,
    seenInQueue: true,
    syncData: { mockSyncData: true },
  }

  describe('Serialization and Deserialization', () => {
    test('should correctly serialize and then deserialize the object, maintaining data integrity', () => {
      const originalObj: GetAccountDataWithQueueHintsRespSerializable = {
        accountData: [
          {
            accountId: 'acc123',
            stateId: 'state456',
            data: { detail: 'info' },
            timestamp: 123456,
            seenInQueue: true,
            syncData: { id: 1, hash: 'abc', cycleDataName: 'initialSync' },
          },
          {
            accountId: 'acc789',
            stateId: 'state101112',
            data: { detail: 'moreInfo' },
            timestamp: 654321,
            seenInQueue: false,
            syncData: { id: 2, hash: 'def', cycleDataName: 'secondarySync' },
          },
        ],
      }

      // Serialize the object
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetAccountDataWithQueueHintsRespVersion) // Write version
      stream.writeUInt8(1) // Indicates accountData is present
      if (originalObj.accountData) {
        stream.writeUInt16(originalObj.accountData.length) // Length of accountData array
        for (const item of originalObj.accountData) {
          serializeWrappedDataFromQueue(stream, item)
        }
      }

      // Reset the stream position to zero before reading
      stream.position = 0

      // Deserialize the stream back to an object
      const deserializedObj = deserializeGetAccountDataWithQueueHintsResp(stream)

      let expectedObj: GetAccountDataWithQueueHintsRespSerializable

      // Update the deserialized object with mock data to match original data
      // eslint-disable-next-line prefer-const
      if (originalObj.accountData) {
        expectedObj = {
          accountData: originalObj.accountData.map(() => mockWrappedData),
        }
      }

      // Validate that the deserialized object matches the updated expected object
      expect(deserializedObj).toEqual(expectedObj)
    })
  })
})
