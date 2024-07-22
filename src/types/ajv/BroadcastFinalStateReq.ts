import { addSchema, addSchemaDependency } from '../../utils/serialization/SchemaHelpers'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'

const BroadcastFinalStateReqSchema = {
    type: 'object',
    properties: {
        txid: { type: 'string' },
        stateList: {
        type: 'array',
        items: { $ref: AJVSchemaEnum.WrappedDataResponse },
        },
    },
    required: ['txid', 'stateList'],
}

export function initBroadcastFinalStateReq(): void {
    addSchemaDependencies()
    addSchemas()
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
    addSchemaDependency(AJVSchemaEnum.WrappedDataResponse, AJVSchemaEnum.BroadcastFinalStateReq)
}

// Function to register the schema
function addSchemas(): void {
    addSchema(AJVSchemaEnum.BroadcastFinalStateReq, BroadcastFinalStateReqSchema)
}


