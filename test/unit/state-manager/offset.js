


const utils = require('../../../dist/utils/functions/general')



let cycleOffset = 0


// function fastIsPicked(ourIndex, groupSize, numToPick, offset=0){
//     let isPicked = false
//     let fstride = groupSize / numToPick
//     let finalOffset = ourIndex + offset
//     let steps = finalOffset / fstride
//     steps = Math.round(steps)
//     let fendPoint = steps * fstride
//     let endpoint = Math.round(fendPoint)
//     if(endpoint === finalOffset) {
//       isPicked = true
//     }
//     return isPicked
// }


function runSimulation(numActiveNodes, numToPick, cycleOffset){
    let output = []
    for(let i=0; i<numActiveNodes; i++ ){
        if(utils.fastIsPicked(i, numActiveNodes, numToPick, cycleOffset)){
            output.push(i)
        }
    }
    console.log(`pick ${numToPick} from ${numActiveNodes} len:${output.length}`)
    console.log(`${JSON.stringify(output)}`)
}



for(let i=0; i<5; i++){
    cycleOffset = i
    runSimulation(1337, 30, cycleOffset + 5301)
}

