import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'
import { schemaSignedReceipt } from './RepairOOSAccountsReq'
import { addSchema } from '../../utils/serialization/SchemaHelpers'

export const schemaRequestReceiptForTxResp = {
  type: 'object',
  properties: {
    receipt: schemaSignedReceipt,
    note: { type: 'string' },
    success: { type: 'boolean' },
  },
  required: ['receipt', 'note', 'success'],
}

export function initRequestReceiptForTxResp(): void {
  addSchemaDependencies()
  addSchemas()
}

function addSchemaDependencies(): void {
  // No dependencies
}

function addSchemas(): void {
  addSchema(AJVSchemaEnum.RequestReceiptForTxResp, schemaRequestReceiptForTxResp)
}
