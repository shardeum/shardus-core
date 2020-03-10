import { Request, Response, Handler } from "express"

export enum NodeStatus {
  ACTIVE = 'active',
  SYNCING = 'syncing',
}

export interface Node {
  ip: string
  port: number
  publicKey: string
}

export interface NodeInfo {
  curvePublicKey: string
  externalIp: string
  externalPort: number
  id: string
  internalIp: string
  internalPort: number
  publicKey: string
  status: NodeStatus
}

export interface Route<T> {
  method?: string,
  name: string
  handler: T
}

export type InternalHandler<
  Payload = unknown,
  Response = unknown,
  Sender = unknown
> = (
  payload: Payload,
  respond: (response?: Response) => void,
  sender: Sender,
  tracker: string
) => void

export type GossipHandler<Payload = unknown, Sender = unknown> = (
  payload: Payload,
  sender: Sender,
  tracker: string
) => void
