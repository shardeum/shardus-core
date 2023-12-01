import { publicKey } from "@shardus/types";

/**
  * The set of archiver public keys that are lost.
  */
export type LostArchivers = Set<publicKey>;

/**
  * The set of archiver public keys that have been investigated.
  */
export type InvestigatedArchivers = Set<publicKey>;
