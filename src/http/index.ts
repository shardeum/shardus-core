import { parse as parseUrl } from 'url'
import got from 'got'
import { logFlags } from '../logger'
import { safeParser, safeStringify, stringifyReduceLimit } from '../utils'

let _logger = null
let getIndex = 1
let postIndex = -1
const httpResLogLength = 5000

function _containsProtocol(url: string) {
  if (!url.match('https?://*')) return false
  return true
}

function _normalizeUrl(url: string) {
  let normalized = url
  if (!_containsProtocol(url)) normalized = 'http://' + url
  return normalized
}

async function _get(host, logIndex, timeout = 1000) {
  try {
    const res = await got.get(host, {
      timeout: timeout, //  Omar - setting this to 1 sec
      retry: 0, // Omar - setting this to 0.
      json: true,
    })
    return { ...res, body: safeParser(safeStringify(res.body)) }
  } catch (error) {
    if (logFlags.playback === false && logFlags.verbose === false) {
      throw error
    }
    // log and then throw error
    logError('post', error, host, logIndex)
  }
}

/*
  Queries the given host for a JSON payload
  Returns a promise, resolves parsed JSON response
*/
async function get<T>(url: string, getResponseObj = false, timeout = 1000): Promise<T> {
  let normalized = _normalizeUrl(url)
  let host = parseUrl(normalized, true)

  getIndex++

  const localIndex = getIndex
  if (_logger) {
    /* prettier-ignore */ if (logFlags.playback) _logger.playbackLog('self', host.hostname + ':' + host.port, 'HttpRequest', host.pathname, localIndex, '')
  }

  let res = await _get(host, localIndex, timeout)

  if (_logger) {
    /* prettier-ignore */ if (logFlags.playback) _logger.playbackLog( host.hostname + ':' + host.port, 'self', 'HttpResponseRecv', host.pathname, localIndex, stringifyReduceLimit(res.body, 1000) + '  res:: ' + stringifyReduceLimit(res, httpResLogLength) )
  }

  if (getResponseObj) {
    //@ts-ignore
    return res
  }
  return res.body
}

async function _post(host, payload, logIndex, timeout = 1000) {
  try {
    const res = await got.post(host, {
      timeout: timeout, // Omar - set this to 1 sec
      retry: 0, // Omar - set this to 0
      json: true,
      body: payload,
    })

    //if (getResponseObj) return res
    //return res.body
    return { ...res, body: safeParser(safeStringify(res.body)) }
  } catch (error) {
    if (logFlags.playback === false && logFlags.verbose === false) {
      throw error
    }
    // log and then throw error
    logError('post', error, host, logIndex)
  }
}

/*
  Posts a JSON payload to a given host
  Returns a promise, resolves parsed JSON response if successful, rejects on error
*/
async function post(givenHost, body, getResponseObj = false, timeout = 1000) {
  let normalized = _normalizeUrl(givenHost)
  let host = parseUrl(normalized, true)

  postIndex--
  const localIndex = postIndex
  if (_logger) {
    /* prettier-ignore */ if (logFlags.playback) _logger.playbackLog( 'self', host.hostname + ':' + host.port, 'HttpRequest', host.pathname, localIndex, body )
  }

  let res = await _post(host, body, localIndex, timeout)

  if (_logger) {
    /* prettier-ignore */ if (logFlags.playback) _logger.playbackLog( host.hostname + ':' + host.port, 'self', 'HttpResponseRecv', host.pathname, localIndex, stringifyReduceLimit(res.body, 1000) + '  res:: ' + stringifyReduceLimit(res, httpResLogLength) )
  }

  if (getResponseObj) return res
  return res.body
}

function logError(method: string, error: any, host: any, logIndex: any) {
  if (error.code === 'ETIMEDOUT') {
    /* prettier-ignore */ if (logFlags.verbose) console.error(`${method}: HTTP request timed out:`, error)
    if (_logger) {
      /* prettier-ignore */ if (logFlags.playback) _logger.playbackLog(host.hostname + ':' + host.port, 'self', 'HttpResponseRecv-timeout', host.pathname, logIndex, JSON.stringify(error))
    }
    throw error
  } else if (error.response && error.response.statusCode === 400) {
    /* prettier-ignore */ if (logFlags.verbose) console.error(`${method}: Bad Request:`, error.message, ' ', error)
    if (_logger) {
      /* prettier-ignore */ if (logFlags.playback) _logger.playbackLog(host.hostname + ':' + host.port, 'self', 'HttpResponseRecv-400', host.pathname, logIndex, JSON.stringify(error))
    }
    throw error
  } else {
    // Handle other errors
    /* prettier-ignore */ if (logFlags.verbose) console.error(`${method}: An unexpected error occurred:`, error)
    if (_logger) {
      /* prettier-ignore */ if (logFlags.playback) _logger.playbackLog(host.hostname + ':' + host.port, 'self', 'HttpResponseRecv-err', host.pathname, logIndex, JSON.stringify(error))
    }
    throw error
  }
}

function buildGotErrorDescription(error) {
  let description = 'Got error: '

  // Check if the error has a code and include it in the description
  if (error.code) {
    description += `[Code: ${error.code}] `
  }

  // Check if the error has a response and statusCode
  if (error.response && error.response.statusCode) {
    description += `[Status Code: ${error.response.statusCode}] `
  }

  // Check if the error has a message and include it
  if (error.message) {
    description += error.message
  }

  return description
}

function setLogger(logger) {
  _logger = logger
}

export { get, post, setLogger }
