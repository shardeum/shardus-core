import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'

export const schemaRequestReceiptForTxReq = {
  type: 'object',
  properties: {
    txid: { type: 'string' },
    timestamp: { type: 'number' },
  },
  required: ['txid', 'timestamp'],
}

export function initRequestReceiptForTxReq(): void {
  addSchemaDependencies()
  addSchemas()
}

function addSchemaDependencies(): void {
  // No dependencies
}

function addSchemas(): void {
  addSchema(AJVSchemaEnum.RequestReceiptForTxReq, schemaRequestReceiptForTxReq)
}
