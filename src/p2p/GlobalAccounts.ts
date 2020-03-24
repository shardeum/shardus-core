import { SignedObject, Route, InternalHandler } from './Types'
import { Handler } from 'express'
import { p2p } from './Context'

/** TYPES */

export interface SetGlobalTx {
  address: string
  value: string
  when: string
  source: string
}

export type SignedSetGlobalTx = SetGlobalTx & SignedObject


/** ROUTES */

const makeReceiptRoute: Route<InternalHandler<SignedSetGlobalTx, unknown, string>> = {
  name: 'make-receipt',
  handler: (payload, respond, sender) => {
    makeReceipt(payload, sender)
  },
}
export const internalRoutes = [makeReceiptRoute]

/** STATE */

/** FUNCTIONS */

export function makeReceipt (signedTx, sender) {
  const tx = {...signedTx}
  delete tx.sign

  const txHash = p2p.crypto.hash(tx)
  console.log(`SETGLOBAL: GOT SIGNED_SET_GLOBAL_TX FROM ${sender.substring(0, 5)}: ${txHash} ${JSON.stringify(signedTx)}`)
}