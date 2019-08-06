const parseUrl = require('url').parse
const got = require('got')

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

async function _get (url) {
  const { body } = await got.get(url, {
    timeout: 10000,
    retry: 3,
    json: true
  })
  return body
}

/*
  Queries the given host for a JSON payload
  Returns a promise, resolves parsed JSON response
*/
async function get (url) {
  let normalized = _normalizeUrl(url)
  let host = parseUrl(normalized, true)

  if (_logger) {
    _logger.playbackLog('self', host.hostname + ':' + host.port, 'HttpRequest', host.pathname, getIndex, '')
  }

  let res = await _get(host)

  if (_logger) {
    _logger.playbackLog(host.hostname + ':' + host.port, 'self', 'HttpResponseRecv', host.pathname, getIndex, res)
  }

  getIndex++
  return res
}

async function _post (host, payload) {
  const { body } = await got.post(host, {
    timeout: 10000,
    retry: 3,
    json: true,
    body: payload
  })
  return body
}

/*
  Posts a JSON payload to a given host
  Returns a promise, resolves parsed JSON response if successful, rejects on error
*/
async function post (givenHost, body) {
  let normalized = _normalizeUrl(givenHost)
  let host = parseUrl(normalized, true)
  if (_logger) {
    _logger.playbackLog('self', host.hostname + ':' + host.port, 'HttpRequest', host.pathname, postIndex, body)
  }

  let res = await _post(host, body)

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
