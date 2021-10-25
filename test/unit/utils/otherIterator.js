N = 1200; // Size of array

for(let k=1; k< 10000; k++){
    var rep = new Map()
    N = k
    randomIteratorInit_Don(N)
    for(i=0;i<N;i++){
      r = randomIterator_Don();
      //console.log(i, r)
      if (rep.has(r)){ 
        throw Error('repeat-don')
      }
      rep.set(r, 1)
    }    

    if((N % 1000) === 0){
      console.log(`Don tests up to ${N}`)
    }   
}


console.log('Don tests passed ')



var Size = 0
var Replace = new Map()

function randomIteratorInit_Don(size){
  Replace = new Map()
  Size = size
}

function randomIterator_Don(){
  var i, r, last
  if (Size == 0){ return -1 }
  r = Math.floor(Math.random() * Size)
  i = r
  Size -= 1
  if (Replace.has(r)){
    r = Replace.get(r)
  }
  last = Size
  if (Replace.has(last)){ last = Replace.get(last) }
  Replace.set(i, last)
  return r
}


//////////////////////////////////
function isPrime(num) {
  let sq_root = Math.sqrt(num);
  for(let i = 2; i <= sq_root; i++) {
      if (num % i == 0) {
          return 0;
      }
  }
  return 1;
}
let largerPrime = new Map()
function primeLargerThan(num) {
  let input = num

  if(largerPrime.has(input)){
      return largerPrime.get(input)
  }

  do {
      num++;    // you want to find a prime number greater than the argument  
  } while (!isPrime(num)) 
  largerPrime.set(input, num) 
  return num
}

//Prime iterator breaks on size 1!
for(let testSize = 2; testSize < 10000; testSize++){

  perfTestArraySize = testSize
  sampleTestSize = testSize
  PrimeNumberIterator()
  
  if((testSize % 1000) === 0){
    console.log(`prime tests up to ${testSize}`)
  }

}
console.log('Prime tests passed ')


function PrimeNumberIterator(){
  //this only activates sparse some of the time.. 
  let arraySize = perfTestArraySize
  let P = primeLargerThan(arraySize)
  let N = perfTestArraySize
  m = 8; // multiplier 1 to N-1
  t = 5; // offset  0 to N-1

  let nextIndex = 0
  let sum = 0
  let seen = new Set()
  for(let i=0; i<sampleTestSize; i++){
      //for(i=0;i<N;i++){
          r = i;
          do{
              r = (m*r + t)%P;
          } while(r >= N);
          //console.log(i, r);
      //}
      if(seen.has(r)){
        throw Error('repeat-prime')
      }
      seen.add(r)
      nextIndex = r
      sum += nextIndex
  }

}


