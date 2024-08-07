import { VectorBufferStream } from '../utils/serialization/VectorBufferStream';
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum';

export type RequestStateForTxReq = { txid: string; timestamp: number; keys: string[] };

export const cRequestStateForTxReqVersion = 1;

export function serializeRequestStateForTxReq(
  stream: VectorBufferStream,
  inp: RequestStateForTxReq,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cRequestStateForTxReq);
  }
  stream.writeUInt8(cRequestStateForTxReqVersion);
  stream.writeString(inp.txid);
  stream.writeString(inp.timestamp.toString());
  stream.writeUInt32(inp.keys.length);
  for (let i = 0; i < inp.keys.length; i++) {
    // eslint-disable-next-line security/detect-object-injection
    stream.writeString(inp.keys[i]);
  }
}

export function deserializeRequestStateForTxReq(stream: VectorBufferStream): RequestStateForTxReq {
  const version = stream.readUInt8();
  if (version !== cRequestStateForTxReqVersion) {
    throw new Error('Unsupported version');
  }
  const txid = stream.readString();
  const timestamp = parseInt(stream.readString());
  const keysLength = stream.readUInt32();
  const keys = new Array<string>(keysLength);
  for (let i = 0; i < keysLength; i++) {
    // eslint-disable-next-line security/detect-object-injection
    keys[i] = stream.readString();
  }
  return { txid, timestamp, keys };
}
