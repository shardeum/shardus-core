import { Utils } from '@shardus/types'
import { initAjvSchemas } from '../../../../src/types/ajv/Helpers'
import {
  deserializeGetCachedAppDataReq,
  GetCachedAppDataReq,
  serializeGetCachedAppDataReq,
} from '../../../../src/types/GetCachedAppDataReq'
import { VectorBufferStream } from '../../../../src'

jest.mock('../../../../src/p2p/Context', () => ({
  setDefaultConfigs: jest.fn(),
  stateManager: {
    app: {
      binarySerializeObject: jest.fn((enumType, data) => Buffer.from(Utils.safeStringify(data), 'utf8')),
      binaryDeserializeObject: jest.fn((enumType, buffer) => Utils.safeJsonParse(buffer.toString('utf8'))),
    },
  },
}))

describe('GetCachedAppDataReq serialization and deserialization', () => {
  beforeAll(() => {
    initAjvSchemas()
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('combined serialization and deserialization happy case', () => {
    const stream = new VectorBufferStream(0)
    const request: GetCachedAppDataReq = { topic: 'testTopic', dataId: 'testDataId' }
    serializeGetCachedAppDataReq(stream, request)
    stream.position = 0

    const deserialized = deserializeGetCachedAppDataReq(stream)

    expect(deserialized).toEqual(request)
  })

  test('invalid deserialised payload ajv fail', () => {
    try {
      const stream = new VectorBufferStream(0)
      const request: GetCachedAppDataReq = { topic: 'testTopic', dataId: 'testDataId' }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const req = request as any
      delete req.topic
      req.hello = 'world'
      serializeGetCachedAppDataReq(stream, req)
      stream.position = 0

      deserializeGetCachedAppDataReq(stream)
    } catch (e) {
      expect(e).toBeDefined()
    }
  })
})
