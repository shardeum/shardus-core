/** TYPES */
// No TXs for this module

export interface Txs {
  safetyMode: []
  safetyNum: []
  networkStateHash: []
}

export interface Record {
  safetyMode: boolean
  safetyNum: number
  networkStateHash: string
}
