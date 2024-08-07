import { VectorBufferStream } from '../utils/serialization/VectorBufferStream';
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum';

export const cSignAppDataRespVersion = 1;

export type SignAppDataResp = {
  success: boolean;
  signature: {
    owner: string;
    sig: string;
  };
};

export function serializeSignAppDataResp(
  stream: VectorBufferStream,
  obj: SignAppDataResp,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cSignAppDataResp);
  }
  stream.writeUInt8(cSignAppDataRespVersion);
  stream.writeUInt8(obj.success ? 1 : 0);
  stream.writeString(obj.signature.owner);
  stream.writeString(obj.signature.sig);
}

export function deserializeSignAppDataResp(stream: VectorBufferStream): SignAppDataResp {
  const version = stream.readUInt8();
  if (version > cSignAppDataRespVersion) {
    throw new Error(`SignAppDataResp version mismatch, version: ${version}`);
  }
  return {
    success: stream.readUInt8() === 1,
    signature: {
      owner: stream.readString(),
      sig: stream.readString(),
    },
  };
}
