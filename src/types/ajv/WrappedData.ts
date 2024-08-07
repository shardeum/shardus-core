import { addSchema } from '../../utils/serialization/SchemaHelpers';

export const schemaWrappedData = {
  type: 'object',
  properties: {
    accountId: { type: 'string' },
    stateId: { type: 'string' },
    data: {}, // Opaque data blob, type not specified
    timestamp: { type: 'number' },
    syncData: {
      anyOf: [
        { type: 'object', additionalProperties: true },
        { type: 'string' },
        { type: 'number' },
        { type: 'boolean' },
        { type: 'array' },
        { type: 'null' },
      ],
    },
  },
  required: ['accountId', 'stateId', 'data', 'timestamp'],
};

export function initWrappedData(): void {
  addSchemaDependencies();
  addSchemas();
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  // No dependencies
}

// Function to register the schema
function addSchemas(): void {
  addSchema('WrappedData', schemaWrappedData);
}
