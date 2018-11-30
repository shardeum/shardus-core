const path = require('path')
const fs = require('fs')

function readLogFile (targetLog, relativePath = '../../logs/') {
  let logPath = path.join(__dirname, relativePath, `${targetLog}.log`)
  if (!fs.existsSync(logPath)) return false
  return fs.readFileSync(logPath).toString()
}

function resetLogFile (targetLog, relativePath = '../../logs/') {
  let logPath = path.join(__dirname, relativePath, `${targetLog}.log`)
  if (!fs.existsSync(logPath)) return false
  fs.writeFileSync(logPath, '')
  return true
}

exports.readLogFile = readLogFile
exports.resetLogFile = resetLogFile
