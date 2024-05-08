import { addSchema } from '../../utils/serialization/SchemaHelpers'

const schemaGetTxTimestampReq = {
  type: 'object',
  properties: {
    txId: { type: 'string' },
    cycleCounter: { type: 'number' },
    cycleMarker: { type: 'string' },
  },
  required: ['txId', 'cycleCounter', 'cycleMarker'],
}

export function initGetTxTimestampReq(): void {
  addSchemaDependencies()
  addSchemas()
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  // No dependencies
}

// Function to register the schema
function addSchemas(): void {
  addSchema('GetTxTimestampReq', schemaGetTxTimestampReq)
}
