import { VectorBufferStream } from '../utils/serialization/VectorBufferStream';
import { WrappedData, deserializeWrappedData, serializeWrappedData } from './WrappedData';
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum';

export const cWrappedDataResponseVersion = 1;

export interface WrappedDataResponse extends WrappedData {
  accountCreated: boolean;
  isPartial: boolean;
}

export function serializeWrappedDataResponse(
  stream: VectorBufferStream,
  obj: WrappedDataResponse,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cWrappedDataResponse);
  }
  stream.writeUInt8(cWrappedDataResponseVersion);
  serializeWrappedData(stream, obj);
  stream.writeUInt8(obj.accountCreated ? 1 : 0);
  stream.writeUInt8(obj.isPartial ? 1 : 0);
}

export function deserializeWrappedDataResponse(stream: VectorBufferStream): WrappedDataResponse {
  const version = stream.readUInt8();
  if (version > cWrappedDataResponseVersion) {
    throw new Error('WrappedDataResponse version mismatch');
  }
  const wrappedData = deserializeWrappedData(stream);
  return {
    ...wrappedData,
    accountCreated: stream.readUInt8() !== 0,
    isPartial: stream.readUInt8() !== 0,
  };
}
