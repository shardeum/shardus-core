import { P2PNode } from "./Types";

export interface JoinedArchiver {
  curvePk: string
  ip: string
  port: number
  publicKey: string
}

// Should eventually become Node type from NodeList
export interface JoinedConsensor extends P2PNode {
  id: string
  cycleJoined: string
}
