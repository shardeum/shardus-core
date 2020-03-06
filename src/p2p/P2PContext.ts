import { P2PModuleContext } from './p2p-types';

export let p2p: P2PModuleContext

export function setContext(context: P2PModuleContext) {
  p2p = context;
}
