import { publicKey } from "@shardus/types";

/**
  * A message that an archiver could not be reached.
  */
export interface ArchiverDownTransaction {
  publicKey: publicKey;
  ip: string;
  port: number;
}

/**
  * A message that an archiver has come back up.
  */
export interface ArchiverUpTransaction {
  publicKey: publicKey;
}

/**
  * A message to investiage an archiver that is potentially lost.
  */
export interface ArchiverInvestigateTransaction {
  publicKey: publicKey;
  ip: string;
  port: number;
}

/**
  * A message to ping an archiver that is potentially lost.
  */
export interface ArchiverPingMessage {
  publicKey: publicKey;
  ip: string;
  port: number;
}
