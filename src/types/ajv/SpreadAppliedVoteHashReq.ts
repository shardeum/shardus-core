import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'

const schemaSpreadAppliedVoteHashReq = {
  type: 'object',
  properties: {
    txid: { type: 'string' },
    voteHash: { type: 'string' },
    sign: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        sig: { type: 'string' },
      },
      required: ['owner', 'sig'],
      additionalProperties: false,
    },
  },
  required: ['txid', 'voteHash'],
  additionalProperties: false,
}

export function initSpreadAppliedVoteHashReq(): void {
  addSchemaDependencies()
  addSchemas()
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  // No dependencies
}

// Function to register the schema
function addSchemas(): void {
  addSchema(AJVSchemaEnum.SpreadAppliedVoteHashReq, schemaSpreadAppliedVoteHashReq)
}
