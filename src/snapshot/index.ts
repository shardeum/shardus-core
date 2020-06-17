import { storage, stateManager, crypto } from '../p2p/Context'
import { currentCycle } from '../p2p/CycleCreator'

export function init() {
  stateManager.on('prevCycleTxsFinalized', createPartitionStateHash)
}

export async function createPartitionStateHash() {
  const accts = await storage.getAccountCopiesByCycle(currentCycle)
  log('partitionStateHash', crypto.hash(accts))
}

function log(...things) {
  console.log('DBG', 'SNAPSHOT', ...things)
}