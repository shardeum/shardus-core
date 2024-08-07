import { AppHeader } from '@shardus/net/build/src/types';
import { Sign } from '../shardus/shardus-types';
import { VectorBufferStream } from '../utils/serialization/VectorBufferStream';

export declare type InternalBinaryHandler<Payload = unknown, Response = unknown> = (
  payload: Payload,
  respond: (
    response: Response,
    serializerFunc: (stream: VectorBufferStream, obj: Response, root?: boolean) => void,
    header?: AppHeader
  ) => void,
  header: AppHeader,
  sign: Sign
) => void;
