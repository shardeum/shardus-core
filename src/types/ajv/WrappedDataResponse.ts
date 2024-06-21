import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { schemaWrappedData } from './WrappedData'
import { AJV_IDENT } from './Helpers'

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
  addSchema(AJV_IDENT.WRAPPED_DATA_RESPONSE, schemaWrappedDataResponse)
}
