
const StateManager = require('../../../src/state-manager')
// const utils = require('../../../utils')

let hashSetList = []
let hashSetList2 = []
//                                                     00010203040506070809101112131415161718192021222324252627282930313233343536373839404142434445464748495051525354555657

// test 10z
// hashSetList.push({ hash: 'b4', votePower: 1, hashSet: '11b87d44ea854b30b122ac84601cc0bb24909be7283be9bbe4641f529d4f597cfab1b18850fbe6250cdcff5abe9b7c0af2d17086f4e3cba77e81', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })
// hashSetList.push({ hash: 'b1', votePower: 1, hashSet: '11b87d44ea854b30b122841cc0bb24909be728f53be9bbe4641f529d4f597cfab1b18850fbe6250cdcff5abe9b7c0af2d17086f4e3cba77e81', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })
// hashSetList.push({ hash: 'b2', votePower: 1, hashSet: '11b87d44ea854b30b122ac84601cc0bb24909be728f53be9e4641f529d4f597cfab1b18850fbe6250cdcff5abe9b7c0af2d17086f4e3cba77e81', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })
// hashSetList.push({ hash: 'b3', votePower: 1, hashSet: '11b87d44ea854bb12284601cc0bb24909be728f53be9bbe4641f529d4f597cfab1b18850fbe60cdcff5abe9b7c0af2d17086e3cba77e81', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })
// hashSetList.push({ hash: 'b5', votePower: 1, hashSet: '11b87d44ea854b30b122ac84601cc0bb24909be728f53be9bbe4641f529d4f597cfab1b18850fbe6250cdcff5abe9b7cf2d17086f4e3cba77e81', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })

// hashSetList.push({ hash: 'c1', votePower: 1, hashSet: '98f8c3eb12fd07474b6cd29559fd1b39d76c253b0efd721b364272f38796d7fd7d0913d0c4eca4f917fc7b4949e883f6831b7038800683c141', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })
// hashSetList.push({ hash: 'd1', votePower: 1, hashSet: 'f8c312fd07474b6cd29559fd1b39d76c253b0efd721b364272f3b18796d7fd7d0913d0c4eca4f917fc7b4949e883f6831b7038800683c141', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })
// hashSetList.push({ hash: 'd1', votePower: 1, hashSet: 'a1b1c1d1e2f1', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })

// test 11z simple
// hashSetList.push({ hash: 'b5', votePower:  1, hashSet: '9abc94e384c2faea3b762d3c858568ec6933d1a08f55f3bd036f7768675f5d79f3c86f9a93bfba4f99b69159d71cae6c4d0da8391ad262b74a', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })
// hashSetList.push({ hash: 'b1', votePower: 10, hashSet: '9abc94e384c2faea3b762d3c858568ec6933d1a08f55f3bd036f7768675f5d79f3c86f9a93bfba4f99b69159d71cae6c4d0da8391ad262b74a', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })

// test 16z simple
// hashSetList.push({ hash: 'b4', votePower: 1, hashSet: 'fdc991226252b04f88d00751b0d0dc55e76a26642105ccae5daae0f293a8eff7fdab68fa922c04c1d803b77dbb714d6fa143c6a1bd0b', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })
// hashSetList.push({ hash: 'b1', votePower: 10, hashSet: 'fdc991226252b04f88d00751b0d0dc55e76a26642105ccae5daae0f293a8eff7fdaba1fa922c04c1d803b77dbb714d6fa143c668bd0b', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })

// test 17z simple
// hashSetList.push({ hash: 'b4', votePower: 1, hashSet: 'cbe42ecaf675673870f1eb2c4f0677cd9354f84102786c71eecd9af9dd987bef49c889ec098281c85170a2cd5c18c4b9611830e37cfe61dde29f3764573583d23abdedf5b3eafe7963958df377b49fb14dea9aeefa4f8b7c7d456aa96a', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })
// hashSetList.push({ hash: 'b1', votePower: 10, hashSet: 'cbe42ecaf675673870f1eb2c4f0677cd9354f84102786c71eecd9af9dd987bef49c889ecdd8281c85170a2cd5c18c4b9611830e37cfe6109e29f3764573583d23abdedf5b3eafe7963958df377b49fb14dea9aeefa4f8b7c7d456aa96a', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })

// hashSetList.push({ hash: 'b4', votePower: 1, hashSet: 'cbe42ecaf675673870f1eb2c4f0677cd9354f84102786c71eecd9af9dd987bef49c889ec8281c85170a2cd5c18c4b9611830e37cfe61e29f3764573583d23abdedf5b3eafe7963958d77b49fb1fb4dea9aeefa4f8b7c7d456aa96a', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })
// hashSetList.push({ hash: 'b1', votePower: 1, hashSet: 'cb2ecaf675673870f1eb2c4f06cd9354f84102786c71eecd9af9dd987bef49c889ecdd8281c851a2cd5c18c4b9611830e37cfe6109e29f3764573583d23abdf5b3eafe7963958df377b49fb1fb4dea9aeefa4f8b7c7d456aa96a', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })
// hashSetList.push({ hash: 'b2', votePower: 1, hashSet: 'cbe42ecaf675673870f1eb2c4f0677cd9354f84102786c71eecd9af9dd987bef49c889ecdd8281c85170a2cd5c18c4b9611830e37cfe6109e29f3764573583d23abdedf5b3eafe7963958df377b49fb1fb4dea9aeefa4f8b7c7d456aa96a', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })
// hashSetList.push({ hash: 'b3', votePower: 1, hashSet: 'cbe42ecaf675673870f1eb2c4f0677cd9354f84102786c71eecd9af9dd987bef49c889ecdd8281c85170a2cd5c18c4b9611830e37cfe6109e29f3764573583d23abdedf5b3eafe7963958df377b49fb14dea9aeefa4f7c7d456aa96a', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })
// hashSetList.push({ hash: 'b5', votePower: 1, hashSet: 'cbe42ecaf675673870f1eb2c4f0677cd9354f84102786c71eecd9af9dd987bef49c889ecdd8281c85170a2cd5c18c4b9611830e37cfe6109e29f37645783d23abdedf5b3eafe7963958df377b49fb14dea9aeefa4f8b7c7d456aa96a', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })
// hashSetList.push({ hash: 'b6', votePower: 100, hashSet: 'cbe42ecaf675673870f1eb2c4f0677cd9354f84102786c71eecd9af9dd987bef49c889ecdd8281c85170a2cd5c18c4b9611830e37cfe6109e29f3764573583d23abdedf5b3eafe7963958df377b49fb14dea9aeefa4f8b7c7d456aa96a', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })

// [2019-05-06T11:52:22.064] [ERROR] main - {"hash":"a1","votePower":1,"hashSet":"cbe42ecaf675673870f1eb2c4f0677cd9354f84102786c71eecd9af9dd987bef49c889ec098281c85170a2cd5c18c4b9611830e37cfe61dde29f3764573583d23abdedf5b3eafe7963958df377b49fb14dea9aeefa4f8b7c7d456aa96a","lastValue":"6a","errorStack":[],"corrections":[{"i":36,"tv":{"v":"dd","count":10,"vote":{"count":10,"ec":0,"voters":[1]}},"v":"dd","t":"insert","bv":"09","if":36},{"i":36,"t":"extra","c":{"i":37,"tv":{"v":"82","count":10,"vote":{"count":10,"ec":1,"voters":[1]}},"v":"82","t":"insert","bv":"09","if":37},"hi":36},{"i":55,"tv":{"v":"09","count":10,"vote":{"count":10,"ec":0,"voters":[1]}},"v":"09","t":"insert","bv":"dd","if":55},{"i":55,"t":"extra","c":{"i":56,"tv":{"v":"e2","count":10,"vote":{"count":10,"ec":1,"voters":[1]}},"v":"e2","t":"insert","bv":"dd","if":56},"hi":55}],"indexOffset":0}
// [2019-05-06T11:52:22.064] [ERROR] main - {"hash":"b1","votePower":10,"hashSet":"cbe42ecaf675673870f1eb2c4f0677cd9354f84102786c71eecd9af9dd987bef49c889ecdd8281c85170a2cd5c18c4b9611830e37cfe6109e29f3764573583d23abdedf5b3eafe7963958df377b49fb14dea9aeefa4f8b7c7d456aa96a","lastValue":"6a","errorStack":[],"corrections":[],"indexOffset":0}
// [2019-05-06T11:52:22.064] [ERROR] main - ["cb","e4","2e","ca","f6","75","67","38","70","f1","eb","2c","4f","06","77","cd","93","54","f8","41","02","78","6c","71","ee","cd","9a","f9","dd","98","7b","ef","49","c8","89","ec","dd","82","81","c8","51","70","a2","cd","5c","18","c4","b9","61","18","30","e3","7c","fe","61","09","e2","9f","37","64","57","35","83","d2","3a","bd","ed","f5","b3","ea","fe","79","63","95","8d","f3","77","b4","9f","b1","4d","ea","9a","ee","fa","4f","8b","7c","7d","45","6a","a9","6a"]
// [2019-05-06T11:52:22.064] [ERROR] main - [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,-1,36,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,-1,55,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92]
// [2019-05-06T11:52:22.064] [ERROR] main - [36,55]

// test 21z   9001 prove order matters
// hashSetList.push({ hash: 'b4', votePower: 2, hashSet: 'dc2c900ea9767c314ea92afa324e18d178b26105dd406af0d0a961e780cfeece5a31a64f3174ae8a7cf44383873c4dd5ba0524a20b6fdf2db319d5efd685affd7a1b4380d8bfae023880444f7729a565de71', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })
// hashSetList.push({ hash: 'b1', votePower: 2, hashSet: 'dc2c900e2ba9767c314ea92afa324e18d178b26105dd406af0d0a961e780cfeece5a31a64f3174ae8a7cf44383873c4dd5ba0524a20b6fdf2db319d5efd685affd7a1b4380d8bfae023880444f7729a565de71', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })
// hashSetList.push({ hash: 'b2', votePower: 1, hashSet: 'dc2c900e2ba9767c314ea92afa324e18d178b26105dd406af0d0a961e780cfeece5aa64f3174ae8a7cf44383873c4dd5ba0524a20b6fdf2db319d5efd685affd7a1b4380d8bfae023880444f77a565de71', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })

// test 21z   9002
// hashSetList.push({ hash: 'b4', votePower: 2, hashSet: 'dc2c900e2ba9767c314ea92afa324e18d178b26105dd406af0d0a961e780cfeece5a31a64f3174ae8a7cf44383873c4dd5ba0524a20b6fdf2db319d5efd685affd7a1b4380d8bfae023880444f7729a565de71', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })
// hashSetList.push({ hash: 'b1', votePower: 2, hashSet: 'dc2c900ea9767c314ea92afa324e18d178b26105dd406af0d0a961e780cfeece5a31a64f3174ae8a7cf44383873c4dd5ba0524a20b6fdf2db319d5efd685affd7a1b4380d8bfae023880444f7729a565de71', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })
// hashSetList.push({ hash: 'b2', votePower: 1, hashSet: 'dc2c900e2ba9767c314ea92afa324e18d178b26105dd406af0d0a961e780cfeece5aa64f3174ae8a7cf44383873c4dd5ba0524a20b6fdf2db319d5efd685affd7a1b4380d8bfae023880444f77a565de71', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })

// 20z indexing off in the weeds!
hashSetList.push({ hash: 'b4', votePower: 1, hashSet: '7af3e6627339818bf9e30d51ba43303e9da62495dfb5408ccd5059944271553a5a327cd6932a8ab3c59d2a0300a3f71ebffef7acd6292671ec4bb3cf626c8bf01e2566125decfa56306895e0cdd23f4de6b6d385a6a332fc25b1a8449dac2a4c54394fd4528b6ceba77d5083db65f5f9e8868019ff121fa26c9ed8a7f5c63062af3c6e5fdbbec8c3664b76a2ac625ce3136dda21fe8009a5150b370c0fb032328c1f53e652a225abb7a5f8d3a49be5dae0335f495c4c208a9c56349a42ca4844', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })
// hashSetList.push({ hash: 'b1', votePower: 1, hashSet: '7af3e6627339818bf9e30d51ba43303e9da62495dfb5408ccd5059944271553a5a327cd6932a8ab3c59d2a0300a3f71ebffef7ac29267170ec4bb3cf626c8bf01e2566125decfa56306895e0cdd23f4de6b6d385a6a332fc25b1a8449dac2a4c54394fd441528b6ceba77d5083db65f5f9e8868019ff121fa26caf9ed8a7f5c63062af3c6e5fc7db0dbec8c3664b76a2ac625ce3136dda21fe8009a50b370c0fb032328c1f53e652a225abb7a5f8d3a49be5dae0335f495c4c208a9c56349a42ca4844', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })
// hashSetList.push({ hash: 'b2', votePower: 1, hashSet: '7af3e6627339818bf9e30d51ba43303e9da62495dfb5408ccd5059944271553a5a327cd6932a8ab3c59d2a0300a3f71ebffef7acd629267170ec4bb3cf626c8bf01e2566125decfa56306895e0cd3f4de6b6d385a6a332fc25b1a8449dac2a4c54394fd441528b6ceba77d5083db65f5f9e8868019ff121fa26caf9ed8a7f5c63062af3c6e5fc7db0dbec8c3664b76a2ac625ce3136dda21fe8009a5150b370c0fb032328c1f53e652a225abb7a5f8d3a49be5dae0335f495c4c208a9c56349a42ca4844', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })
// hashSetList.push({ hash: 'b3', votePower: 1, hashSet: '7af3e6627339818bf9e30d51ba43303e9da62495dfb5408ccd5059944271553a5a327cd6932a8ab3c59d2a0300a3f71ebffef7acd629267170ec4bb3cf626c8bf01e2566125decfa56306895e0cdd23f4de6b6d385a6a332fc25b1a8449dac2a4c54394fd441528b6ceba77d5083db65f5f9e8868019ff121fa26caf9ed8a7f5c63062af3c6e5fc7db0dbec8c3664b76a2ac625ce3136dda21fe8009a5150b370c0fb032328c1f53e652a225abb7a5f8d3a49be5da335f495c4c208a9c56349a42ca4844', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })
// hashSetList.push({ hash: 'b5', votePower: 1, hashSet: '7ae6627339818bf9e30d51ba43303e9da62495dfb5408ccd5059944271553a5a327cd6932a8ab3c59d2a0300a3f71ebffef7acd629267170ec4bb3cf626c8bf02566125decfa56306895e0cdd23f4de6d385a6a332fc25b1a8449dac2a4c54394fd441528b6ceba77d5083db65f5f9e8868019ff121fa26caf9ed8a7f5c63062af3c6e5fc7db0dbec8c3664b76a2ac625ce3136dda21fe8009a5150b370c0fb032328c1f53e652a225abb7a5f8d3a49be5dae05f495c4c208a9c569a42ca4844', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })
hashSetList.push({ hash: 'forced', votePower: 1000, hashSet: '7af3e6627339818bf9e30d51ba43303e9da62495dfb5408ccd5059944271553a5a327cd6932a8ab3c59d2a0300a3f71ebffef7acd629267170ec4bb3cf626c8bf01e2566125decfa56306895e0cdd23f4de6b6d385a6a332fc25b1a8449dac2a4c54394fd441528b6ceba77d5083db65f5f9e8868019ff121fa26caf9ed8a7f5c63062af3c6e5fc7db0dbec8c3664b76a2ac625ce3136dda21fe8009a50b370c0fb032328c1f53e652a225abb7a5f8d3a49be5dae0335f495c4c208a9c56349a42ca4844', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })

let output = StateManager.solveHashSets(hashSetList)

hashSetList2.push({ hash: 'b4', votePower: 1, hashSet: '7af3e6627339818bf9e30d51ba43303e9da62495dfb5408ccd5059944271553a5a327cd6932a8ab3c59d2a0300a3f71ebffef7acd6292671ec4bb3cf626c8bf01e2566125decfa56306895e0cdd23f4de6b6d385a6a332fc25b1a8449dac2a4c54394fd4528b6ceba77d5083db65f5f9e8868019ff121fa26c9ed8a7f5c63062af3c6e5fdbbec8c3664b76a2ac625ce3136dda21fe8009a5150b370c0fb032328c1f53e652a225abb7a5f8d3a49be5dae0335f495c4c208a9c56349a42ca4844', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })
hashSetList2.push({ hash: 'forced', votePower: 1000, hashSet: '7af3e6627339818bf9e30d51ba43303e9da62495dfb5408ccd5059944271553a5a327cd6932a8ab3c59d2a0300a3f71ebffef7acd629267170ec4bb3cf626c8bf01e2566125decfa56306895e0cdd23f4de6b6d385a6a332fc25b1a8449dac2a4c54394fd441528b6ceba77d5083db65f5f9e8868019ff121fa26caf9ed8a7f5c63062af3c6e5fc7db0dbec8c3664b76a2ac625ce3136dda21fe8009a50b370c0fb032328c1f53e652a225abb7a5f8d3a49be5dae0335f495c4c208a9c56349a42ca4844', lastValue: '', errorStack: [], corrections: [], indexOffset: 0 })

let output2 = StateManager.solveHashSets(hashSetList2, 10, 0.625, output)

// StateManager.solveHashSets(hashSetList)

for (let hashSetEntry of hashSetList) {
  console.log(JSON.stringify(hashSetEntry))
}

console.log(JSON.stringify(output))

StateManager.expandIndexMapping(hashSetList[0], output)
StateManager.expandIndexMapping(hashSetList2[0], output)

console.log(JSON.stringify(hashSetList2[0].indexMap))
console.log(JSON.stringify(hashSetList2[0].extraMap))

let hashSet = ''
for (let hash of output) {
  hashSet += hash
}
console.log('solution:  ' + (hashSet.length / 2) + ' ' + hashSet)
let hashSet2 = ''
for (let hash of output2) {
  hashSet2 += hash
}
console.log('solution2: ' + (hashSet2.length / 2) + ' ' + hashSet2)
