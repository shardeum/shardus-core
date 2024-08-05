import { VectorBufferStream } from '../../../../src/utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'
import { initAjvSchemas } from '../../../../src/types/ajv/Helpers'
import { stateManager } from '../../../../src/p2p/Context'

import {
  CachedAppDataSerializable,
  serializeCachedAppData,
  deserializeCachedAppData,
} from '../../../../src/types/CachedAppData'
import { AppObjEnum } from '../../../../src/types/enum/AppObjEnum'
import { Utils } from '@shardus/types'

// Mock the Context module and its nested structure
jest.mock('../../../../src/p2p/Context', () => ({
  setDefaultConfigs: jest.fn(),
  stateManager: {
    app: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      binarySerializeObject: jest.fn((enumType: AppObjEnum, data: any) => Buffer.from(Utils.safeStringify(data), 'utf8')),
      binaryDeserializeObject: jest.fn((enumType: AppObjEnum, buffer: Buffer) => Utils.safeJsonParse(buffer.toString('utf8'))),
    },
  },
}))

describe('CachedAppData Serialization and Deserialization', () => {
  beforeAll(() => {
    initAjvSchemas()
  })

  describe('serializeCachedAppData Serialization', () => {
    test('should serialize with root true', () => {
      const obj: CachedAppDataSerializable = {
        cycle: 1,
        appData: { data: 'test' },
        dataID: 'test',
      }

      const stream = new VectorBufferStream(0)
      serializeCachedAppData(stream, obj, true)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt16(TypeIdentifierEnum.cCachedAppData)
      expectedStream.writeUInt32(obj.cycle)
      expectedStream.writeBuffer(
        stateManager.app.binarySerializeObject(AppObjEnum.CachedAppData, obj.appData)
      )
      expectedStream.writeString(obj.dataID)
      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should serialize with root false', () => {
      const obj: CachedAppDataSerializable = {
        cycle: 1,
        appData: { data: 'test' },
        dataID: 'test',
      }

      const stream = new VectorBufferStream(0)
      serializeCachedAppData(stream, obj, false)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt32(obj.cycle)
      expectedStream.writeBuffer(
        stateManager.app.binarySerializeObject(AppObjEnum.CachedAppData, obj.appData)
      )
      expectedStream.writeString(obj.dataID)
      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })

    test('should serialize with chatracters for dataID', () => {
      const obj: CachedAppDataSerializable = {
        cycle: 1,
        appData: { data: 'test' },
        dataID: 'test#',
      }

      const stream = new VectorBufferStream(0)
      serializeCachedAppData(stream, obj, true)

      const expectedStream = new VectorBufferStream(0)
      expectedStream.writeUInt16(TypeIdentifierEnum.cCachedAppData)
      expectedStream.writeUInt32(obj.cycle)
      expectedStream.writeBuffer(
        stateManager.app.binarySerializeObject(AppObjEnum.CachedAppData, obj.appData)
      )
      expectedStream.writeString(obj.dataID)
      expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
    })
  })

  describe('serializeCachedAppData Deserialization', () => {
    test('should deserialize data successfully', () => {
      const expectedObj = {
        cycle: 1,
        appData: { data: 'test' },
        dataID: 'test',
      }
      const stream = new VectorBufferStream(0)
      stream.writeUInt32(expectedObj.cycle)
      stream.writeBuffer(
        stateManager.app.binarySerializeObject(AppObjEnum.CachedAppData, expectedObj.appData)
      )
      stream.writeString(expectedObj.dataID)
      stream.position = 0
      const obj = deserializeCachedAppData(stream)

      expect(obj).toEqual(expectedObj)
    })

    test('should serialize and deserialize successfully', () => {
      const expectedObj = {
        cycle: 1,
        appData: { data: 'test' },
        dataID: 'test#',
      }
      const stream = new VectorBufferStream(0)
      serializeCachedAppData(stream, expectedObj)

      stream.position = 0
      const obj = deserializeCachedAppData(stream)
      expect(obj).toEqual(expectedObj)
    })

    test('should throw error for invalid data', () => {
      const expectedObj = {
        cycle: 1,
        appData: 'invalid string',
        dataID: 'test#',
      }
      const stream = new VectorBufferStream(0)
      serializeCachedAppData(stream, expectedObj)

      stream.position = 0
      expect(() => deserializeCachedAppData(stream)).toThrowError('AJV: CachedAppData validation failed')
    })
  })
})
