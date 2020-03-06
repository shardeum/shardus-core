import * as CycleChain from './CycleChain'
import { Cycle } from './CycleChain'
import * as NodeList from './NodeList'
import { Node } from './NodeList'
import { ChangeSquasher, parse } from './CycleParser'
import { reversed } from './p2p-utils'

export async function sync(activeNodes: { ip: string, port: string, publicKey: string }) {

  console.log('Started Sync > sync...')

  // Get the networks newest cycle as the anchor point for sync
  const newestCycle = await getNewestCycle(activeNodes)
  CycleChain.append(newestCycle)

  // Sync old cycles until your active nodes === network active nodes
  const squasher = new ChangeSquasher()
  do {
    const prevCycles = await getCycles(
      activeNodes,
      CycleChain.oldest.counter - 100,
      CycleChain.oldest.counter
    )
    for (const prevCycle of reversed(prevCycles)) {
      CycleChain.validate(prevCycle, CycleChain.oldest)
      CycleChain.prepend(prevCycle)
      squasher.addChange(parse(prevCycle))
      if (squasher.final.updated.length >= newestCycle.active) {
        break
      }
    }
  } while (squasher.final.updated.length < newestCycle.active)
  NodeList.addNodes(
    squasher.final.added.map(joined => NodeList.createNode(joined))
  )
  NodeList.updateNodes(squasher.final.updated)

  // Sync new cycles until you can get unfinished cycle data in time to start making cycles
  await syncNewCycles(activeNodes)

  let unfinishedCycle = await getUnfinishedCycle(activeNodes)
  while (
    CycleChain.newest.counter < unfinishedCycle.counter - 1 ||
    isInQuarter4(unfinishedCycle)
  ) {
    await waitUntilEnd(unfinishedCycle)
    await syncNewCycles(activeNodes)
    unfinishedCycle = await getUnfinishedCycle(activeNodes)
  }

  // [TODO] Add unfinished cycle data and go active
}

async function syncNewCycles(activeNodes) {
  let newestCycle = getNewestCycle(activeNodes)
  while (CycleChain.newest.counter < newestCycle.counter) {
    const nextCycles = await getCycles(
      activeNodes,
      CycleChain.newest.counter,
      newestCycle.counter
    )
    for (const nextCycle of nextCycles) {
      CycleChain.validate(CycleChain.newest, nextCycle)
      CycleChain.append(nextCycle)
      const changes = parse(nextCycle)
      NodeList.removeNodes(changes.removed)
      NodeList.updateNodes(changes.updated)
      NodeList.addNodes(
        changes.added.map(joined => NodeList.createNode(joined))
      )
    }
    newestCycle = getNewestCycle(activeNodes)
  }
}

async function getNewestCycle(activeNodes): Cycle {}
async function getUnfinishedCycle(activeNodes): Cycle {}
async function getCycles(activeNodes, start, end): Cycle[] {}

async function waitUntilEnd(cycle: Cycle) {}
function isInQuarter4(cycle: Cycle): boolean {}
