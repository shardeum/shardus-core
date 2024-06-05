import { VectorBufferStream } from '../../../../src'
import { ConfirmOrChallengeMessage } from '../../../../src/state-manager/state-manager-types'
import {
  cConfirmOrChallengeMessageVersion,
  serializeConfirmOrChallengeMessage,
} from '../../../../src/types/ConfirmOrChallengeMessage'
import { initAjvSchemas } from '../../../../src/types/ajv/Helpers'
import { TypeIdentifierEnum } from '../../../../src/types/enum/TypeIdentifierEnum'
import { serializeAppliedVote } from '../../../../src/types/AppliedVote'
import { cSignVersion } from '../../../../src/types/Sign'

describe('ConfirmOrChallengeMessage Serialization', () => {
  beforeAll(() => {
    initAjvSchemas()
  })

  test('Should serialize with root true', () => {
    const obj: ConfirmOrChallengeMessage = {
      message: 'message',
      nodeId: 'node1',
      appliedVote: {
        txid: 'txid',
        transaction_result: true,
        account_id: ['acc123'],
        account_state_hash_after: ['state123'],
        account_state_hash_before: ['state123'],
        cant_apply: false,
        node_id: 'node1',
      },
      sign: {
        sig: 'sign',
        owner: 'node1',
      },
    }

    const stream = new VectorBufferStream(0)
    serializeConfirmOrChallengeMessage(stream, obj, true)

    const expectedStream = new VectorBufferStream(0)
    expectedStream.writeUInt16(TypeIdentifierEnum.cConfirmOrChallengeMessage)
    expectedStream.writeUInt8(cConfirmOrChallengeMessageVersion)
    expectedStream.writeString(obj.message)
    expectedStream.writeString(obj.nodeId)
    serializeAppliedVote(expectedStream, obj.appliedVote)
    if (obj.sign) {
      expectedStream.writeUInt8(1)
      expectedStream.writeUInt8(cSignVersion)
      expectedStream.writeString(obj.sign.owner)
      expectedStream.writeString(obj.sign?.sig)
    }

    expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
  })

  test('Should serialize with root false', () => {
    const obj: ConfirmOrChallengeMessage = {
      message: 'message',
      nodeId: 'node1',
      appliedVote: {
        txid: 'txid',
        transaction_result: true,
        account_id: ['acc123'],
        account_state_hash_after: ['state123'],
        account_state_hash_before: ['state123'],
        cant_apply: false,
        node_id: 'node1',
        sign: {
          sig: 'sign',
          owner: 'node1',
        },
      },
    }

    const stream = new VectorBufferStream(0)
    serializeConfirmOrChallengeMessage(stream, obj, false)

    const expectedStream = new VectorBufferStream(0)
    expectedStream.writeUInt8(cConfirmOrChallengeMessageVersion)
    expectedStream.writeString(obj.message)
    expectedStream.writeString(obj.nodeId)
    serializeAppliedVote(expectedStream, obj.appliedVote)
    expectedStream.writeUInt8(0)

    expect(stream.getBuffer()).toEqual(expectedStream.getBuffer())
  })
})
