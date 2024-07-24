import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'
import { schemaWrappedData } from './WrappedData'

export const schemaRequestStateForTxResp = {
  type: 'object',
  properties: {
    stateList: { type: 'array', items: schemaWrappedData },
    beforeHashes: {
      type: 'object',
      additionalProperties: {
        type: 'string',
      },
    },
    note: { type: 'string' },
    success: { type: 'boolean' },
  },
  required: ['stateList', 'beforeHashes', 'note', 'success'],
}

export function initRequestStateForTxResp(): void {
  addSchemaDependencies()
  addSchemas()
}

function addSchemaDependencies(): void {
  // No dependencies
}

function addSchemas(): void {
  addSchema(AJVSchemaEnum.RequestStateForTxResp, schemaRequestStateForTxResp)
}
