import { addSchema } from '../../utils/serialization/SchemaHelpers'

const schemaApoptosisResp = {
  type: 'object',
  properties: {
    s: { type: 'string' },
    r: { type: 'number' },
  },
  required: ['s', 'r'],
}

export function initApoptosisProposal(): void {
  addSchemaDependencies()
  addSchemas()
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  // No dependencies
}

// Function to register the schema
function addSchemas(): void {
  addSchema('ApoptosisProposalResp', schemaApoptosisResp)
}
