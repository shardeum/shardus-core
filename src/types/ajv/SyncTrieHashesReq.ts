import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'

const SyncTrieHashesRequestSchema = {
  type: 'object',
  properties: {
    cycle: { type: 'number' },
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
  },
  required: ['cycle', 'nodeHashes'],
}

export function initSyncTrieHashesReq(): void {
  addSchemaDependencies()
  addSchemas()
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  // No dependencies
}

// Function to register the schema
function addSchemas(): void {
  addSchema(AJVSchemaEnum.SyncTrieHashesRequest, SyncTrieHashesRequestSchema)
}
