import { addSchema } from '../../utils/serialization/SchemaHelpers'

// Defining the AJV schema for GetAccountData3Req
const schemaGetAccountData3Req = {
  type: 'object',
  properties: {
    accountStart: { type: 'string' },
    accountEnd: { type: 'string' },
    tsStart: { type: 'number' },
    maxRecords: { type: 'number' },
    offset: { type: 'number' },
    accountOffset: { type: 'string' },
  },
  required: ['accountStart', 'accountEnd', 'tsStart', 'maxRecords', 'offset', 'accountOffset'],
}

export function initGetAccountData3Req(): void {
  addSchemaDependencies()
  addSchemas()
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  // No dependencies
}

// Function to register the schema
function addSchemas(): void {
  addSchema('GetAccountData3Req', schemaGetAccountData3Req)
}
