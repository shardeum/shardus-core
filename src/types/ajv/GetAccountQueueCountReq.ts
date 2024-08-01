import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'

const getAccountQueueCountReqSchema = {
  type: 'object',
  properties: {
    accountIds: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['accountIds'],
}

export function initGetAccountQueueCountReq(): void {
  addSchemaDependencies()
  addSchemas()
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  // No dependencies
}

// Function to register the schema
function addSchemas(): void {
  addSchema(AJVSchemaEnum.GetAccountQueueCountReq, getAccountQueueCountReqSchema)
}
