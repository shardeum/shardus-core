const parseUrl = require('url').parse
const http = require('http')
const https = require('https')

let _logger = null
let getIndex = 1
let postIndex = -1

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

function _get (url, isHttps) {
  const module = isHttps ? https : http
  return new Promise((resolve, reject) => {
    let req = module.get(url, (res) => {
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

/*
  Queries the given host for a JSON payload
  Returns a promise, resolves parsed JSON response
*/
async function get (url) {
  let normalized = _normalizeUrl(url)
  let host = parseUrl(normalized, true)
  let isHttps = _checkHttps(normalized)

  if (_logger) {
    _logger.playbackLog('self', host.hostname + ':' + host.port, 'HttpRequest', host.pathname, getIndex, '')
  }

  let res = await _get(host, isHttps)

  if (_logger) {
    _logger.playbackLog(host.hostname + ':' + host.port, 'self', 'HttpResponseRecv', host.pathname, getIndex, res)
  }

  getIndex++
  return res
}

function _post (options, payload, isHttps) {
  const module = isHttps ? https : http
  return new Promise((resolve, reject) => {
    let req = module.request(options, (res) => {
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

  if (_logger) {
    _logger.playbackLog('self', host.hostname + ':' + host.port, 'HttpRequest', host.pathname, postIndex, body)
  }

  let isHttps = _checkHttps(normalized)
  let res = await _post(options, payload, isHttps)

  if (_logger) {
    _logger.playbackLog(host.hostname + ':' + host.port, 'self', 'HttpResponseRecv', host.pathname, postIndex, res)
  }

  postIndex--
  return res
}

function setLogger (logger) {
  _logger = logger
}

exports.get = get
exports.post = post
exports.setLogger = setLogger
