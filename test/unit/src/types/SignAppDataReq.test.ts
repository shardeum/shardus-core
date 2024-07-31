import { VectorBufferStream } from '../../../../src/utils/serialization/VectorBufferStream'
import {
  cSignAppDataReqVersion,
  deserializeSignAppDataReq,
  serializeSignAppDataReq,
  SignAppDataReq,
} from '../../../../src/types/SignAppDataReq'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'
import { initSignAppDataReq } from '../../../../src/types/ajv/SignAppDataReq'
import { Utils } from '@shardus/types'
import { AppObjEnum } from '../../../../src/shardus/shardus-types'
import { stateManager } from '../../../../src/p2p/Context'

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

describe('SignAppDataReq Tests', () => {
  beforeAll(() => {
    initSignAppDataReq()
  })

  describe('Serialization Tests', () => {
    test('Serialize valid data with root true', () => {
      const obj: SignAppDataReq = {
        type: 'type1',
        nodesToSign: 2,
        hash: 'hash123',
        appData: 'appData123',
      }
      const stream = new VectorBufferStream(0)
      serializeSignAppDataReq(stream, obj, true)
      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt16(TypeIdentifierEnum.cSignAppDataReq)
      expectedStream.writeUInt8(cSignAppDataReqVersion)
      expectedStream.writeString('type1')
      expectedStream.writeUInt8(2)
      expectedStream.writeString('hash123')
      expectedStream.writeBuffer(stateManager.app.binarySerializeObject(AppObjEnum.AppData, 'appData123'))

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('Serialize empty array with root false', () => {
      const obj: SignAppDataReq = {
        type: 'type1',
        nodesToSign: 3,
        hash: 'hash123',
        appData: 'appData123',
      }
      const stream = new VectorBufferStream(0)
      serializeSignAppDataReq(stream, obj, false)
      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt8(cSignAppDataReqVersion)
      expectedStream.writeString('type1')
      expectedStream.writeUInt8(3)
      expectedStream.writeString('hash123')
      expectedStream.writeBuffer(stateManager.app.binarySerializeObject(AppObjEnum.AppData, 'appData123'))

      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })
  })

  describe('Deserialization Tests', () => {
    test('Deserialize valid data', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cSignAppDataReqVersion)
      stream.writeString('type1')
      stream.writeUInt8(2)
      stream.writeString('hash123')
      stream.writeBuffer(stateManager.app.binarySerializeObject(AppObjEnum.AppData, 'appData123'))
      stream.position = 0

      const result = deserializeSignAppDataReq(stream)
      expect(result).toEqual({
        type: 'type1',
        nodesToSign: 2,
        hash: 'hash123',
        appData: 'appData123',
      })
    })

    test('Version mismatch error', () => {
      const stream = new VectorBufferStream(0)
      stream.writeUInt8(cSignAppDataReqVersion + 1)
      stream.position = 0

      expect(() => deserializeSignAppDataReq(stream)).toThrow('SignAppDataReq version mismatch')
    })
  })

  describe('RequestStateForTxPostReq Serialization and Deserialization Together', () => {
    test('Correct round-trip for non-empty array', () => {
      const originalObj: SignAppDataReq = {
        type: 'type1',
        nodesToSign: 3,
        hash: 'hash123',
        appData: 'appData123',
      }
      const stream = new VectorBufferStream(0)
      serializeSignAppDataReq(stream, originalObj, false)
      stream.position = 0

      const deserializedObj = deserializeSignAppDataReq(stream)
      expect(deserializedObj).toEqual(originalObj)
    })
  })
})
