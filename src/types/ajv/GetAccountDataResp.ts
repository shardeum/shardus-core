import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'
import { schemaWrappedData } from './WrappedData'

const schemaGetAccountDataResp = {
  type: 'object',
  properties: {
    data: {
      type: 'object',
      properties: {
        wrappedAccounts: {
          type: 'array',
          items: schemaWrappedData,
        },
        lastUpdateNeeded: { type: 'boolean' },
        wrappedAccounts2: {
          type: 'array',
          items: schemaWrappedData,
        },
        highestTs: { type: 'number' },
        delta: { type: 'number' },
      },
      required: ['wrappedAccounts', 'lastUpdateNeeded', 'wrappedAccounts2', 'highestTs', 'delta'],
    },
    errors: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: [],
}

export function initGetAccountDataRespSerializable(): void {
  addSchemaDependencies()
  addSchemas()
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  // No dependencies
}

// Function to register the schema
function addSchemas(): void {
  addSchema(AJVSchemaEnum.GetAccountDataResp, schemaGetAccountDataResp)
}
