import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJV_IDENT } from './Helpers'

export const shcemaRequestStateForTxReq = {
  type: 'object',
  properties: {
    txid: { type: 'string' },
    timestamp: { type: 'number' },
    keys: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['txid', 'timestamp', 'keys'],
}

export function initRequestStateForTxReq(): void {
  addSchemaDependencies()
  addSchemas()
}

function addSchemaDependencies(): void {
  // No dependencies
}

function addSchemas(): void {
  addSchema(AJV_IDENT.REQUEST_STATE_FOR_TX_REQ, shcemaRequestStateForTxReq)
}
