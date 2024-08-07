import { addSchema } from '../../utils/serialization/SchemaHelpers';

const schemaAccountIDAndHash = {
  type: 'object',
  properties: {
    accountID: { type: 'string' },
    hash: { type: 'string' },
  },
  required: ['accountID', 'hash'],
};

const schemaGetAccountDataByHashesReq = {
  type: 'object',
  properties: {
    cycle: { type: 'number' },
    accounts: {
      type: 'array',
      items: schemaAccountIDAndHash,
    },
  },
  required: ['cycle', 'accounts'],
};

export function initGetAccountDataByHashesReq(): void {
  addSchemaDependencies();
  addSchemas();
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  // No dependencies
}

// Function to register the schema
function addSchemas(): void {
  addSchema('GetAccountDataByHashesReq', schemaGetAccountDataByHashesReq);
}
