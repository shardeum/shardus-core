import { VectorBufferStream } from '../utils/serialization/VectorBufferStream'
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum'
import {
  deserializeWrappedDataFromQueue,
  serializeWrappedDataFromQueue,
  WrappedDataFromQueueBinary,
} from './WrappedDataFromQueue'

const cGetAccountDataWithQueueHintsRespVersion = 1

export type GetAccountDataWithQueueHintsRespBinary = {
  accountData: WrappedDataFromQueueBinary[] | null
}

export function serializeGetAccountDataWithQueueHintsResp(
  stream: VectorBufferStream,
  obj: GetAccountDataWithQueueHintsRespBinary,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGetAccountDataWithQueueHintsResp)
  }
  stream.writeUInt16(cGetAccountDataWithQueueHintsRespVersion)
  if (obj.accountData !== null) {
    stream.writeUInt8(1)
    stream.writeUInt16(obj.accountData.length)
    for (const item of obj.accountData) {
      serializeWrappedDataFromQueue(stream, item)
    }
  } else {
    stream.writeUInt8(0)
  }
}

export function deserializeGetAccountDataWithQueueHintsResp(
  stream: VectorBufferStream
): GetAccountDataWithQueueHintsRespBinary {
  const version = stream.readUInt16()
  if (version > cGetAccountDataWithQueueHintsRespVersion) {
    throw new Error('Unsupported version')
  }
  const accountDataPresent = stream.readUInt8()
  let accountData = null
  if (accountDataPresent === 1) {
    const length = stream.readUInt16()
    accountData = []
    for (let i = 0; i < length; i++) {
      accountData.push(deserializeWrappedDataFromQueue(stream)) // Deserialize each WrappedDataFromQueueBinary
    }
  }
  return {
    accountData,
  }
}
