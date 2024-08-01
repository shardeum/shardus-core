import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'

const getAccountQueueCountRespSchema = {
  oneOf: [
    {
      type: 'object',
      properties: {
        counts: {
          type: 'array',
          items: { type: 'number' },
        },
        committingAppData: {
          type: 'array',
          items: {}, // unknown
        },
        accounts: {
          type: 'array',
          items: {}, // unknown
        },
      },
      required: ['counts', 'committingAppData', 'accounts'],
    },
    {
      type: 'boolean',
      enum: [false],
    },
  ],
}

export function initGetAccountQueueCountResp(): void {
  addSchemaDependencies()
  addSchemas()
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  // No dependencies
}

// Function to register the schema
function addSchemas(): void {
  addSchema(AJVSchemaEnum.GetAccountQueueCountResp, getAccountQueueCountRespSchema)
}
