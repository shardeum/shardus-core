import { Utils } from '@shardus/types'
import { initAjvSchemas } from '../../../../src/types/ajv/Helpers'
import {
  deserializeGetCachedAppDataResp,
  GetCachedAppDataResp,
  serializeGetCachedAppDataResp,
} from '../../../../src/types/GetCachedAppDataResp'
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

describe('GetCachedAppDataResp serialization and deserialization', () => {
  beforeAll(() => {
    initAjvSchemas()
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('combined serialization and deserialization happy case', () => {
    const stream = new VectorBufferStream(0)
    const request: GetCachedAppDataResp = {
      cachedAppData: {
        dataID: 'testDataId',
        appData: { hello: 'world' },
        cycle: 1,
      },
    }
    serializeGetCachedAppDataResp(stream, request)
    stream.position = 0

    const deserialized = deserializeGetCachedAppDataResp(stream)

    expect(deserialized).toEqual(request)
  })

  test('combined serialization and deserialization happy case without any cached app data', () => {
    const stream = new VectorBufferStream(0)
    const request: GetCachedAppDataResp = {}
    serializeGetCachedAppDataResp(stream, request)
    stream.position = 0

    const deserialized = deserializeGetCachedAppDataResp(stream)

    expect(deserialized).toEqual(request)
  })

  test('invalid deserialised payload ajv fail', () => {
    try {
      const stream = new VectorBufferStream(0)
      const request: GetCachedAppDataResp = {
        cachedAppData: {
          dataID: 'testDataId',
          appData: { hello: 'world' },
          cycle: 1,
        },
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const req = request as any
      delete req.topic
      req.hello = 'world'
      serializeGetCachedAppDataResp(stream, req)
      stream.position = 0

      deserializeGetCachedAppDataResp(stream)
    } catch (e) {
      expect(e).toBeDefined()
    }
  })
})
