const Ajv = require('ajv')

const ajv = new Ajv({ additionalProperties: false })

const dependencyMap: Map<string, string> = new Map()
const schemaMap: Map<string, object> = new Map()
const verifyFunctions: Map<string, object> = new Map()

//
export function addSchemaDependency(name: string, requiredBy: string): void {
  dependencyMap.set(requiredBy, name)
}
export function addSchema(name: string, schema: object): void {
  if (schemaMap.has(name)) {
    throw new Error(`error already registerd ${name}`)
  }

  schemaMap.set(name, schema)
}

export function initializeSerialization() {
  //look at each dependencyMap value and make sure we have a value for it in the schemaMap
  for (const [key, value] of dependencyMap.entries()) {
    if (schemaMap.has(value)) {
      //add the schema to the ajv instance
      ajv.addSchema(value)
    } else {
      throw new Error(`error missing schema ${value} required by ${key}`)
    }
  }
}

export function getVerifyFunction(name: string): object {
  if (verifyFunctions.has(name)) {
    return verifyFunctions.get(name)
  }
  const schema = schemaMap.get(name)
  if (!schema) {
    throw new Error(`error missing schema ${name}`)
  }
  const verifyFn = ajv.compile(schema)
  verifyFunctions.set(name, verifyFn)
  return verifyFn
}
