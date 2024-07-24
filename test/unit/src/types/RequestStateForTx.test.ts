import { Utils } from '@shardus/types'
import { initAjvSchemas, verifyPayload } from '../../../../src/types/ajv/Helpers'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'
import {
  deserializeRequestStateForTxReq,
  serializeRequestStateForTxReq,
} from '../../../../src/types/RequestStateForTxReq'
import {
  deserializeRequestStateForTxResp,
  serializeRequestStateForTxResp,
} from '../../../../src/types/RequestStateForTxResp'
import { VectorBufferStream } from '../../../../src/utils/serialization/VectorBufferStream'
import { AJVSchemaEnum } from '../../../../src/types/enum/AJVSchemaEnum'

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

describe('RequestStateForTx Serialization', () => {
  beforeAll(() => {
    initAjvSchemas()
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('Should serialize/desrialize with root true', () => {
    const req_stream = new VectorBufferStream(0)
    const req_payload = {
      txid: 'txid',
      timestamp: 123,
      keys: ['key1', 'key2'],
    }
    serializeRequestStateForTxReq(req_stream, req_payload, true)
    // we'll read , so reset the position
    req_stream.position = 0

    expect(req_stream.readUInt16()).toEqual(TypeIdentifierEnum.cRequestStateForTxReq)
    expect(deserializeRequestStateForTxReq(req_stream)).toEqual(req_payload)

    const resp_payload = {
      stateList: [
        {
          accountId: 'accountId',
          stateId: 'stateId',
          data: { key: 'value' },
          timestamp: 123,
          syncData: { key: 'value' },
        },
      ],
      beforeHashes: {
        accountId: 'hash',
      },
      note: 'note',
      success: true,
    }

    const resp_stream = new VectorBufferStream(0)
    serializeRequestStateForTxResp(resp_stream, resp_payload, true)

    resp_stream.position = 0
    expect(resp_stream.readUInt16()).toEqual(TypeIdentifierEnum.cRequestStateForTxResp)
    expect(deserializeRequestStateForTxResp(resp_stream)).toEqual(resp_payload)
  })

  test('Should serialize/desrialize with root false', () => {
    const stream = new VectorBufferStream(0)
    const data = {
      txid: 'txid',
      timestamp: 123,
      keys: ['key1', 'key2'],
    }
    serializeRequestStateForTxReq(stream, data, false)
    // we'll read , so reset the position
    stream.position = 0
    expect(deserializeRequestStateForTxReq(stream)).toEqual(data)

    const resp_payload = {
      stateList: [
        {
          accountId: 'accountId',
          stateId: 'stateId',
          data: { key: 'value' },
          timestamp: 123,
          syncData: { key: 'value' },
        },
      ],
      beforeHashes: {
        accountId: 'hash',
      },
      note: 'note',
      success: true,
    }

    const resp_stream = new VectorBufferStream(0)
    serializeRequestStateForTxResp(resp_stream, resp_payload, false)
    resp_stream.position = 0
    expect(deserializeRequestStateForTxResp(resp_stream)).toEqual(resp_payload)
  })

  test('Should return errors if AJV validation fails', () => {
    let data = {
      txid: 'txid',
      timestamp: '123',
      keys: ['key1', 'key2'],
    }
    let errors = verifyPayload(AJVSchemaEnum.RequestStateForTxReq, data)
    expect(errors).toBeInstanceOf(Array)
    expect(errors).toHaveLength(1)

    const resp_payload = {
      stateList: [
        {
          accountId: 'accountId',
          stateId: 'stateId',
          data: null, // <- this should not return an error
          timestamp: 123,
          syncData: { key: 'value' },
        },
      ],
      beforeHashes: {
        accountId: ['hash'], // <- this should return an error
      },
      note: 'note',
      success: true,
    }

    let errors2 = verifyPayload(AJVSchemaEnum.RequestStateForTxResp, resp_payload)
    expect(errors2).toBeInstanceOf(Array)
    expect(errors2).toHaveLength(1)
  })

  test('Should not return errors if AJV validation passes', () => {
    let data = {
      txid: 'txid',
      timestamp: 123,
      keys: ['key1', 'key2'],
    }
    let errors = verifyPayload(AJVSchemaEnum.RequestStateForTxReq, data)
    expect(errors).toBeNull()

    const resp_payload = {
      stateList: [
        {
          accountId: 'accountId',
          stateId: 'stateId',
          data: { key: 'value' },
          timestamp: 123,
          syncData: { key: 'value' },
        },
      ],
      beforeHashes: {
        accountId: 'hash',
      },
      note: 'note',
      success: true,
    }

    let errors2 = verifyPayload(AJVSchemaEnum.RequestStateForTxResp, resp_payload)
    expect(errors2).toBeNull()
  })
})
