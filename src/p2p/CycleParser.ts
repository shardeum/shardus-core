import { Cycle, JoinedConsensor } from './CycleChain'
import { Node, Update } from './NodeList'
import { NodeStatus } from './Types'
import { reversed } from './Utils'

export interface Change {
  added: JoinedConsensor[] // order joinRequestTimestamp [OLD, ..., NEW]
  removed: Array<Node['id']> // order doesn't matter
  updated: Update[] // order doesn't matter
}

export function parse(cycle: Cycle): Change {
  const added: Change['added'] = []
  const removed: Change['removed'] = []
  const updated: Change['updated'] = []

  // Nodes to be added
  added.push(...cycle.joinedConsensors) // order joinRequestTimestamp [OLD, ..., NEW]

  // Nodes to be removed
  removed.push(...cycle.removed)
  removed.push(...cycle.apoptosized)
  removed.push(...cycle.lost)

  // Nodes to be updated
  updated.push(
    ...cycle.activated.map(id => ({
      id,
      activeTimestamp: cycle.start,
      status: NodeStatus.ACTIVE,
    }))
  )

  return {
    added,
    removed,
    updated,
  }
}

export class ChangeSquasher {
  final: Change
  removedIds: Set<Node['id']>
  seenUpdates: Map<Update['id'], Update>
  constructor() {
    this.final = {
      added: [],
      removed: [],
      updated: [],
    }
    this.removedIds = new Set()
    this.seenUpdates = new Map()
  }

  addChange(change: Change) {
    for (const id of change.removed) {
      // Ignore if id is already removed
      if (this.removedIds.has(id)) continue
      // Mark this id as removed
      this.removedIds.add(id)
    }

    for (const update of change.updated) {
      // Ignore if update.id is already removed
      if (this.removedIds.has(update.id)) continue
      // Mark this id as updated
      this.seenUpdates.set(update.id, update)
    }

    for (const joinedConsensor of reversed(change.added)) {
      // Ignore if joinedConsensor.id is already removed
      if (this.removedIds.has(joinedConsensor.id)) {
        this.removedIds.delete(joinedConsensor.id)
        continue
      }
      // Check if this id has updates
      const update = this.seenUpdates.get(joinedConsensor.id)
      if (update) {
        // If so, put them into final.updated
        this.final.updated.unshift(update)
        this.seenUpdates.delete(joinedConsensor.id)
      }
      // Add joinedConsensor to final.added
      this.final.added.unshift(joinedConsensor)
    }
  }
}
