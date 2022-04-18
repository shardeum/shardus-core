import { isDebugMode, getHashedDevKey, getDevPublicKey } from '../debug'

import * as Context from '../p2p/Context'

let lastCounter = 0

export const isDebugModeMiddleware = (_req, res, next) => {
  const isDebug = isDebugMode()

  if (!isDebug) {


    try{
      //auth with by checking a password against a hash
      if(_req.query.auth != null){
        const hashedAuth = Context.crypto.hash({key:_req.query.auth})
        const hashedDevKey = getHashedDevKey()
        // can get a hash back if no key is set
        if(hashedDevKey === ""){
          return res.json({hashedAuth})
        }
        if(hashedAuth === hashedDevKey){
          next()
          return
        }
      }
      //auth my by checking a signature
      if(_req.query.sig != null && _req.query.sig_counter != null){
        const ownerPk = getDevPublicKey()
        let requestSig = _req.query.sig
        //check if counter is valid
        let sigObj = {route: _req.route, count:_req.query.sig_counter, sign: {owner:ownerPk,sig:requestSig } }
        
        //reguire a larger counter than before.
        if(sigObj.count > lastCounter){
          let verified = Context.crypto.verify(sigObj,  ownerPk)
          if(verified === true){
            //update counter so we can't use it again 
            lastCounter = sigObj.count
            next()
            return
          }
        }
      }
    } catch(error){

    }
    return res.status(403).json({
      status: 403,
      message: 'FORBIDDEN. Endpoint is only available in debug mode.'
    })
  }

  next()
}
