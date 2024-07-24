import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'
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
  addSchema(AJVSchemaEnum.GetAppliedVoteResp, schemaGetAppliedVoteResp)
}
