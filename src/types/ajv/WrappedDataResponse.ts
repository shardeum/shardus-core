import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { schemaWrappedData } from './WrappedData'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'

export const schemaWrappedDataResponse = {
  type: 'object',
  properties: {
    ...schemaWrappedData.properties,
    accountCreated: { type: 'boolean' },
    isPartial: { type: 'boolean' },
  },
  required: [...schemaWrappedData.required, 'accountCreated', 'isPartial'],
}

export function initWrappedDataResponse(): void {
  addSchemaDependencies()
  addSchemas()
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  // No dependencies
}

// Function to register the schema
function addSchemas(): void {
  addSchema(AJVSchemaEnum.WrappedDataResponse, schemaWrappedDataResponse)
}
