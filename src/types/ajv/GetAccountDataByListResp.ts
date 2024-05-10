import { addSchema } from '../../utils/serialization/SchemaHelpers';
import { schemaWrappedData } from './WrappedData'; // Import the WrappedData schema

export const schemaGetAccountDataByListResp = {
  properties: {
    accountData: {
      type: ['array', 'null'],
      items: schemaWrappedData // using WrappedData schema here
    },
  },
  required: ['accountData']
};

export function initGetAccountDataByListResp(): void {
  addSchemaDependencies()
  addSchemas()
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  schemaWrappedData
}

// Function to register the schema
function addSchemas(): void {
  addSchema('GetAccountDataByListResp', schemaGetAccountDataByListResp)
}