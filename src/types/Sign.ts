import { VectorBufferStream } from '../utils/serialization/VectorBufferStream';
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum';

export const cSignVersion = 1;

export interface SignSerializable {
  owner: string; // The key of the owner
  sig: string; // The hash of the object's signature signed by the owner
}

export function serializeSign(stream: VectorBufferStream, obj: SignSerializable, root = false): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cSign);
  }
  stream.writeUInt8(cSignVersion);
  stream.writeString(obj.owner);
  stream.writeString(obj.sig);
}

export function deserializeSign(stream: VectorBufferStream): SignSerializable {
  const version = stream.readUInt8();
  if (version > cSignVersion) {
    throw new Error('Sign version mismatch');
  }
  const owner = stream.readString();
  const sig = stream.readString();
  return {
    owner,
    sig,
  };
}
