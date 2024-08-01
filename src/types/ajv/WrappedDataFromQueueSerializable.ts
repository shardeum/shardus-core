import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { schemaWrappedData } from './WrappedData'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'

export const schemaWrappedDataFromQueueSerializable = {
  type: 'object',
  properties: {
    ...schemaWrappedData.properties,
    seenInQueue: { type: 'boolean' },
  },
  required: [...schemaWrappedData.required, 'seenInQueue'],
}

export function initWrappedDataFromQueueSerializable(): void {
  addSchemaDependencies()
  addSchemas()
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  // No dependencies
}

// Function to register the schema
function addSchemas(): void {
  addSchema(AJVSchemaEnum.WrappedDataFromQueueSerializable, schemaWrappedDataFromQueueSerializable)
}
