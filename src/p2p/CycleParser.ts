import deepmerge from 'deepmerge'
import * as CycleCreator from './CycleCreator'
import { CycleRecord } from "../shared-types/Cycle/CycleCreatorTypes"
import { JoinedConsensor } from "../shared-types/Cycle/JoinTypes"
import { Node, Update } from './NodeList'
import { reversed } from '../utils'

export interface Change {
  added: JoinedConsensor[] // order joinRequestTimestamp [OLD, ..., NEW]
  removed: Array<Node['id']> // order doesn't matter
  updated: Update[] // order doesn't matter
}

export function parse(record: CycleRecord): Change {
  const changes = CycleCreator.submodules.map(submodule =>
    submodule.parseRecord(record)
  )
  const mergedChange = deepmerge.all<Change>(changes)
  return mergedChange
}

export class ChangeSquasher {
  final: Change
  removedIds: Set<Node['id']>
  seenUpdates: Map<Update['id'], Update>
  addedIds: Set<Node['id']>
  constructor() {
    this.final = {
      added: [],
      removed: [],
      updated: [],
    }
    this.addedIds = new Set()
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
      // Ignore if it's already been added
      if (this.addedIds.has(joinedConsensor.id)) continue

      // Ignore if joinedConsensor.id is already removed
      if (this.removedIds.has(joinedConsensor.id)) {
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
      // Mark this id as added
      this.addedIds.add(joinedConsensor.id)
    }
  }
}
