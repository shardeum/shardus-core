import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { schemaWrappedData } from './WrappedData'

const schemaGetAccountDataByHashesResp = {
  type: 'object',
  properties: {
    accounts: {
      type: 'array',
      items: schemaWrappedData,
    },
    stateTableData: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          accountId: { type: 'string' },
          txId: { type: 'string' },
          txTimestamp: { type: 'string' },
          stateBefore: { type: 'string' },
          stateAfter: { type: 'string' },
        },
        required: ['accountId', 'txId', 'txTimestamp', 'stateBefore', 'stateAfter'],
      },
    },
  },
  required: ['accounts', 'stateTableData'],
}

export function initGetAccountDataByHashesResp(): void {
  addSchemaDependencies()
  addSchemas()
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  addSchema('WrappedData', schemaWrappedData)
}

// Function to register the schema
function addSchemas(): void {
  addSchema('GetAccountDataByHashesResp', schemaGetAccountDataByHashesResp)
}
