import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'

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
  addSchema(AJVSchemaEnum.RequestStateForTxReq, shcemaRequestStateForTxReq)
}
