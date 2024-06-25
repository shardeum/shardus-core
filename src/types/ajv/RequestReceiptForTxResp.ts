import { AJV_IDENT } from './Helpers'
import { schemaAppliedReceipt2 } from './RepairOOSAccountsReq'
import { addSchema } from '../../utils/serialization/SchemaHelpers'

export const schemaRequestReceiptForTxResp = {
  type: 'object',
  properties: {
    receipt: schemaAppliedReceipt2,
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
  addSchema(AJV_IDENT.REQUEST_RECEIPT_FOR_TX_RESP, schemaRequestReceiptForTxResp)
}
