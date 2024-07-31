import { VectorBufferStream } from '../../../../src/utils/serialization/VectorBufferStream'
import {
  GetTrieAccountHashesResp,
  cGetTrieAccountHashesRespVersion,
  deserializeGetTrieAccountHashesResp,
  serializeGetTrieAccountHashesResp,
} from '../../../../src/types/GetTrieAccountHashesResp'
import { serializeRadixAndChildHashes } from '../../../../src/types/GetTrieAccountHashesResp'
import { initAjvSchemas } from '../../../../src/types/ajv/Helpers'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'

describe('GetTrieAccountHashesResp Tests', () => {
  beforeAll(() => {
    initAjvSchemas()
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Serialization Tests', () => {
    test('Serialize Data with Valid Input Correctly, root true', () => {
      const stream = new VectorBufferStream(0)
      const obj: GetTrieAccountHashesResp = {
        nodeChildHashes: [
          {
            radix: 'radix1',
            childAccounts: [
              { accountID: 'acc1', hash: 'hash1' },
              { accountID: 'acc2', hash: 'hash2' },
            ],
          },
        ],
        stats: {
          matched: 10,
          visisted: 20,
          empty: 5,
          childCount: 2,
        },
      }
      serializeGetTrieAccountHashesResp(stream, obj, true)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt16(TypeIdentifierEnum.cGetAccountTrieHashesResp)
      expectedStream.writeUInt8(cGetTrieAccountHashesRespVersion)
      expectedStream.writeUInt16(obj.nodeChildHashes.length)
      obj.nodeChildHashes.forEach((node) => {
        serializeRadixAndChildHashes(expectedStream, node)
      })
      expectedStream.writeUInt32(obj.stats.matched)
      expectedStream.writeUInt32(obj.stats.visisted)
      expectedStream.writeUInt32(obj.stats.empty)
      expectedStream.writeUInt32(obj.stats.childCount)

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('Handle Empty Arrays Correctly', () => {
      const stream = new VectorBufferStream(0)
      const obj: GetTrieAccountHashesResp = {
        nodeChildHashes: [],
        stats: { matched: 0, visisted: 0, empty: 0, childCount: 0 },
      }
      serializeGetTrieAccountHashesResp(stream, obj, false)
      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetTrieAccountHashesRespVersion)
      expectedStream.writeUInt16(obj.nodeChildHashes.length)
      expectedStream.writeUInt32(obj.stats.matched)
      expectedStream.writeUInt32(obj.stats.visisted)
      expectedStream.writeUInt32(obj.stats.empty)
      expectedStream.writeUInt32(obj.stats.childCount)
      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('Serialize with Root Flag Set to False', () => {
      const stream = new VectorBufferStream(0)
      const obj: GetTrieAccountHashesResp = {
        nodeChildHashes: [
          {
            radix: 'radix1',
            childAccounts: [
              { accountID: 'acc1', hash: 'hash1' },
              { accountID: 'acc2', hash: 'hash2' },
            ],
          },
        ],
        stats: {
          matched: 10,
          visisted: 20,
          empty: 5,
          childCount: 2,
        },
      }
      serializeGetTrieAccountHashesResp(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetTrieAccountHashesRespVersion)
      expectedStream.writeUInt16(obj.nodeChildHashes.length)
      obj.nodeChildHashes.forEach((node) => {
        serializeRadixAndChildHashes(expectedStream, node)
      })
      expectedStream.writeUInt32(obj.stats.matched)
      expectedStream.writeUInt32(obj.stats.visisted)
      expectedStream.writeUInt32(obj.stats.empty)
      expectedStream.writeUInt32(obj.stats.childCount)

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('Serialize with Large Data Set', () => {
      const stream = new VectorBufferStream(0)
      const largeDataSet = new Array(1000).fill({
        radix: 'radix1',
        childAccounts: [
          { accountID: 'acc1', hash: 'hash1' },
          { accountID: 'acc2', hash: 'hash2' },
        ],
      })
      const obj: GetTrieAccountHashesResp = {
        nodeChildHashes: largeDataSet,
        stats: {
          matched: 1000,
          visisted: 2000,
          empty: 500,
          childCount: 2000,
        },
      }
      serializeGetTrieAccountHashesResp(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cGetTrieAccountHashesRespVersion)
      expectedStream.writeUInt16(obj.nodeChildHashes.length)
      obj.nodeChildHashes.forEach((node) => {
        serializeRadixAndChildHashes(expectedStream, node)
      })
      expectedStream.writeUInt32(obj.stats.matched)
      expectedStream.writeUInt32(obj.stats.visisted)
      expectedStream.writeUInt32(obj.stats.empty)
      expectedStream.writeUInt32(obj.stats.childCount)

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })
  })

  describe('Deserialization Tests', () => {
    test('Deserialize Data Correctly', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(1)
      stream.writeUInt16(1)
      stream.writeUInt8(1)
      stream.writeString('radix1')
      stream.writeUInt16(2)
      stream.writeString('acc1')
      stream.writeString('hash1')
      stream.writeString('acc2')
      stream.writeString('hash2')
      stream.writeUInt32(10)
      stream.writeUInt32(20)
      stream.writeUInt32(5)
      stream.writeUInt32(2)
      stream.position = 0

      const result = deserializeGetTrieAccountHashesResp(stream)

      const expected = {
        nodeChildHashes: [
          {
            radix: 'radix1',
            childAccounts: [
              { accountID: 'acc1', hash: 'hash1' },
              { accountID: 'acc2', hash: 'hash2' },
            ],
          },
        ],
        stats: {
          matched: 10,
          visisted: 20,
          empty: 5,
          childCount: 2,
        },
      }
      expect(result).toEqual(expected)
    })

    test('Deserialize with Empty Arrays', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetTrieAccountHashesRespVersion)
      stream.writeUInt16(0)
      stream.writeUInt32(0)
      stream.writeUInt32(0)
      stream.writeUInt32(0)
      stream.writeUInt32(0)
      stream.position = 0

      const result = deserializeGetTrieAccountHashesResp(stream)

      const expected = { nodeChildHashes: [], stats: { matched: 0, visisted: 0, empty: 0, childCount: 0 } }
      expect(result).toEqual(expected)
    })

    test('Deserialize with Large Data Set', () => {
      const stream = new VectorBufferStream(0)
      const largeDataSet = new Array(1000).fill({
        accountID: 'acc1',
        hash: 'hash1',
      })
      stream.writeUInt8(cGetTrieAccountHashesRespVersion)
      stream.writeUInt16(1000)
      largeDataSet.forEach((data) => {
        stream.writeUInt8(1)
        stream.writeString('radix1')
        stream.writeUInt16(2)
        stream.writeString(data.accountID)
        stream.writeString(data.hash)
        stream.writeString(data.accountID)
        stream.writeString(data.hash)
      })
      stream.writeUInt32(1000)
      stream.writeUInt32(2000)
      stream.writeUInt32(500)
      stream.writeUInt32(2000)
      stream.position = 0

      const result = deserializeGetTrieAccountHashesResp(stream)

      const expected = {
        nodeChildHashes: new Array(1000).fill({
          radix: 'radix1',
          childAccounts: [
            { accountID: 'acc1', hash: 'hash1' },
            { accountID: 'acc1', hash: 'hash1' },
          ],
        }),
        stats: {
          matched: 1000,
          visisted: 2000,
          empty: 500,
          childCount: 2000,
        },
      }
      expect(result).toEqual(expected)
    })

    test('Throw Error on Unsupported Version', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cGetTrieAccountHashesRespVersion + 1)
      stream.position = 0

      expect(() => deserializeGetTrieAccountHashesResp(stream)).toThrow(
        `Unsupported version for GetAccountTrieHashesResp: ${cGetTrieAccountHashesRespVersion + 1}`
      )
    })
  })

  describe('Round-trip Tests', () => {
    test('Maintain Data Integrity Through Serialization and Deserialization', () => {
      const stream = new VectorBufferStream(0)
      const obj: GetTrieAccountHashesResp = {
        nodeChildHashes: [
          {
            radix: 'radix1',
            childAccounts: [
              { accountID: 'acc1', hash: 'hash1' },
              { accountID: 'acc2', hash: 'hash2' },
            ],
          },
        ],
        stats: {
          matched: 10,
          visisted: 20,
          empty: 5,
          childCount: 2,
        },
      }
      serializeGetTrieAccountHashesResp(stream, obj, false)
      stream.position = 0
      const result = deserializeGetTrieAccountHashesResp(stream)
      expect(result).toEqual(obj)
    })
  })
})
