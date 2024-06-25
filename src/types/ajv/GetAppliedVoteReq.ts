import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJV_IDENT } from './Helpers'

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
  addSchema(AJV_IDENT.GET_APPLIED_VOTE_REQ, schemaGetAppliedVoteReq)
}
