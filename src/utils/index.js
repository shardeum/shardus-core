const { readFileSync } = require('fs')

const sleep = (ms) => {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

const getTime = (format = 'ms') => {
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

const deepCopy = (obj) => {
  if (typeof obj !== 'object') throw Error('Object not of type object.')
  return JSON.parse(JSON.stringify(obj))
}

const readJson = (filename) => {
  const file = readFileSync(filename)
  const config = JSON.parse(file)
  console.log(config)
  return config
}

exports.sleep = sleep
exports.getTime = getTime
exports.deepCopy = deepCopy
exports.readJson = readJson
