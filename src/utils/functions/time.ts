export const sleep = (ms): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export const getTime = (format = 'ms'): number => {
  let time
  switch (format) {
    case 'ms':
      time = Date.now()
      break
    case 's':
      time = Math.floor(Date.now() / 1000)
      break
    default:
      throw Error('Error: Invalid format given.')
  }
  return time
}

export const setAlarm = (callback, timestamp): void => {
  const now = Date.now()
  if (timestamp <= now) {
    callback()
    return
  }
  const toWait = timestamp - now
  setTimeout(callback, toWait)
}

export function inRangeOfCurrentTime(timestamp: number, before: number, after: number): boolean {
  const currentTime = Date.now()
  if (timestamp - currentTime <= after) {
    if (currentTime - timestamp <= before) {
      return true
    }
  }
  return false
}
