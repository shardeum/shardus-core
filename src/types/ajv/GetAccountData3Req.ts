import { GetAccountData3Req } from '../../state-manager/state-manager-types'
import { addSchema } from '../../utils/serialization/SchemaHelpers'

// Defining the AJV schema for GetAccountData3Req
const schemaGetAccountData3Req = {
  type: 'object',
  properties: {
    accountStart: { type: 'string' },
    accountEnd: { type: 'string' },
    tsStart: { type: 'number' },
    maxRecords: { type: 'number' },
    offset: { type: 'number' },
    accountOffset: { type: 'string' },
  },
  required: ['accountStart', 'accountEnd', 'tsStart', 'maxRecords', 'offset', 'accountOffset'],
}

export function initGetAccountData3Req(): void {
  addSchemaDependencies()
  addSchemas()
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  // No dependencies
}

// Function to register the schema
function addSchemas(): void {
  addSchema('GetAccountData3Req', schemaGetAccountData3Req)
}

// Serialization function
export function serializeGetAccountData3Req(data: GetAccountData3Req): string {
  return JSON.stringify(data)
}

// Deserialization function
export function deserializeGetAccountData3Req(data: string): GetAccountData3Req {
  return JSON.parse(data)
}
