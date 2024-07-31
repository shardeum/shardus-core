import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'

const schemaGetTrieAccountHashesReq = {
  type: 'object',
  properties: {
    radixList: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['radixList'],
}

export function initGetTrieAccountHashesReq(): void {
  addSchemaDependencies()
  addSchemas()
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  // No dependencies
}

// Function to register the schema
function addSchemas(): void {
  addSchema(AJVSchemaEnum.GetTrieAccountHashesReq, schemaGetTrieAccountHashesReq)
}
