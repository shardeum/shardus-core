export {}
const crypto = require('shardus-crypto-utils')
crypto.init('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')

function hex2bin (hex) {
  let bin = ''
  for (let i = 0; i < hex.length; i++) {
    bin += parseInt(hex[i], 16).toString(2).padStart(4, '0')
  }
  return bin
}

process.on('message', ({ seed, difficulty }) => {
  let nonce, hash
  do {
    nonce = crypto.randomBytes()
    hash = crypto.hashObj({ seed, nonce })
  }
  while (parseInt(hex2bin(hash).substring(0, difficulty), 2) !== 0)
  process.send({
    nonce,
    hash
  })
})
