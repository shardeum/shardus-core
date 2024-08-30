// write jest unit test for RequestStateForTx
import { Utils } from '@shardus/types'
import { initAjvSchemas, verifyPayload } from '../../../../src/types/ajv/Helpers'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'
import {
  deserializeRequestReceiptForTxReq,
  serializeRequestReceiptForTxReq,
} from '../../../../src/types/RequestReceiptForTxReq'
import {
  deserializeRequestReceiptForTxResp,
  RequestReceiptForTxRespSerialized,
  serializeRequestReceiptForTxResp,
} from '../../../../src/types/RequestReceiptForTxResp'
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

describe('RequestReceiptForTx Serialization', () => {
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
    }
    serializeRequestReceiptForTxReq(req_stream, req_payload, true)
    // we'll read , so reset the position
    req_stream.position = 0

    expect(req_stream.readUInt16()).toEqual(TypeIdentifierEnum.cRequestReceiptForTxReq)
    expect(deserializeRequestReceiptForTxReq(req_stream)).toEqual(req_payload)

    const resp_payload: RequestReceiptForTxRespSerialized = {
      receipt: {
        proposal: {
          txid: 'test',
          applied: true,
          cant_preApply: false,
          accountIDs: ['a', 'b', 'c'],
          beforeStateHashes: ['b1', 'b2', 'b3'],
          afterStateHashes: ['a1', 'a2', 'a3'],
          appReceiptDataHash: 'hash',
        },
        signaturePack: [
          {
            sig: 'sign',
            owner: 'node1',
          },
        ],
        voteOffsets: [5],
        proposalHash: 'hash',
        sign: {
          sig: 'sign',
          owner: 'aggregator',
        },
      },
      note: 'note',
      success: true,
    }

    const resp_stream = new VectorBufferStream(0)
    serializeRequestReceiptForTxResp(resp_stream, resp_payload, true)
    resp_stream.position = 0
    expect(resp_stream.readUInt16()).toEqual(TypeIdentifierEnum.cRequestReceiptForTxResp)
    expect(deserializeRequestReceiptForTxResp(resp_stream)).toEqual(resp_payload)
  })

  test('Should serialize/desrialize with root false', () => {
    const req_stream = new VectorBufferStream(0)
    const req_payload = {
      txid: 'txid',
      timestamp: 123,
    }
    serializeRequestReceiptForTxReq(req_stream, req_payload, false)
    // we'll read , so reset the position
    req_stream.position = 0

    expect(deserializeRequestReceiptForTxReq(req_stream)).toEqual(req_payload)

    const resp_payload: RequestReceiptForTxRespSerialized = {
      receipt: {
        proposal: {
          txid: 'test',
          applied: true,
          cant_preApply: false,
          accountIDs: ['a', 'b', 'c'],
          beforeStateHashes: ['b1', 'b2', 'b3'],
          afterStateHashes: ['a1', 'a2', 'a3'],
          appReceiptDataHash: 'hash',
        },
        signaturePack: [
          {
            sig: 'sign',
            owner: 'node1',
          },
        ],
        voteOffsets: [5],
        proposalHash: 'hash',
        sign: {
          sig: 'sign',
          owner: 'aggregator',
        },
      },
      note: 'note',
      success: true,
    }

    const resp_stream = new VectorBufferStream(0)
    serializeRequestReceiptForTxResp(resp_stream, resp_payload, false)
    resp_stream.position = 0
    expect(deserializeRequestReceiptForTxResp(resp_stream)).toEqual(resp_payload)
  })

  test('Should throw error if AJV fails', () => {
    const req_payload = {
      txid: ['txid'],
      timestamp: '123',
    }

    const req_errors = verifyPayload(AJVSchemaEnum.RequestReceiptForTxReq, req_payload)
    expect(req_errors).toBeInstanceOf(Array)
    expect(req_errors).toHaveLength(1)

    const resp_payload = {
      receipt: {
        proposal: {
          txid: 'test',
          applied: true,
          cant_preApply: false,
          accountIDs: ['a', 'b', 'c'],
          beforeStateHashes: ['b1', 'b2', 'b3'],
          afterStateHashes: ['a1', 'a2', 'a3'],
          appReceiptDataHash: 'hash',
        },
        signaturePack: [
          {
            sig: 'sign',
            owner: 'node1',
          },
        ],
        proposalHash: 'hash',
        sign: {
          sig: 'sign',
          owner: 'aggregator',
        },
      },
      note: 'note',
      success: 'true', // <- another failure point, but this will not be in errors array since ajv setting set allErrors to false at default
    }
    const errors = verifyPayload(AJVSchemaEnum.RequestReceiptForTxResp, resp_payload)
    expect(errors).toBeInstanceOf(Array)
    expect(errors).toHaveLength(1)
  })

  test('Should not throw error if AJV passes', () => {
    const req_payload = {
      txid: 'txid',
      timestamp: 123,
    }

    const req_errors = verifyPayload(AJVSchemaEnum.RequestReceiptForTxReq, req_payload)
    expect(req_errors).toBeNull()

    const resp_payload: RequestReceiptForTxRespSerialized = {
      receipt: {
        proposal: {
          txid: 'test',
          applied: true,
          cant_preApply: false,
          accountIDs: ['a', 'b', 'c'],
          beforeStateHashes: ['b1', 'b2', 'b3'],
          afterStateHashes: ['a1', 'a2', 'a3'],
          appReceiptDataHash: 'hash',
        },
        signaturePack: [
          {
            sig: 'sign',
            owner: 'node1',
          },
        ],
        voteOffsets: [5],
        proposalHash: 'hash',
        sign: {
          sig: 'sign',
          owner: 'aggregator',
        },
      },
      note: 'note',
      success: true,
    }
    const errors = verifyPayload(AJVSchemaEnum.RequestReceiptForTxResp, resp_payload)
    expect(errors).toBeNull()
  })
})
