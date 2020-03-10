import { EventEmitter } from 'events'
import P2P from '.'

export type P2PModuleContext = P2P & EventEmitter

export let p2p: P2PModuleContext

export function setContext(context: P2PModuleContext) {
  p2p = context
}
