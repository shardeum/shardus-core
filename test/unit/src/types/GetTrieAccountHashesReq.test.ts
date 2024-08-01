import { VectorBufferStream } from '../../../../src/utils/serialization/VectorBufferStream'
import {
  GetTrieAccountHashesReq,
  serializeGetTrieAccountHashesReq,
  deserializeGetTrieAccountHashesReq,
} from '../../../../src/types/GetTrieAccountHashesReq'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'
import { initAjvSchemas } from '../../../../src/types/ajv/Helpers'

describe('GetTrieAccountHashesReq Tests', () => {
  beforeAll(() => {
    initAjvSchemas()
  })

  describe('Serialization Tests', () => {
    test('Serialize with root true', () => {
      const obj: GetTrieAccountHashesReq = { radixList: ['abc123', 'def456'] }
      const stream = new VectorBufferStream(0)
      serializeGetTrieAccountHashesReq(stream, obj, true)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt16(TypeIdentifierEnum.cGetAccountTrieHashesReq)
      expectedStream.writeUInt8(1)
      expectedStream.writeUInt16(2)
      expectedStream.writeString('abc123,def456')

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('Serialize with root false', () => {
      const obj: GetTrieAccountHashesReq = { radixList: ['abc123', 'def456'] }
      const stream = new VectorBufferStream(0)
      serializeGetTrieAccountHashesReq(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(1)
      expectedStream.writeUInt16(2)
      expectedStream.writeString('abc123,def456')

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('Serialize with empty radixList', () => {
      const obj: GetTrieAccountHashesReq = { radixList: [] }
      const stream = new VectorBufferStream(0)
      serializeGetTrieAccountHashesReq(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(1)
      expectedStream.writeUInt16(0)
      expectedStream.writeString('')

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('Serialize with special characters', () => {
      const obj: GetTrieAccountHashesReq = { radixList: ['abc!23', 'def@56'] }
      const stream = new VectorBufferStream(0)
      serializeGetTrieAccountHashesReq(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(1)
      expectedStream.writeUInt16(2)
      expectedStream.writeString('abc!23,def@56')

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })
  })

  describe('Deserialization Tests', () => {
    test('Deserialize with valid data', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(1)
      stream.writeUInt16(2)
      stream.writeString('abc123,def456')
      stream.position = 0

      const result = deserializeGetTrieAccountHashesReq(stream)
      expect(result).toEqual({ radixList: ['abc123', 'def456'] })
    })

    test('Deserialize with empty radixList', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(1)
      stream.writeUInt16(0)
      stream.writeString('')
      stream.position = 0

      const result = deserializeGetTrieAccountHashesReq(stream)
      expect(result).toEqual({ radixList: [] })
    })

    test('Deserialize with special characters', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(1)
      stream.writeUInt16(2)
      stream.writeString('abc!23,def@56')
      stream.position = 0

      const result = deserializeGetTrieAccountHashesReq(stream)
      expect(result).toEqual({ radixList: ['abc!23', 'def@56'] })
    })

    test('Throw error on unsupported version', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(2)
      stream.writeUInt16(2)
      stream.writeString('abc123,def456')
      stream.position = 0

      expect(() => deserializeGetTrieAccountHashesReq(stream)).toThrow(
        'Unsupported version for GetAccountTrieHashesReq: 2'
      )
    })
  })
})
