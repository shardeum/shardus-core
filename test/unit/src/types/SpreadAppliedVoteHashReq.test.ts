import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'
import { VectorBufferStream } from '../../../../src/utils/serialization/VectorBufferStream'
import {
  serializeSpreadAppliedVoteHashReq,
  deserializeSpreadAppliedVoteHashReq,
  SpreadAppliedVoteHashReq,
} from '../../../../src/types/SpreadAppliedVoteHashReq'
import { initAjvSchemas } from '../../../../src/types/ajv/Helpers'

const cSpreadAppliedVoteHashReqVersion = 1

describe('SpreadAppliedVoteHashReq Tests', () => {
  beforeAll(() => {
    initAjvSchemas()
  })
  describe('serializeSpreadAppliedVoteHashReq', () => {
    let stream: VectorBufferStream

    beforeEach(() => {
      stream = new VectorBufferStream(0)
    })

    it('should serialize correctly with root flag false and without sign', () => {
      const obj: SpreadAppliedVoteHashReq = {
        txid: 'testTxId',
        voteHash: 'testVoteHash',
        voteTime: 7,
      }
      serializeSpreadAppliedVoteHashReq(stream, obj, false)
      stream.position = 0
      expect(stream.readUInt8()).toBe(cSpreadAppliedVoteHashReqVersion)
      expect(stream.readString()).toBe(obj.txid)
      expect(stream.readString()).toBe(obj.voteHash)
      expect(stream.readUInt16()).toBe(7)
      expect(stream.readUInt8()).toBe(0)
    })

    it('should serialize correctly with root flag true and with sign', () => {
      const obj: SpreadAppliedVoteHashReq = {
        txid: 'testTxId',
        voteHash: 'testVoteHash',
        voteTime: 7,
        sign: {
          owner: 'testOwner',
          sig: 'testSig',
        },
      }
      serializeSpreadAppliedVoteHashReq(stream, obj, true)
      stream.position = 0
      expect(stream.readUInt16()).toBe(TypeIdentifierEnum.cSpreadAppliedVoteHash)
      expect(stream.readUInt8()).toBe(cSpreadAppliedVoteHashReqVersion)
      expect(stream.readString()).toBe(obj.txid)
      expect(stream.readString()).toBe(obj.voteHash)
      expect(stream.readUInt16()).toBe(7)
      expect(stream.readUInt8()).toBe(1)
      expect(stream.readString()).toBe('testOwner')
      expect(stream.readString()).toBe('testSig')
    })

    it('should handle empty strings correctly', () => {
      const obj: SpreadAppliedVoteHashReq = {
        txid: '',
        voteHash: '',
        voteTime: 5,
      }
      serializeSpreadAppliedVoteHashReq(stream, obj)
      stream.position = 0
      stream.readUInt8() // Skip version for simplicity
      expect(stream.readString()).toBe('')
      expect(stream.readString()).toBe('')
      expect(stream.readUInt16()).toBe(5)
      expect(stream.readUInt8()).toBe(0)
    })
  })

  describe('deserializeSpreadAppliedVoteHashReq', () => {
    let stream: VectorBufferStream

    beforeEach(() => {
      stream = new VectorBufferStream(0)
    })

    it('should throw error on unsupported version', () => {
      stream.writeUInt8(cSpreadAppliedVoteHashReqVersion + 1) // Write an unsupported version
      stream.writeString('testTxId')
      stream.writeString('testVoteHash')
      stream.writeUInt16(5)
      stream.writeUInt8(0)
      stream.position = 0
      expect(() => deserializeSpreadAppliedVoteHashReq(stream)).toThrow('Unsupported version')
    })

    it('should deserialize correctly without sign', () => {
      stream.writeUInt8(cSpreadAppliedVoteHashReqVersion)
      stream.writeString('testTxId')
      stream.writeString('testVoteHash')
      stream.writeUInt16(5)
      stream.writeUInt8(0)
      stream.position = 0
      const result = deserializeSpreadAppliedVoteHashReq(stream)
      expect(result.txid).toBe('testTxId')
      expect(result.voteHash).toBe('testVoteHash')
      expect(result.voteTime).toBe(5)
      expect(result.sign).toBeUndefined()
    })

    it('should deserialize correctly with sign', () => {
      stream.writeUInt8(cSpreadAppliedVoteHashReqVersion)
      stream.writeString('testTxId')
      stream.writeString('testVoteHash')
      stream.writeUInt16(5)
      stream.writeUInt8(1)
      stream.writeString('testOwner')
      stream.writeString('testSig')
      stream.position = 0
      const result = deserializeSpreadAppliedVoteHashReq(stream)
      expect(result.txid).toBe('testTxId')
      expect(result.voteHash).toBe('testVoteHash')
      expect(result.voteTime).toBe(5)
      expect(result.sign).toEqual({
        owner: 'testOwner',
        sig: 'testSig',
      })
    })

    it('should handle empty strings correctly during deserialization', () => {
      stream.writeUInt8(cSpreadAppliedVoteHashReqVersion)
      stream.writeString('')
      stream.writeString('')
      stream.writeUInt16(5)
      stream.writeUInt8(0)
      stream.position = 0
      const result = deserializeSpreadAppliedVoteHashReq(stream)
      expect(result.txid).toBe('')
      expect(result.voteHash).toBe('')
      expect(result.voteTime).toBe(5)
      expect(result.sign).toBeUndefined()
    })
  })

  describe('SpreadAppliedVoteHashReq Serialization and Deserialization Together', () => {
    it('should serialize and deserialize maintaining data integrity', () => {
      const obj: SpreadAppliedVoteHashReq = {
        txid: 'uniqueTxId',
        voteHash: 'uniqueVoteHash',
        voteTime: 9,
        sign: {
          owner: 'testOwner',
          sig: 'testSig',
        },
      }
      const stream = new VectorBufferStream(0)
      serializeSpreadAppliedVoteHashReq(stream, obj, false)
      stream.position = 0

      const deserializedObj = deserializeSpreadAppliedVoteHashReq(stream)
      expect(deserializedObj).toEqual(obj)
    })
  })
})
