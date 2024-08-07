import { VectorBufferStream } from '../utils/serialization/VectorBufferStream';
import { TypeIdentifierEnum } from './enum/TypeIdentifierEnum';

const cGlobalAccountReportReqVersion = 1;

// eslint-disable-next-line @typescript-eslint/ban-types
export type GlobalAccountReportReqSerializable = {};

export function serializeGlobalAccountReportReq(
  stream: VectorBufferStream,
  obj: GlobalAccountReportReqSerializable,
  root = false
): void {
  if (root) {
    stream.writeUInt16(TypeIdentifierEnum.cGlobalAccountReportReq);
  }
  stream.writeUInt8(cGlobalAccountReportReqVersion);
}

export function deserializeGlobalAccountReportReq(
  stream: VectorBufferStream
): GlobalAccountReportReqSerializable {
  const version = stream.readUInt8();
  if (version > cGlobalAccountReportReqVersion) {
    throw new Error('GlobalAccountReportReqSerializable version mismatch');
  }

  const req: GlobalAccountReportReqSerializable = {};
  return req;
}
