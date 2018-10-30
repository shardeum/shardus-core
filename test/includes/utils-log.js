const path = require('path')
const fs = require('fs')

function readLogFile (targetLog) {
  let logPath = path.join(__dirname, '../../logs/', `${targetLog}.log`)
  if (!fs.existsSync(logPath)) return false
  return fs.readFileSync(logPath).toString()
}

function resetLogFile (targetLog) {
  let logPath = path.join(__dirname, '../../logs/', `${targetLog}.log`)
  if (!fs.existsSync(logPath)) return false
  fs.writeFileSync(logPath, '')
  return true
}

exports.readLogFile = readLogFile
exports.resetLogFile = resetLogFile
