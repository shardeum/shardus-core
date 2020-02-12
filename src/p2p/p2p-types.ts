// tslint:disable: variable-name

import {
  Static,
  Number,
  String,
  Record,
  Dictionary,
  Unknown,
  Union
} from 'runtypes';

export const JoinRequest = Record({
  cycleMarker: String,
  nodeInfo: Record({
    activeTimestamp: Number,
    address: String,
    externalIp: String,
    externalPort: Number,
    internalIp: String,
    internalPort: Number,
    joinRequestTimestamp: Number,
    publicKey: String,
  }),
  proofOfWork: Record({
    compute: Record({
      hash: String,
      nonce: String
    })
  }),
  selectionNum: String,
  sign: Record({
    owner: String,
    sig: String
  }),
});
export type JoinRequest = Static<typeof JoinRequest>;

// {"payload":{},"sender":"2365xdb640","tag":"1074xx1140f","tracker":"key_2365xdb640_1581448859447_0"}
export const InternalAsk = Record({
  payload: Union(Record({}), Dictionary(Unknown, 'string')),
  sender: String,
  tag: String,
  tracker: String
})
export type InternalAsk = Static<typeof InternalAsk>;