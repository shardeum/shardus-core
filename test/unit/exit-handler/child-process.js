const ExitHandler = require('../../../src/exit-handler')
const { sleep } = require('../../../src/utils')
let exitHandler = new ExitHandler()

function printPow2 () {
  console.log(2 * 2)
}

function printMod2 () {
  return new Promise((resolve) => {
    const mod = 3 % 2
    console.log(mod)
    resolve(mod)
  })
}

exitHandler.registerSync('pow', printPow2)
exitHandler.registerAsync('mod', printMod2())

async function init () {
  await exitHandler.exitCleanly()
}

init()
