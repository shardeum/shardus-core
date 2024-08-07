import { addSchema } from '../../utils/serialization/SchemaHelpers';
import { schemaWrappedData } from './WrappedData';

export const schemaGetAccountDataByListResp = {
  properties: {
    accountData: {
      type: ['array', 'null'],
      items: schemaWrappedData,
    },
  },
  required: ['accountData'],
};

export function initGetAccountDataByListResp(): void {
  addSchemaDependencies();
  addSchemas();
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  // No dependencies
}

// Function to register the schema
function addSchemas(): void {
  addSchema('GetAccountDataByListResp', schemaGetAccountDataByListResp);
}
