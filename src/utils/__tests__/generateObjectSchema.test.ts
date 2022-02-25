import { generateObjectSchema } from '..'

test('generateObjectSchema() > should generate proper object schema', () => {
  const obj = {
    timestamp: new Date(),
    fn: (str) => str,
    falsy: -0,
    id: 1,
    dummyObj: { id: 1, name: 'john doe', NRC: '23403492340' }, // this information is purely made up
    nestedObj: {
      numArr: [1, 3, 4],
      strArr: ['name1', 'name2'],
      multiDiArr: [[12, 32]],
      nestedArr: [{ id: 1 }, { id: 2 }],
      diverseArr: [1, false, 'str'],
      id: 1,
      debug: true,
    },
  }

  const expectedSchema = {
    timestamp: 'object',
    fn: 'function',
    falsy: 'number',
    id: 'number',
    dummyObj: { id: 'number', name: 'string', NRC: 'string' },
    nestedObj: {
      numArr: 'number[]',
      strArr: 'string[]',
      multiDiArr: 'array[]',
      nestedArr: '{}[]',
      diverseArr: 'any[]',
      id: 'number',
      debug: 'boolean',
    },
  }

  const generatedSchema = generateObjectSchema(obj)

  const isEqual =
    JSON.stringify(generatedSchema) === JSON.stringify(expectedSchema)

  expect(isEqual).toBe(true)
})
