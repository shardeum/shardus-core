import {
  cGetTxTimestampReqVersion,
  deserializeGetTxTimestampReq,
  getTxTimestampReq,
  serializeGetTxTimestampReq,
} from '../../../../src/types/GetTxTimestampReq'
import { initAjvSchemas } from '../../../../src/types/ajv/Helpers'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'
import { VectorBufferStream } from '../../../../src/utils/serialization/VectorBufferStream'

describe('GetTxTimestampReq Tests', () => {
  beforeAll(() => {
    initAjvSchemas()
  })

  describe('serializeGetTxTimestampReq', () => {
    let stream: VectorBufferStream

    beforeEach(() => {
      stream = new VectorBufferStream(0)
    })

    describe('Data validation Cases', () => {
      const incompleteObjects = [
        {
          description: "missing 'txId'",
          data: { cycleCounter: 100, cycleMarker: 'marker123' } as getTxTimestampReq,
        },
        {
          description: "missing 'cycleCounter'",
          data: { txId: 'testTxId', cycleMarker: 'marker123' } as getTxTimestampReq,
        },
        {
          description: "missing 'cycleMarker'",
          data: { txId: 'testTxId', cycleCounter: 100 } as getTxTimestampReq,
        },
      ]

      test.each(incompleteObjects)(
        'should throw error if field is missing during serialization',
        ({ data }) => {
          expect(() => serializeGetTxTimestampReq(stream, data)).toThrow('Data validation error')
        }
      )
    })

    it('should serialize correctly with root flag false', () => {
      const obj = {
        txId: 'testTxId',
        cycleCounter: 100,
        cycleMarker: 'marker123',
      } as getTxTimestampReq
      const stream = new VectorBufferStream(0)
      serializeGetTxTimestampReq(stream, obj, false)
      stream.position = 0 // Reset stream position to read from the beginning
      expect(stream.readUInt8()).toBe(cGetTxTimestampReqVersion)
      expect(stream.readString()).toBe(obj.txId)
      expect(stream.readUInt32()).toBe(obj.cycleCounter)
      expect(stream.readString()).toBe(obj.cycleMarker)
    })

    it('should serialize correctly with root flag true', () => {
      const obj = {
        txId: 'testTxId',
        cycleCounter: 100,
        cycleMarker: 'marker123',
      } as getTxTimestampReq
      const stream = new VectorBufferStream(0)
      serializeGetTxTimestampReq(stream, obj, true)
      stream.position = 0 // Reset stream position to read from the beginning
      expect(stream.readUInt16()).toBe(TypeIdentifierEnum.cGetTxTimestampReq)
      expect(stream.readUInt8()).toBe(cGetTxTimestampReqVersion)
      expect(stream.readString()).toBe(obj.txId)
      expect(stream.readUInt32()).toBe(obj.cycleCounter)
      expect(stream.readString()).toBe(obj.cycleMarker)
    })

    it('should handle empty strings correctly', () => {
      const obj = {
        txId: 'testTxId',
        cycleCounter: 100,
        cycleMarker: 'marker123',
      } as getTxTimestampReq
      const stream = new VectorBufferStream(0)
      obj.txId = ''
      obj.cycleMarker = ''
      serializeGetTxTimestampReq(stream, obj)
      stream.position = 0
      stream.readUInt8() // Skip version for simplicity
      expect(stream.readString()).toBe('')
      expect(stream.readUInt32()).toBe(obj.cycleCounter)
      expect(stream.readString()).toBe('')
    })

    it('should serialize maximum integer values correctly', () => {
      const obj = {
        txId: 'testTxId',
        cycleCounter: 100,
        cycleMarker: 'marker123',
      } as getTxTimestampReq
      const stream = new VectorBufferStream(0)
      obj.cycleCounter = 4294967295 // Maximum value for a 32-bit unsigned integer
      serializeGetTxTimestampReq(stream, obj)
      stream.position = 0
      stream.readUInt8() // Skip version for simplicity
      stream.readString() // Skip txId
      expect(stream.readUInt32()).toBe(4294967295)
    })
  })

  describe('deserializeGetTxTimestampReq', () => {
    let stream: VectorBufferStream

    beforeEach(() => {
      stream = new VectorBufferStream(0)
    })

    it('should throw error on unsupported version', () => {
      stream.writeUInt8(cGetTxTimestampReqVersion + 1) // Write an unsupported version
      stream.writeString('testTxId')
      stream.writeUInt32(100)
      stream.writeString('marker123')
      stream.position = 0 // Reset stream position to read from the beginning
      expect(() => deserializeGetTxTimestampReq(stream)).toThrow('Unsupported version')
    })

    it('should handle empty strings correctly during deserialization', () => {
      stream.writeUInt8(cGetTxTimestampReqVersion)
      stream.writeString('')
      stream.writeUInt32(100)
      stream.writeString('')
      stream.position = 0
      const result = deserializeGetTxTimestampReq(stream)
      expect(result.txId).toBe('')
      expect(result.cycleCounter).toBe(100)
      expect(result.cycleMarker).toBe('')
    })

    it('should deserialize maximum integer values correctly', () => {
      stream.writeUInt8(cGetTxTimestampReqVersion)
      stream.writeString('testTxId')
      stream.writeUInt32(4294967295) // Maximum value for a 32-bit unsigned integer
      stream.writeString('marker123')
      stream.position = 0
      const result = deserializeGetTxTimestampReq(stream)
      expect(result.cycleCounter).toBe(4294967295)
    })
  })

  describe('GetTxTimestampReq Serialization and Deserialization Together', () => {
    it('should serialize and deserialize maintaining data integrity', () => {
      const obj: getTxTimestampReq = {
        txId: 'uniqueTxId',
        cycleCounter: 4294967295,
        cycleMarker: 'endMarker',
      }
      const stream = new VectorBufferStream(0)
      serializeGetTxTimestampReq(stream, obj, false)
      stream.position = 0 // Reset for reading

      const deserializedObj = deserializeGetTxTimestampReq(stream)
      expect(deserializedObj).toEqual(obj)
    })
  })
})
