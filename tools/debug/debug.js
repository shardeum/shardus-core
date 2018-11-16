const fs = require('fs')
const { exec } = require('child_process')

const suffix = 'COPY_S55_DEBUG'

// IMPORTANT: TAKE CARE WITH / in baseDir and targetDir to not double it in the concat process
// first parameter is the baseDir
let baseDir = process.argv[2]
// second parameter is the targed dir
let targetDir = process.argv[3]
// third parameter is the number of desired copies
let copiesNumber = Number(process.argv[4])

async function removeCopies () {
  return new Promise((resolve, reject) => {
    console.log(`[executing] rm -rf ${baseDir}/${targetDir} $COPIES`)
    exec(`rm -rf ${baseDir}/${targetDir}${suffix}*`, (err, stdout, stderr) => {
      if (err) { reject(new Error('could not execute the command')) }
      // the *entire* stdout and stderr (buffered)
      console.log(`stdout: ${stdout}`)
      console.log(`stderr: ${stderr}`)
      resolve(true)
    })
  })
}

function createCopy (n) {
  return new Promise((resolve, reject) => {
    exec(`cp -R ${baseDir}/${targetDir} ${baseDir}/${targetDir + suffix + n}`, (err, stdout, stderr) => {
      if (err) { reject(new Error('could not execute the command')) }
      // the *entire* stdout and stderr (buffered)
      console.log(`stdout: ${stdout}`)
      console.log(`stderr: ${stderr}`)
      resolve(true)
    })
  })
}

function removeLogDb (n) {
  return new Promise((resolve, reject) => {
    exec(`rm ${baseDir}/${targetDir + suffix + n}/logs/*.log && rm ${baseDir}/${targetDir + suffix + n}/db/*`, (err, stdout, stderr) => {
      if (err) { resolve(new Error('could not remove logs or db, one or more file were not present')) }
      console.log(`stdout: ${stdout}`)
      console.log(`stderr: ${stderr}`)
      resolve(true)
    })
  })
}

// Start from the actual copied port + 1 instead of + 0 from the loop i
function changeExternalPort (n) {
  let conf = JSON.parse(fs.readFileSync(baseDir + '/' + targetDir + suffix + n + '/config/server.json'))
  conf.externalPort += 1 + n
  console.log(conf.externalPort)
  fs.writeFileSync(baseDir + '/' + targetDir + suffix + n + '/config/server.json', JSON.stringify(conf, null, 2))
}

async function createCopies () {
  for (let i = 0; i < copiesNumber; i++) {
    console.log(`[executing] cp -R ${baseDir}/${targetDir} ${baseDir}/${targetDir + suffix + i}`)
    await createCopy(i)
    try {
      await removeLogDb(i)
    } catch (e) {
      console.log('WARNING:', e)
    }
    changeExternalPort(i)
  }
}

console.log('dirname', __dirname)

async function init () {
  console.log('removing old copies...')
  await removeCopies()
  console.log('creating and configuring copies...')
  await createCopies()
  console.log('done!')
}

init()
