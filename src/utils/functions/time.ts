export const sleep = (ms) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export const getTime = (format = 'ms') => {
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

export const setAlarm = (callback, timestamp) => {
  const now = Date.now()
  if (timestamp <= now) {
    callback()
    return
  }
  const toWait = timestamp - now
  setTimeout(callback, toWait)
}
