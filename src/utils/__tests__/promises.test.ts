import { groupResolvePromises } from '..'

function generatePromise(data: any, delayInMs: number): Promise<string> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(data)
    }, delayInMs)
  })
}

test('groupResolvePromises() > should exit early due to total wins', async () => {
  const evaluationFunction = (data): boolean => {
    if (data == 'resolved') return true
    else return false
  }

  const res = await groupResolvePromises(
    [generatePromise('resolved', 10), generatePromise('rejected', 100)],
    evaluationFunction,
    1,
    1
  )

  expect(res.losses.length).toBe(0)
  expect(res.wins.length).toBe(1)
  expect(res.success).toBe(true)
})

test('groupResolvePromises() > should exit early due to total losses', async () => {
  const evaluationFunction = (data): boolean => {
    if (data == 'resolved') return true
    else return false
  }

  const res = await groupResolvePromises(
    [generatePromise('resolved', 100), generatePromise('rejected', 10)],
    evaluationFunction,
    1,
    1
  )

  expect(res.losses.length).toBe(1)
  expect(res.wins.length).toBe(0)
  expect(res.success).toBe(false)
})
