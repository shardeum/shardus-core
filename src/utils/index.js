const { readFileSync, readdirSync } = require('fs')
const { join } = require('path')

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
  return config
}

const readJsonDir = (dir) => { // => filesObj
  let filesObj = {}
  readdirSync(dir).forEach(fileName => {
    let name = fileName.split('.')[0]
    filesObj[name] = readJson(join(dir, fileName))
  })
  return filesObj
}

const insertSorted = (arr, item, comparator) => {
  if (comparator == null) {
    // Emulate the default Array.sort() comparator
    comparator = (a, b) => {
      if (typeof a !== 'string') a = String(a)
      if (typeof b !== 'string') b = String(b)
      return (a > b ? 1 : (a < b ? -1 : 0))
    }
  }

  // Get the index we need to insert the item at
  let min = 0
  let max = arr.length
  let index = Math.floor((min + max) / 2)
  while (max > min) {
    if (comparator(item, arr[index]) < 0) {
      max = index
    } else {
      min = index + 1
    }
    index = Math.floor((min + max) / 2)
  }
  // Insert the item
  arr.splice(index, 0, item)
}

const XOR = (hexString1, hexString2) => {
  const num1 = parseInt(hexString1.substring(0, 8), 16)
  const num2 = parseInt(hexString2.substring(0, 8), 16)
  return (num1 ^ num2) >>> 0
}

const setAlarm = (callback, timestamp) => {
  const now = Date.now()
  if (timestamp <= now) {
    callback()
    return
  }
  const toWait = timestamp - now
  setTimeout(callback, toWait)
}

const isObject = (val) => {
  if (val === null) {
    return false
  }
  return ((typeof val === 'function') || (typeof val === 'object'))
}

exports.sleep = sleep
exports.getTime = getTime
exports.deepCopy = deepCopy
exports.readJson = readJson
exports.readJsonDir = readJsonDir
exports.insertSorted = insertSorted
exports.XOR = XOR
exports.setAlarm = setAlarm
exports.isObject = isObject
