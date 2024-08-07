/**
 * Returns an array of two arrays, one will all resolved promises, and one with all rejected promises
 */
export const robustPromiseAll = async <T, E = Error>(promises: Promise<T>[]): Promise<[T[], E[]]> => {
  // This is how we wrap a promise to prevent it from rejecting directing in the Promise.all and causing a short circuit
  const wrapPromise = async <T, E = Error>(promise: Promise<T>): Promise<[T] | [null, E]> => {
    // We are trying to await the promise, and catching any rejections
    // We return an array, the first index being resolve, and the second being an error
    try {
      const result = await promise;
      return [result];
    } catch (e) {
      return [null, e];
    }
  };

  const wrappedPromises = [];
  // We wrap all the promises we received and push them to an array to be Promise.all'd
  for (const promise of promises) {
    wrappedPromises.push(wrapPromise(promise));
  }
  const resolved = [];
  const errors = [];
  // We await the wrapped promises to finish resolving or rejecting
  const wrappedResults = await Promise.all(wrappedPromises);
  // We iterate over all the results, checking if they resolved or rejected
  for (const wrapped of wrappedResults) {
    const [result, err] = wrapped;
    // If there was an error, we push it to our errors array
    if (err) {
      errors.push(err);
      continue;
    }
    // Otherwise, we were able to resolve so we push it to the resolved array
    resolved.push(result);
  }
  // We return two arrays, one of the resolved promises, and one of the errors
  return [resolved, errors];
};

export const groupResolvePromises = async <T, E = Error>(
  promiseList: Promise<T>[],
  evaluationFn: (res: T) => boolean,
  maxLosses: number,
  minWins: number
): Promise<{ success: boolean; wins: T[]; losses: T[]; errors: E[] }> => {
  const wins: T[] = [];
  const losses: T[] = [];
  let winCount = 0;
  let lossCount = 0;
  const errs = [];

  return new Promise((resolve) => {
    for (let i = 0; i < promiseList.length; i++) {
      // eslint-disable-next-line security/detect-object-injection
      const promise = promiseList[i];
      promise
        .then((value) => {
          const evalStatus = evaluationFn(value);
          if (evalStatus) {
            wins.push(value);
            winCount++;
          } else {
            losses.push(value);
            lossCount++;
          }

          const status = computePromiseGroupStatus(winCount, minWins, lossCount, maxLosses);
          if (status != undefined) {
            resolve({
              success: status,
              wins: wins,
              losses: losses,
              errors: errs,
            });
          }
        })
        .catch((error) => {
          errs.push(error);
          lossCount++;
          const status = computePromiseGroupStatus(winCount, minWins, lossCount, maxLosses);
          if (status != undefined) {
            resolve({
              success: status,
              wins: wins,
              losses: losses,
              errors: errs,
            });
          }
        });
    }
  });
};

const computePromiseGroupStatus = (
  winCount: number,
  minWins: number,
  lossCount: number,
  maxLosses: number
): boolean | undefined => {
  if (winCount >= minWins) return true;
  if (lossCount >= maxLosses) return false;
  return undefined;
};

/**
 * Wraps an async function call with a max timeout.
 * @param fn - The async function to call.
 * @param timeoutMs - The maximum time in milliseconds to wait for the function to complete.
 * @returns A promise that resolves with the function's return value, or "timeout" if the timeout expires first.
 */
export async function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T | 'timeout'> {
  let timer: NodeJS.Timeout | undefined;

  // Create a promise that resolves when the async function completes
  const promise = fn();

  // Create a promise that resolves after the specified timeout
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      clearTimeout(timer);
      reject(new Error('Timeout'));
    }, timeoutMs);
  });

  // Wait for either the async function or the timeout to complete
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    if (timer) {
      clearTimeout(timer);
    }
    return result;
  } catch (err) {
    if (timer) {
      clearTimeout(timer);
    }
    return 'timeout';
  }
}
