import { JoinedConsensor } from './JoinTypes'
import { Node, Update } from './NodeListTypes'

export interface Change {
  added: JoinedConsensor[] // order joinRequestTimestamp [OLD, ..., NEW]
  removed: Array<Node['id']> // order doesn't matter
  updated: Update[] // order doesn't matter
}
