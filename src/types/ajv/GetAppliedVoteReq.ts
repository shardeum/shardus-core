import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'

export const schemaGetAppliedVoteReq = {
  type: 'object',
  properties: {
    txId: { type: 'string' },
  },
  required: ['txId'],
}

export function initGetAppliedVoteReq(): void {
  addSchemaDependencies()
  addSchemas()
}

function addSchemaDependencies(): void {
  // No dependencies
}

function addSchemas(): void {
  addSchema(AJVSchemaEnum.GetAppliedVoteReq, schemaGetAppliedVoteReq)
}
