import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJV_IDENT } from './Helpers'

const schemaSign = {
  type: 'object',
  properties: {
    owner: { type: 'string' },
    sig: { type: 'string' },
  },
  required: ['owner', 'sig'],
}

const schemaMakeReceiptReq = {
  type: 'object',
  properties: {
    sign: { type: 'object', items: schemaSign },
    address: { type: 'string' },
    value: {},
    when: { type: 'number' },
    source: { type: 'string' },
  },
  required: ['sign', 'address', 'value', 'when', 'source'],
}

export function initMakeReceiptReq(): void {
  addSchemaDependencies()
  addSchemas()
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
  // No dependencies
}

// Function to register the schema
function addSchemas(): void {
  addSchema('schemaSign', schemaSign)
  addSchema(AJV_IDENT.MAKE_RECEIPT_REQ, schemaMakeReceiptReq)
}
