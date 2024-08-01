import { VectorBufferStream } from '../../../../src'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'
import { initAjvSchemas } from '../../../../src/types/ajv/Helpers'
import { stateManager } from '../../../../src/p2p/Context'
import { AppObjEnum } from '../../../../src/types/enum/AppObjEnum'
import { Utils } from '@shardus/types'

import {
  SendCachedAppDataReq,
  serializeSendCachedAppDataReq,
  deserializeSendCachedAppDataReq,
} from '../../../../src/types/SendCachedAppDataReq'
import { deserialize } from 'v8'

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

const cSendCachedAppDataReqVersion = 1

describe('SendCachedAppDataReq Serialization and Deserialization', () => {
    beforeAll(() => {
        initAjvSchemas()
    })

    describe('serializeSendCachedAppDataReq Serialization', () => {
        test('should serialize with root true', () => {
            const obj: SendCachedAppDataReq = {
                topic: 'test',
                cachedAppData: {
                    cycle: 1,
                    appData: { data: 'test' },
                    dataID: 'test',
                }
            }

            const stream = new VectorBufferStream(0)
            serializeSendCachedAppDataReq(stream, obj, true)

            const expectedStream = new VectorBufferStream(0)
            expectedStream.writeUInt16(TypeIdentifierEnum.cSendCachedAppDataReq)
            expectedStream.writeUInt8(cSendCachedAppDataReqVersion)
            expectedStream.writeString(obj.topic)
            expectedStream.writeUInt32(obj.cachedAppData.cycle)
            expectedStream.writeBuffer(
                stateManager.app.binarySerializeObject(AppObjEnum.CachedAppData, obj.cachedAppData.appData)
            )
            expectedStream.writeString(obj.cachedAppData.dataID)
            expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
        })

        test('should serialize with root false', () => {
            const obj: SendCachedAppDataReq = {
                topic: 'test',
                cachedAppData: {
                    cycle: 1,
                    appData: { data: 'test' },
                    dataID: 'test',
                }
            }

            const stream = new VectorBufferStream(0)
            serializeSendCachedAppDataReq(stream, obj, false)

            const expectedStream = new VectorBufferStream(0)
            expectedStream.writeUInt8(cSendCachedAppDataReqVersion)
            expectedStream.writeString(obj.topic)
            expectedStream.writeUInt32(obj.cachedAppData.cycle)
            expectedStream.writeBuffer(
                stateManager.app.binarySerializeObject(AppObjEnum.CachedAppData, obj.cachedAppData.appData)
            )
            expectedStream.writeString(obj.cachedAppData.dataID)
            expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
        })
    })

    describe('deserializeSendCachedAppDataReq Deserialization', () => {
        test('should deserialize', () => {
            const obj: SendCachedAppDataReq = {
                topic: 'test',
                cachedAppData: {
                    cycle: 1,
                    appData: { data: 'test' },
                    dataID: 'test',
                }
            }

            const stream = new VectorBufferStream(0)
            stream.writeUInt8(cSendCachedAppDataReqVersion)
            stream.writeString(obj.topic)
            stream.writeUInt32(obj.cachedAppData.cycle)
            stream.writeBuffer(
                stateManager.app.binarySerializeObject(AppObjEnum.CachedAppData, obj.cachedAppData.appData)
            )
            stream.writeString(obj.cachedAppData.dataID)
            stream.position = 0 // Reset position for reading
            const data = deserializeSendCachedAppDataReq(stream)
            expect(data).toEqual(obj)
        })

        test('should throw error on version mismatch', () => {
            const obj: SendCachedAppDataReq = {
                topic: 'test',
                cachedAppData: {
                    cycle: 1,
                    appData: { data: 'test' },
                    dataID: 'test',
                }
            }

            const stream = new VectorBufferStream(0)
            stream.writeUInt8(cSendCachedAppDataReqVersion + 1)
            stream.writeString(obj.topic)
            stream.writeUInt32(obj.cachedAppData.cycle)
            stream.writeBuffer(
                stateManager.app.binarySerializeObject(AppObjEnum.CachedAppData, obj.cachedAppData.appData)
            )
            stream.writeString(obj.cachedAppData.dataID)
            stream.position = 0 // Reset position for reading

            expect(() => deserializeSendCachedAppDataReq(stream)).toThrowError('SendCachedAppDataReq version mismatch')
        })

        test('should serialize and deserialize successfully', () => {
            const obj: SendCachedAppDataReq = {
                topic: 'test',
                cachedAppData: {
                    cycle: 1,
                    appData: { data: 'test' },
                    dataID: 'test',
                }
            }

            const stream = new VectorBufferStream(0)
            serializeSendCachedAppDataReq(stream, obj)
            stream.position = 0

            const data = deserializeSendCachedAppDataReq(stream)
            expect(data).toEqual(obj)
        })

        test('should throw AJV validation failed error', () => {
            const obj: SendCachedAppDataReq = {
                topic: 'test',
                cachedAppData: {
                    cycle: 1,
                    appData: 'invalid string',
                    dataID: 'test',
                }
            }

            const stream = new VectorBufferStream(0)
            serializeSendCachedAppDataReq(stream, obj)

            stream.position = 0
            expect(() => deserializeSendCachedAppDataReq(stream)).toThrowError('AJV: CachedAppData validation failed')

        })
    })
})
