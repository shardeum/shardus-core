import { VectorBufferStream } from '../../../../src/utils/serialization/VectorBufferStream'
import {
  cRequestStateForTxPostReqVersion,
  deserializeRequestStateForTxPostReq,
  serializeRequestStateForTxPostReq,
  RequestStateForTxPostReq,
} from '../../../../src/types/RequestStateForTxPostReq'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'
import { initRequestStateForTxPostReq } from '../../../../src/types/ajv/RequestStateForTxPostReq'

describe('RequestStateForTxPostReq Tests', () => {
  beforeAll(() => {
    initRequestStateForTxPostReq()
  })

  describe('Serialization Tests', () => {
    test('Serialize valid data with root true', () => {
      const obj: RequestStateForTxPostReq = {
        txid: 'txid123',
        timestamp: 1234567890,
        key: 'key123',
        hash: 'hash123',
      }
      const stream = new VectorBufferStream(0)
      serializeRequestStateForTxPostReq(stream, obj, true)
      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt16(TypeIdentifierEnum.cRequestStateForTxPostReq)
      expectedStream.writeUInt8(cRequestStateForTxPostReqVersion)
      expectedStream.writeString('txid123')
      expectedStream.writeBigUInt64(BigInt(1234567890))
      expectedStream.writeString('key123')
      expectedStream.writeString('hash123')

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('Serialize empty array with root false', () => {
      const obj: RequestStateForTxPostReq = {
        txid: 'txid123',
        timestamp: 1234567890,
        key: 'key123',
        hash: 'hash123',
      }
      const stream = new VectorBufferStream(0)
      serializeRequestStateForTxPostReq(stream, obj, false)
      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cRequestStateForTxPostReqVersion)
      expectedStream.writeString('txid123')
      expectedStream.writeBigUInt64(BigInt(1234567890))
      expectedStream.writeString('key123')
      expectedStream.writeString('hash123')

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })
  })

  describe('Deserialization Tests', () => {
    test('Deserialize valid data', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cRequestStateForTxPostReqVersion)
      stream.writeString('txid123')
      stream.writeBigUInt64(BigInt(1234567890))
      stream.writeString('key123')
      stream.writeString('hash123')
      stream.position = 0

      const result = deserializeRequestStateForTxPostReq(stream)
      expect(result).toEqual({
        txid: 'txid123',
        timestamp: 1234567890,
        key: 'key123',
        hash: 'hash123',
      })
    })

    test('Version mismatch error', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cRequestStateForTxPostReqVersion + 1)
      stream.position = 0

      expect(() => deserializeRequestStateForTxPostReq(stream)).toThrow(
        'RequestStateForTxPostReq version mismatch'
      )
    })
  })

  describe('RequestStateForTxPostReq Serialization and Deserialization Together', () => {
    test('Correct round-trip for non-empty array', () => {
      const originalObj: RequestStateForTxPostReq = {
        txid: 'txid123',
        timestamp: 1234567890,
        key: 'key123',
        hash: 'hash123',
      }
      const stream = new VectorBufferStream(0)
      serializeRequestStateForTxPostReq(stream, originalObj, false)
      stream.position = 0

      const deserializedObj = deserializeRequestStateForTxPostReq(stream)
      expect(deserializedObj).toEqual(originalObj)
    })
  })
})
