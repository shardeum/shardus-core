/**
 * Returns an array of two arrays, one will all resolved promises, and one with all rejected promises
 */
export const robustPromiseAll = async (promises) => {
  // This is how we wrap a promise to prevent it from rejecting directing in the Promise.all and causing a short circuit
  const wrapPromise = async (promise) => {
    // We are trying to await the promise, and catching any rejections
    // We return an array, the first index being resolve, and the second being an error
    try {
      const result = await promise
      return [result]
    } catch (e) {
      return [null, e]
    }
  }

  const wrappedPromises = []
  // We wrap all the promises we received and push them to an array to be Promise.all'd
  for (const promise of promises) {
    wrappedPromises.push(wrapPromise(promise))
  }
  const resolved = []
  const errors = []
  // We await the wrapped promises to finish resolving or rejecting
  const wrappedResults = await Promise.all(wrappedPromises)
  // We iterate over all the results, checking if they resolved or rejected
  for (const wrapped of wrappedResults) {
    const [result, err] = wrapped
    // If there was an error, we push it to our errors array
    if (err) {
      errors.push(err)
      continue
    }
    // Otherwise, we were able to resolve so we push it to the resolved array
    resolved.push(result)
  }
  Promise
  // We return two arrays, one of the resolved promises, and one of the errors
  return [resolved, errors]
}

export const groupResolvePromises = async <T>(
  promiseList: Promise<T>[],
  evaluationFn: (res: T) => boolean,
  maxLosses: number,
  minWins: number
): Promise<{ success: boolean; wins: T[]; losses: T[] }> => {
  let wins: T[] = [],
    losses: T[] = [],
    winCount: number = 0,
    lossCount: number = 0

  return new Promise((resolve, reject) => {
    for (let i = 0; i < promiseList.length; i++) {
      let promise = promiseList[i]
      promise
        .then((value) => {
          const evalStatus = evaluationFn(value)
          if (evalStatus) {
            wins.push(value)
            winCount++
          } else {
            losses.push(value)
            lossCount++
          }

          if (winCount >= minWins) {
            resolve({
              success: true,
              wins: wins,
              losses: losses,
            })
          }
          if (lossCount >= maxLosses) {
            resolve({
              success: false,
              wins: wins,
              losses: losses,
            })
          }
        })
        .catch((error) => {
          reject(error)
        })
    }
  })
}
