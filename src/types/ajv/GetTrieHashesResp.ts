import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'

const SchemaGetTrieHashesResp = {
  type: 'object',
  properties: {
    nodeHashes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          radix: { type: 'string' },
          hash: { type: 'string' },
        },
        required: ['radix', 'hash'],
      },
    },
    nodeId: { type: 'string' },
  },
  required: ['nodeHashes'],
}

export function initGetTrieHashesResp(): void {
  addSchemaDependencies()
  addSchemas()
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  // No dependencies
}

// Function to register the schema
function addSchemas(): void {
  addSchema(AJVSchemaEnum.GetTrieHashesResp, SchemaGetTrieHashesResp)
}
