import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'

const schemaAccountIDAndHash = {
  type: 'object',
  properties: {
    accountID: { type: 'string' },
    hash: { type: 'string' },
  },
  required: ['accountID', 'hash'],
}

const schemaRadixAndChildHashes = {
  type: 'object',
  properties: {
    radix: { type: 'string' },
    childAccounts: {
      type: 'array',
      items: schemaAccountIDAndHash,
    },
  },
  required: ['radix', 'childAccounts'],
}

const schemaGetTrieAccountHashesResp = {
  type: 'object',
  properties: {
    nodeChildHashes: {
      type: 'array',
      items: schemaRadixAndChildHashes,
    },
    stats: {
      type: 'object',
      properties: {
        matched: { type: 'number' },
        visisted: { type: 'number' },
        empty: { type: 'number' },
        childCount: { type: 'number' },
      },
      required: ['matched', 'visisted', 'empty', 'childCount'],
    },
  },
  required: ['nodeChildHashes', 'stats'],
}

export function initGetTrieAccountHashesResp(): void {
  addSchemaDependencies()
  addSchemas()
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  // No dependencies
}

// Function to register the schema
function addSchemas(): void {
  addSchema(AJVSchemaEnum.GetTrieAccountHashesResp, schemaGetTrieAccountHashesResp)
}
