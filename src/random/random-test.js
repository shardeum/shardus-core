const Random = require('./index')

const random = Random()

console.log(`Result of 'random.rand()': ${random.rand()}`)
console.log(`Result of 'random.randomInt(0, 1000)': ${random.randomInt(0, 1000)}\n`)

const seed1 = Random.generateSeed()
const seed2 = Random.generateSeed()

const random1 = Random(seed1)
const random2 = Random(seed1)
const random3 = Random(seed2)
console.log(`Randomly generated seed: ${seed1}`)
console.log(`Result of 'random.randomInt(0, 1000)' for two instances of random with the same seed, and one instance with a different seed:`)
console.log(`Instance 1: ${random1.randomInt(0, 1000)}`)
console.log(`Instance 2: ${random2.randomInt(0, 1000)}`)
console.log(`Instance 3 (different seed): ${random3.randomInt(0, 1000)}`)
