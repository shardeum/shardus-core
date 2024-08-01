import { Utils } from '@shardus/types'
import { VectorBufferStream } from '../../../../src'
import { initAjvSchemas } from '../../../../src/types/ajv/Helpers'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'
import {
  GetAccountQueueCountResp,
  cGetAccountQueueCountRespVersion,
  deserializeGetAccountQueueCountResp,
  serializeGetAccountQueueCountResp,
} from '../../../../src/types/GetAccountQueueCountResp'
import { AppObjEnum } from '../../../../src/shardus/shardus-types'

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

const { stateManager } = require('../../../../src/p2p/Context')

describe('serializeGetAccountQueueCountResp', () => {
  test('should serialize with root = true', () => {
    const stream = new VectorBufferStream(0)
    const obj = { counts: [1, 2], committingAppData: [{}], accounts: [{}] }
    serializeGetAccountQueueCountResp(stream, obj, true)

    const expectedStream = new VectorBufferStream(0)
    expectedStream.writeUInt16(TypeIdentifierEnum.cGetAccountQueueCountResp) // typeId
    expectedStream.writeUInt8(cGetAccountQueueCountRespVersion)
    expectedStream.writeUInt8(1) // type indicator (not false)
    expectedStream.writeUInt16(2) // counts length
    expectedStream.writeUInt32(1)
    expectedStream.writeUInt32(2)
    expectedStream.writeUInt16(1) // committingAppData length
    expectedStream.writeBuffer(stateManager.app.binarySerializeObject(AppObjEnum.AppData, {}))
    expectedStream.writeUInt16(1) // accounts length
    expectedStream.writeBuffer(stateManager.app.binarySerializeObject(AppObjEnum.AppData, {}))
    expectedStream.writeUInt16(TypeIdentifierEnum.cGetAccountQueueCountResp) // closing typeId

    expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
  })

  test('should serialize with root = false', () => {
    const stream = new VectorBufferStream(0)
    const obj = { counts: [1, 2], committingAppData: [{}], accounts: [{}] }
    serializeGetAccountQueueCountResp(stream, obj, false)

    const expectedStream = new VectorBufferStream(0)
    expectedStream.writeUInt8(cGetAccountQueueCountRespVersion)
    expectedStream.writeUInt8(1) // type indicator (not false)
    expectedStream.writeUInt16(2) // counts length
    expectedStream.writeUInt32(1)
    expectedStream.writeUInt32(2)
    expectedStream.writeUInt16(1) // committingAppData length
    expectedStream.writeBuffer(stateManager.app.binarySerializeObject(AppObjEnum.AppData, {}))
    expectedStream.writeUInt16(1) // accounts length
    expectedStream.writeBuffer(stateManager.app.binarySerializeObject(AppObjEnum.AppData, {}))

    expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
  })

  test('should serialize with false', () => {
    const stream = new VectorBufferStream(0)
    const obj = false
    serializeGetAccountQueueCountResp(stream, obj, false)

    const expectedStream = new VectorBufferStream(0)
    expectedStream.writeUInt8(cGetAccountQueueCountRespVersion)
    expectedStream.writeUInt8(0) // type indicator (false)

    expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
  })
})

describe('deserializeGetAccountQueueCountResp', () => {
  beforeAll(() => {
    initAjvSchemas()
  })

  test('should deserialize with valid data', () => {
    const stream = new VectorBufferStream(0)
    stream.writeUInt8(cGetAccountQueueCountRespVersion)
    stream.writeUInt8(1) // type indicator (not false)
    stream.writeUInt16(2) // counts length
    stream.writeUInt32(1)
    stream.writeUInt32(2)
    stream.writeUInt16(1) // committingAppData length
    stream.writeBuffer(stateManager.app.binarySerializeObject(AppObjEnum.AppData, {}))
    stream.writeUInt16(1) // accounts length
    stream.writeBuffer(stateManager.app.binarySerializeObject(AppObjEnum.AppData, {}))

    stream.position = 0
    const result = deserializeGetAccountQueueCountResp(stream)
    expect(result).toEqual({
      counts: [1, 2],
      committingAppData: [{}],
      accounts: [{}],
    })
  })

  test('should throw error with version mismatch', () => {
    const stream = new VectorBufferStream(0)
    const obj = { counts: [1, 2], committingAppData: [{}], accounts: [{}] }
    serializeGetAccountQueueCountResp(stream, obj, false)
    const buffer = stream.getBuffer()
    buffer[0] = cGetAccountQueueCountRespVersion + 1
    const alteredStream = VectorBufferStream.fromBuffer(buffer)

    expect(() => deserializeGetAccountQueueCountResp(alteredStream)).toThrow(
      'GetAccountQueueCountResp version mismatch'
    )
  })

  test('should deserialize with false', () => {
    const stream = new VectorBufferStream(0)
    stream.writeUInt8(cGetAccountQueueCountRespVersion)
    stream.writeUInt8(0) // type indicator (false)

    stream.position = 0
    const result = deserializeGetAccountQueueCountResp(stream)
    expect(result).toEqual(false)
  })
})

describe('serialize and deserialize GetAccountQueueCountResp together', () => {
  test.each<[GetAccountQueueCountResp]>([
    [false],
    [{ counts: [1, 2, 3], committingAppData: [{}, {}], accounts: [{}, {}, {}] }],
  ])('should serialize and deserialize maintaining data integrity for %#', (originalObj) => {
    const stream = new VectorBufferStream(0)
    serializeGetAccountQueueCountResp(stream, originalObj, false)
    stream.position = 0 // Reset position for reading

    const deserializedObj = deserializeGetAccountQueueCountResp(stream)
    expect(deserializedObj).toEqual(originalObj)
  })
})
