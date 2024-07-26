import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'
import { schemaWrappedDataFromQueueSerializable } from './WrappedDataFromQueueSerializable'

export const schemaGetAccountDataWithQueueHintsResp = {
  properties: {
    accountData: {
      type: ['array', 'null'],
      items: schemaWrappedDataFromQueueSerializable,
    },
  },
  required: ['accountData'],
}

export function initGetAccountDataWithQueueHintsResp(): void {
  addSchemaDependencies()
  addSchemas()
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  // No dependencies
}

// Function to register the schema
function addSchemas(): void {
  addSchema(AJVSchemaEnum.GetAccountDataWithQueueHintsResp, schemaGetAccountDataWithQueueHintsResp)
}
