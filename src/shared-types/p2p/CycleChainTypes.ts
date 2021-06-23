import { CycleRecord } from './CycleCreatorTypes'
import { LooseObject } from './P2PTypes'

/** TYPES */

export interface UnfinshedCycle {
  metadata: LooseObject
  updates: LooseObject
  data: CycleRecord
}
