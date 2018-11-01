const parseUrl = require('url').parse
const http = require('http')
const https = require('https')

function _containsProtocol (url) {
  if (!url.match('https?://*')) return false
  return true
}

function _normalizeUrl (url) {
  let normalized = url
  if (!_containsProtocol(url)) normalized = 'http://' + url
  return normalized
}

function _checkHttps (url) {
  if (!url.match('https://*')) return false
  return true
}

function _getHttp (url) {
  return new Promise((resolve, reject) => {
    let req = http.get(url, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        let parsed
        try {
          // console.log(data)
          parsed = JSON.parse(data)
        } catch (e) {
          reject(e)
        }
        resolve(parsed)
      })
    })
    req.on('error', (e) => {
      reject(e)
    })
  })
}

function _getHttps (url) {
  return new Promise((resolve, reject) => {
    let req = https.get(url, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        let parsed
        try {
          console.log(data)
          parsed = JSON.parse(data)
        } catch (e) {
          reject(e)
        }
        resolve(parsed)
      })
    })
    req.on('error', (e) => {
      reject(e)
    })
  })
}

/*
  Queries the given host for a JSON payload
  Returns a promise, resolves parsed JSON response
*/
async function get (url) {
  let normalized = _normalizeUrl(url)
  let host = parseUrl(normalized, true)
  let res
  if (!_checkHttps(normalized)) {
    res = await _getHttp(host)
    return res
  }
  res = await _getHttps(host)
  return res
}

function _postHttp (options, payload) {
  return new Promise((resolve, reject) => {
    let req = http.request(options, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        let parsed
        try {
          console.log(data)
          parsed = JSON.parse(data)
        } catch (e) {
          reject(e)
        }
        resolve(parsed)
      })
    })
    req.on('error', (e) => {
      reject(e)
    })
    if (payload) {
      try {
        req.write(payload)
      } catch (e) {
        console.error(e.message)
      }
    }
    req.end()
  })
}

function _postHttps (options, payload) {
  return new Promise((resolve, reject) => {
    let req = https.request(options, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        let parsed
        try {
          console.log(data)
          parsed = JSON.parse(data)
        } catch (e) {
          reject(e)
        }
        resolve(parsed)
      })
    })
    req.on('error', (e) => {
      reject(e)
    })
    if (payload) {
      try {
        req.write(payload)
      } catch (e) {
        console.error(e.message)
      }
    }
    req.end()
  })
}

/*
  Posts a JSON payload to a given host
  Returns a promise, resolves parsed JSON response if successful, rejects on error
*/
async function post (givenHost, body) {
  let normalized = _normalizeUrl(givenHost)
  let host = parseUrl(normalized, true)
  let payload = body ? JSON.stringify(body) : null
  let options = {
    hostname: host.hostname,
    port: host.port || 80,
    path: host.path || '/',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': payload ? Buffer.byteLength(payload) : '0'
    }
  }

  let res
  if (!_checkHttps(normalized)) {
    res = await _postHttp(options, payload)
    return res
  }
  res = await _postHttps(options, payload)
  return res
}

exports.get = get
exports.post = post
