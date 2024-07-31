import { VectorBufferStream } from '../../../../src/utils/serialization/VectorBufferStream'
import {
  cSignAppDataRespVersion,
  deserializeSignAppDataResp,
  serializeSignAppDataResp,
  SignAppDataResp,
} from '../../../../src/types/SignAppDataResp'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'
import { initSignAppDataResp } from '../../../../src/types/ajv/SignAppDataResp'

describe('SignAppDataResp Tests', () => {
  beforeAll(() => {
    initSignAppDataResp()
  })

  describe('Serialization Tests', () => {
    test('Serialize valid data with root true', () => {
      const obj: SignAppDataResp = {
        success: true,
        signature: {
          owner: 'owner123',
          sig: 'sig123',
        },
      }
      const stream = new VectorBufferStream(0)
      serializeSignAppDataResp(stream, obj, true)
      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt16(TypeIdentifierEnum.cSignAppDataResp)
      expectedStream.writeUInt8(cSignAppDataRespVersion)
      expectedStream.writeUInt8(1)
      expectedStream.writeString('owner123')
      expectedStream.writeString('sig123')

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('Serialize empty array with root false', () => {
      const obj: SignAppDataResp = {
        success: true,
        signature: {
          owner: 'owner123',
          sig: 'sig123',
        },
      }
      const stream = new VectorBufferStream(0)
      serializeSignAppDataResp(stream, obj, false)
      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cSignAppDataRespVersion)
      expectedStream.writeUInt8(1)
      expectedStream.writeString('owner123')
      expectedStream.writeString('sig123')
      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })
  })

  describe('Deserialization Tests', () => {
    test('Deserialize valid data', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cSignAppDataRespVersion)
      stream.writeUInt8(1)
      stream.writeString('owner123')
      stream.writeString('sig123')
      stream.position = 0

      const result = deserializeSignAppDataResp(stream)
      expect(result).toEqual({
        success: true,
        signature: {
          owner: 'owner123',
          sig: 'sig123',
        },
      })
    })

    test('Version mismatch error', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cSignAppDataRespVersion + 1)
      stream.position = 0

      expect(() => deserializeSignAppDataResp(stream)).toThrow('SignAppDataResp version mismatch')
    })
  })

  describe('RequestStateForTxPostReq Serialization and Deserialization Together', () => {
    test('Correct round-trip for non-empty array', () => {
      const originalObj: SignAppDataResp = {
        success: true,
        signature: {
          owner: 'owner123',
          sig: 'sig123',
        },
      }
      const stream = new VectorBufferStream(0)
      serializeSignAppDataResp(stream, originalObj, false)
      stream.position = 0

      const deserializedObj = deserializeSignAppDataResp(stream)
      expect(deserializedObj).toEqual(originalObj)
    })
  })
})
