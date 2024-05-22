import { addSchema } from '../../utils/serialization/SchemaHelpers'

const schemaGetAccountDataByListReq = {
  properties: {
    accountIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['accountIds'],
}

export function initGetAccountDataByListReq(): void {
  addSchemaDependencies()
  addSchemas()
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  // No dependencies
}

// Function to register the schema
function addSchemas(): void {
  addSchema('GetAccountDataByListReq', schemaGetAccountDataByListReq)
}
