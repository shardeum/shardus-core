import { groupResolvePromises } from '..'

function generatePromise(data: any, delayInMs: number): Promise<string> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(data)
    }, delayInMs)
  })
}

function generateRejectedPromise(data: any, delayInMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      reject(data)
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

test('groupResolvePromises() > should exit early due to total losses with rejected promises', async () => {
  const evaluationFunction = (data): boolean => {
    if (data == 'resolved') return true
    else return false
  }

  const res = await groupResolvePromises(
    [
      generatePromise('resolved', 100),
      generatePromise('failed', 10),
      generatePromise('failed', 20),
      generateRejectedPromise('rejected', 5),
      generateRejectedPromise('rejected', 5),
    ],
    evaluationFunction,
    2,
    1
  )
  console.log(res)

  expect(res.losses.length).toBe(0)
  expect(res.errors.length).toBe(2)
  expect(res.wins.length).toBe(0)
  expect(res.success).toBe(false)
})
