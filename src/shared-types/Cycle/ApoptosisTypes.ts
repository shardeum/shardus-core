import { SignedObject } from '../P2PTypes';

/** TYPES */
interface ApoptosisProposal {
  id: string;
  when: number;
}
export type SignedApoptosisProposal = ApoptosisProposal & SignedObject;

export interface Txs {
  apoptosis: SignedApoptosisProposal[];
}

export interface Record {
  apoptosized: string[];
}
