import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'

const schemaRequestStateForTxPostReq = {
  type: 'object',
  properties: {
    txid: { type: 'string' },
    timestamp: { type: 'number' },
    key: { type: 'string' },
    hash: { type: 'string' },
  },
  required: ['txid', 'timestamp', 'key', 'hash'],
}

export function initRequestStateForTxPostReq(): void {
  addSchemaDependencies()
  addSchemas()
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  // No dependencies
}

// Function to register the schema
function addSchemas(): void {
  addSchema(AJVSchemaEnum.RequestStateForTxPostReq, schemaRequestStateForTxPostReq)
}
