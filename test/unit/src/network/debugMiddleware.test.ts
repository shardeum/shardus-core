import * as Context from '../../../../src/p2p/Context'
import { getDevPublicKeys, isDebugMode, ensureKeySecurity } from '../../../../src/debug/index'
import {
  isDebugModeMiddlewareLow,
  isDebugModeMiddlewareMedium,
  isDebugModeMiddlewareHigh,
  isDebugModeMiddlewareMultiSig,
} from '../../../../src/network/debugMiddleware'
import SERVER_CONFIG from '../../../../src/config/server'

const RESPONSE = {
  UNAUTHORIZED: { message: 'Unauthorized!', status: 401 },
  FORBIDDEN: { message: 'FORBIDDEN!', status: 403 },
}

jest.mock('@shardus/crypto-utils', () => ({
  verify: jest.fn(() => true),
  hashObj: jest.fn(() => 'hash'),
}))
jest.mock('../../../../src/debug')
jest.mock('../../../../src/network', () => ({
  shardusGetTime: jest.fn(() => Date.now()),
}))

const mockCrypto = {
  verify: jest.fn(),
}

describe('Debug Middleware', () => {
  let req, res, next

  beforeEach(() => {
    req = {
      query: {
        sig: JSON.stringify([
          { owner: 'publicKey1', sig: '0x0' },
          { owner: 'publicKey2', sig: '0x1' },
        ]),
        sig_counter: String(Date.now()),
        proposal: JSON.stringify({ noOfApprovals: 2, securityClearance: 'low' }),
      },
      route: { path: '/test' },
    }
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    }
    next = jest.fn()
    ;(isDebugMode as jest.Mock).mockReturnValue(false)
    ;(getDevPublicKeys as jest.Mock).mockReturnValue({ pubKey1: 'publicKey1' })
    Object.defineProperty(Context, 'crypto', {
      value: mockCrypto,
      writable: true,
    })
    ;(Context.crypto.verify as jest.Mock).mockReturnValue(true)
    ;(ensureKeySecurity as jest.Mock).mockReturnValue(true)
    SERVER_CONFIG.debug.minApprovalsMultiAuth = 2
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('isDebugModeMiddlewareLow', () => {
    it('should authorize valid request with Low security level', () => {
      isDebugModeMiddlewareLow(req, res, next)

      expect(next).toHaveBeenCalled()
    })

    it('should reject invalid signature for Low security level', () => {
      ;(Context.crypto.verify as jest.Mock).mockReturnValue(false)

      isDebugModeMiddlewareLow(req, res, next)

      expect(res.status).toHaveBeenCalledWith(RESPONSE.UNAUTHORIZED.status)
      expect(res.json).toHaveBeenCalledWith({
        status: RESPONSE.UNAUTHORIZED.status,
        message: RESPONSE.UNAUTHORIZED.message,
      })
    })

    it('should reject unauthorized security level for Low security level', () => {
      ;(ensureKeySecurity as jest.Mock).mockReturnValue(false)

      isDebugModeMiddlewareLow(req, res, next)

      expect(res.status).toHaveBeenCalledWith(RESPONSE.FORBIDDEN.status)
      expect(res.json).toHaveBeenCalledWith({
        status: RESPONSE.FORBIDDEN.status,
        message: RESPONSE.FORBIDDEN.message,
      })
    })

    it('should call next if in debug mode', () => {
      ;(isDebugMode as jest.Mock).mockReturnValue(true)

      isDebugModeMiddlewareLow(req, res, next)

      expect(next).toHaveBeenCalled()
    })
  })

  describe('isDebugModeMiddlewareMedium', () => {
    it('should authorize valid request with Medium security level', () => {
      isDebugModeMiddlewareMedium(req, res, next)

      expect(next).toHaveBeenCalled()
    })

    it('should reject invalid signature for Medium security level', () => {
      ;(Context.crypto.verify as jest.Mock).mockReturnValue(false)

      isDebugModeMiddlewareMedium(req, res, next)

      expect(res.status).toHaveBeenCalledWith(RESPONSE.UNAUTHORIZED.status)
      expect(res.json).toHaveBeenCalledWith({
        status: RESPONSE.UNAUTHORIZED.status,
        message: RESPONSE.UNAUTHORIZED.message,
      })
    })

    it('should reject unauthorized security level for Medium security level', () => {
      ;(ensureKeySecurity as jest.Mock).mockReturnValue(false)

      isDebugModeMiddlewareMedium(req, res, next)

      expect(res.status).toHaveBeenCalledWith(RESPONSE.FORBIDDEN.status)
      expect(res.json).toHaveBeenCalledWith({
        status: RESPONSE.FORBIDDEN.status,
        message: RESPONSE.FORBIDDEN.message,
      })
    })

    it('should call next if in debug mode', () => {
      ;(isDebugMode as jest.Mock).mockReturnValue(true)

      isDebugModeMiddlewareMedium(req, res, next)

      expect(next).toHaveBeenCalled()
    })
  })

  describe('isDebugModeMiddlewareHigh', () => {
    it('should authorize valid request with High security level', () => {
      isDebugModeMiddlewareHigh(req, res, next)

      expect(next).toHaveBeenCalled()
    })

    it('should reject invalid signature for High security level', () => {
      ;(Context.crypto.verify as jest.Mock).mockReturnValue(false)

      isDebugModeMiddlewareHigh(req, res, next)

      expect(res.status).toHaveBeenCalledWith(RESPONSE.UNAUTHORIZED.status)
      expect(res.json).toHaveBeenCalledWith({
        status: RESPONSE.UNAUTHORIZED.status,
        message: RESPONSE.UNAUTHORIZED.message,
      })
    })

    it('should reject unauthorized security level for High security level', () => {
      ;(ensureKeySecurity as jest.Mock).mockReturnValue(false)

      isDebugModeMiddlewareHigh(req, res, next)

      expect(res.status).toHaveBeenCalledWith(RESPONSE.FORBIDDEN.status)
      expect(res.json).toHaveBeenCalledWith({
        status: RESPONSE.FORBIDDEN.status,
        message: RESPONSE.FORBIDDEN.message,
      })
    })

    it('should call next if in debug mode', () => {
      ;(isDebugMode as jest.Mock).mockReturnValue(true)

      isDebugModeMiddlewareHigh(req, res, next)

      expect(next).toHaveBeenCalled()
    })
  })
  describe('isDebugModeMiddlewareMultiSig', () => {
    it('should authorize valid multi-signature request', () => {
      isDebugModeMiddlewareMultiSig(req, res, next)

      expect(next).toHaveBeenCalled()
    })

    it('should reject if not enough approvals', () => {
      SERVER_CONFIG.debug.minApprovalsMultiAuth = 3
      isDebugModeMiddlewareMultiSig(req, res, next)

      expect(res.status).toHaveBeenCalledWith(RESPONSE.UNAUTHORIZED.status)
      expect(res.json).toHaveBeenCalledWith({
        status: RESPONSE.UNAUTHORIZED.status,
        message: RESPONSE.UNAUTHORIZED.message,
      })
    })

    it('should reject invalid signature in multi-signature', () => {
      ;(Context.crypto.verify as jest.Mock).mockReturnValue(false)
      isDebugModeMiddlewareMultiSig(req, res, next)

      expect(res.status).toHaveBeenCalledWith(RESPONSE.FORBIDDEN.status)
      expect(res.json).toHaveBeenCalledWith({
        status: RESPONSE.FORBIDDEN.status,
        message: 'FORBIDDEN. Endpoint is only available in debug mode.',
      })
    })

    it('should call next if in debug mode', () => {
      ;(isDebugMode as jest.Mock).mockReturnValue(true)
      isDebugModeMiddlewareMultiSig(req, res, next)

      expect(next).toHaveBeenCalled()
    })
  })
})
