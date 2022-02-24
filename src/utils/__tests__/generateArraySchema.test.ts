import { generateArraySchema } from '..'

test('generateArraySchema() > should generate proper array schema', () => {
  const num = [1, 3, 2]
  const str = ['john', 'doe']
  const fn = [(str) => str]
  const instanceObj = [new Date(), new Date()]
  const literalObj = [{}, {}]
  const any = [1, false, 'doe']
  const dimensional = [
    [1, 2, 3],
    [1, 1],
  ]

  expect(generateArraySchema(num)).toBe('number[]')
  expect(generateArraySchema(str)).toBe('string[]')
  expect(generateArraySchema(fn)).toBe('function[]')
  expect(generateArraySchema(instanceObj)).toBe('object[]')
  expect(generateArraySchema(literalObj)).toBe('{}[]')
  expect(generateArraySchema(any)).toBe('any[]')
  expect(generateArraySchema(dimensional)).toBe('array[]')
})
