import { parse as parseUrl } from 'url'
import got from 'got'

let _logger = null
let getIndex = 1
let postIndex = -1

function _containsProtocol(url: string) {
  if (!url.match('https?://*')) return false
  return true
}

function _normalizeUrl(url: string) {
  let normalized = url
  if (!_containsProtocol(url)) normalized = 'http://' + url
  return normalized
}

async function _get(url, getResponseObj = false) {
  const res = await got.get(url, {
    timeout: 1000,   //  Omar - setting this to 1 sec
    retry: 0,   // Omar - setting this to 0.
    json: true,
  })
  if (getResponseObj) return res
  return res.body
}

/*
  Queries the given host for a JSON payload
  Returns a promise, resolves parsed JSON response
*/
async function get(url: string, getResponseObj = false) {
  let normalized = _normalizeUrl(url)
  let host = parseUrl(normalized, true)

  if (_logger) {
    _logger.playbackLog(
      'self',
      host.hostname + ':' + host.port,
      'HttpRequest',
      host.pathname,
      getIndex,
      ''
    )
  }

  let res = await _get(host, getResponseObj)

  if (_logger) {
    _logger.playbackLog(
      host.hostname + ':' + host.port,
      'self',
      'HttpResponseRecv',
      host.pathname,
      getIndex,
      res
    )
  }

  getIndex++
  return res
}

async function _post(host, payload, getResponseObj = false) {
  const res = await got.post(host, {
    timeout: 1000,   // Omar - set this to 1 sec
    retry: 0,   // Omar - set this to 0
    json: true,
    body: payload,
  })
  if (getResponseObj) return res
  return res.body
}

/*
  Posts a JSON payload to a given host
  Returns a promise, resolves parsed JSON response if successful, rejects on error
*/
async function post(givenHost, body, getResponseObj = false) {
  let normalized = _normalizeUrl(givenHost)
  let host = parseUrl(normalized, true)
  if (_logger) {
    _logger.playbackLog(
      'self',
      host.hostname + ':' + host.port,
      'HttpRequest',
      host.pathname,
      postIndex,
      body
    )
  }

  let res = await _post(host, body, getResponseObj)

  if (_logger) {
    _logger.playbackLog(
      host.hostname + ':' + host.port,
      'self',
      'HttpResponseRecv',
      host.pathname,
      postIndex,
      res
    )
  }

  postIndex--
  return res
}

function setLogger(logger) {
  _logger = logger
}

export { get, post, setLogger }
