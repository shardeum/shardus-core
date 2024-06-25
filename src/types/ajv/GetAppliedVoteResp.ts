import { AJV_IDENT } from './Helpers'
import { schemaAppliedVote } from './RepairOOSAccountsReq'
import { addSchema } from '../../utils/serialization/SchemaHelpers'

export const schemaGetAppliedVoteResp = {
  type: 'object',
  properties: {
    txId: { type: 'string' },
    appliedVote: schemaAppliedVote,
    appliedVoteHash: { type: 'string' },
  },
  required: ['txId', 'appliedVote', 'appliedVoteHash'],
}

export function initGetAppliedVoteResp(): void {
  addSchemaDependencies()
  addSchemas()
}

function addSchemaDependencies(): void {
  // No dependencies
}

function addSchemas(): void {
  addSchema(AJV_IDENT.GET_APPLIED_VOTE_RESP, schemaGetAppliedVoteResp)
}
