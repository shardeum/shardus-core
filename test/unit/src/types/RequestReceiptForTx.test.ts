// write jest unit test for RequestStateForTx
import { Utils } from "@shardus/types"
import { AJV_IDENT, initAjvSchemas, verifyPayload } from "../../../../src/types/ajv/Helpers"
import { TypeIdentifierEnum } from "../../../../src/types/enum/TypeIdentifierEnum"
import { deserializeRequestReceiptForTxReq, serializeRequestReceiptForTxReq } from "../../../../src/types/RequestReceiptForTxReq"
import { deserializeRequestReceiptForTxResp, RequestReceiptForTxRespSerialized, serializeRequestReceiptForTxResp } from "../../../../src/types/RequestReceiptForTxResp"
import { deserializeRequestStateForTxReq, serializeRequestStateForTxReq } from '../../../../src/types/RequestStateForTxReq'
import { deserializeRequestStateForTxResp, serializeRequestStateForTxResp } from "../../../../src/types/RequestStateForTxResp"
import { VectorBufferStream } from "../../../../src/utils/serialization/VectorBufferStream"

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


    const appliedVote_dummy = {
        txid: 'txid',
        transaction_result: false,
        account_id: ['account_id'],
        account_state_hash_after: ['account_state_hash_after'],
        account_state_hash_before: ['account_state_hash_before'],
        cant_apply: false,
        node_id: 'node_id',
        sign: { sig: 'sign', owner: 'owner' },
        app_data_hash: 'app_data_hash',
    }
    const resp_payload: RequestReceiptForTxRespSerialized  = {
      receipt: {
        txid: 'txid',
        result: true,
        appliedVote: appliedVote_dummy,
        confirmOrChallenge: {
          message: 'message',
          nodeId: 'node_id',
          appliedVote: appliedVote_dummy,
          sign: { sig: 'sign', owner: 'owner' }
        },
        signatures: [
          { sig: 'sign', owner: 'owner' }
        ],
        app_data_hash: 'app_data_hash',
      },
      note: 'note',
      success: true
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


    const appliedVote_dummy = {
        txid: 'txid',
        transaction_result: false,
        account_id: ['account_id'],
        account_state_hash_after: ['account_state_hash_after'],
        account_state_hash_before: ['account_state_hash_before'],
        cant_apply: false,
        node_id: 'node_id',
        sign: { sig: 'sign', owner: 'owner' },
        app_data_hash: 'app_data_hash',
    }
    const resp_payload: RequestReceiptForTxRespSerialized  = {
      receipt: {
        txid: 'txid',
        result: true,
        appliedVote: appliedVote_dummy,
        confirmOrChallenge: {
          message: 'message',
          nodeId: 'node_id',
          appliedVote: appliedVote_dummy,
          sign: { sig: 'sign', owner: 'owner' }
        },
        signatures: [
          { sig: 'sign', owner: 'owner' }
        ],
        app_data_hash: 'app_data_hash',
      },
      note: 'note',
      success: true
    }

    const resp_stream = new VectorBufferStream(0)
    serializeRequestReceiptForTxResp(resp_stream, resp_payload, false)
    resp_stream.position = 0
    expect(deserializeRequestReceiptForTxResp(resp_stream)).toEqual(resp_payload)
  })

  test ('Should throw error if AJV fails', () => {
    const req_payload = {
      txid: ['txid'],
      timestamp: '123',
    }

    const req_errors = verifyPayload(AJV_IDENT.REQUEST_RECEIPT_FOR_TX_REQ, req_payload)
    expect(req_errors).toBeInstanceOf(Array)
    expect(req_errors).toHaveLength(1)

    const appliedVote_dummy = {
        txid: 'txid',
        transaction_result: false,
        account_id: ['account_id'],
        account_state_hash_after: ['account_state_hash_after'],
        account_state_hash_before: ['account_state_hash_before'],
        cant_apply: false,
        node_id: 'node_id',
        sign: { sig: 'sign', owner: 'owner' },
        app_data_hash: 'app_data_hash',
    }
    const resp_payload  = {
      receipt: {
        txid: 'txid',
        result: true,
        appliedVote: appliedVote_dummy,
        confirmOrChallenge: {
          message: 'message',
          nodeId: ['node_id'], // <- failure point
          appliedVote: appliedVote_dummy,
          sign: { sig: 'sign', owner: 'owner' }
        },
        signatures: [
          { sig: 'sign', owner: 'owner' }
        ],
        app_data_hash: 'app_data_hash',
      },
      note: 'note',
      success: 'true' // <- another failure point, but this will not be in errors array since ajv setting set allErrors to false at default
    }
    const errors = verifyPayload(AJV_IDENT.REQUEST_RECEIPT_FOR_TX_RESP, resp_payload)
    expect(errors).toBeInstanceOf(Array)
    expect(errors).toHaveLength(1)
  })

  test ('Should not throw error if AJV passes', () => {
    const req_payload = {
      txid: 'txid',
      timestamp: 123,
    }

    const req_errors = verifyPayload(AJV_IDENT.REQUEST_RECEIPT_FOR_TX_REQ, req_payload)
    expect(req_errors).toBeNull()

    const appliedVote_dummy = {
        txid: 'txid',
        transaction_result: false,
        account_id: ['account_id'],
        account_state_hash_after: ['account_state_hash_after'],
        account_state_hash_before: ['account_state_hash_before'],
        cant_apply: false,
        node_id: 'node_id',
        sign: { sig: 'sign', owner: 'owner' },
        app_data_hash: 'app_data_hash',
    }
    const resp_payload  = {
      receipt: {
        txid: 'txid',
        result: true,
        appliedVote: appliedVote_dummy,
        confirmOrChallenge: {
          message: 'message',
          nodeId: 'node_id', 
          appliedVote: appliedVote_dummy,
          sign: { sig: 'sign', owner: 'owner' }
        },
        signatures: [
          { sig: 'sign', owner: 'owner' }
        ],
        app_data_hash: 'app_data_hash',
      },
      note: 'note',
      success: true 
    }
    const errors = verifyPayload(AJV_IDENT.REQUEST_RECEIPT_FOR_TX_RESP, resp_payload)
    expect(errors).toBeNull()
  })

})

