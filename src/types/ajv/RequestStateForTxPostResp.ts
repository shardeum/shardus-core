import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { schemaWrappedDataResponse } from './WrappedDataResponse'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'

const schemaRequestStateForTxPostResp = {
  type: 'object',
  properties: {
    stateList: {
      type: 'array',
      items: schemaWrappedDataResponse,
    },
    beforeHashes: {
      type: 'object',
      additionalProperties: { type: 'string' },
    },
    note: { type: 'string' },
    success: { type: 'boolean' },
  },
  required: ['stateList', 'beforeHashes', 'note', 'success'],
}

export function initRequestStateForTxPostResp(): void {
  addSchemaDependencies()
  addSchemas()
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  // No dependencies
}

// Function to register the schema
function addSchemas(): void {
  addSchema(AJVSchemaEnum.RequestStateForTxPostResp, schemaRequestStateForTxPostResp)
}
