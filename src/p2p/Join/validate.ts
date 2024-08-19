import { version } from '../../../package.json'
import { logFlags } from '../../logger'
import { hexstring, P2P } from '@shardus/types'
import * as utils from '../../utils'
import { isEqualOrNewerVersion } from '../../utils'
import { config } from '../Context'
import * as CycleChain from '../CycleChain'
import * as NodeList from '../NodeList'
import { isBogonIP, isInvalidIP, isIPv6 } from '../../utils/functions/checkIP'
import { nestedCountersInstance } from '../../utils/nestedCounters'
import { Utils } from '@shardus/types'
import { JoinRequestResponse } from './types'
import { info, warn } from './logging'
import { getAllowBogon, getSeen } from './state'

/**
 * Returns a `JoinRequestResponse` object if the given `joinRequest` is invalid or rejected for any reason.
 */
export function validateJoinRequest(joinRequest: P2P.JoinTypes.JoinRequest): JoinRequestResponse | null {
  // perform validation. if any of these functions return a non-null value,
  // validation fails and the join request is rejected
  return (
    verifyJoinRequestTypes(joinRequest) ||
    validateVersion(joinRequest.version) ||
    verifyJoinRequestSigner(joinRequest) ||
    verifyNotIPv6(joinRequest.nodeInfo.externalIp) ||
    validateJoinRequestHost(joinRequest.nodeInfo.externalIp) ||
    verifyUnseen(joinRequest.nodeInfo.publicKey) ||
    verifyNodeUnknown(joinRequest.nodeInfo) ||
    validateJoinRequestTimestamp(joinRequest.nodeInfo.joinRequestTimestamp) ||
    null
  )
}

export const BOGON_NOT_ACCEPTED_ERROR = {
  success: false,
  reason: `Bad ip, bogon ip not accepted`,
  fatal: true,
}
export const RESERVED_IP_REJECTED_ERROR = {
  success: false,
  reason: `Bad ip, reserved ip not accepted`,
  fatal: true,
}
/**
 * Returns an error response if the given `externalIp` is invalid or rejected.
 */
export function validateJoinRequestHost(externalIp: string): JoinRequestResponse | null {
  try {
    //test or bogon IPs and reject the join request if they appear
    if (!getAllowBogon()) {
      if (isBogonIP(externalIp)) {
        /* prettier-ignore */ if (logFlags.p2pNonFatal) warn('Got join request from Bogon IP')
        nestedCountersInstance.countEvent('p2p', `join-reject-bogon`)
        return BOGON_NOT_ACCEPTED_ERROR
      }
    } else {
      //even if not checking bogon still reject other invalid IPs that would be unusable
      if (isInvalidIP(externalIp)) {
        /* prettier-ignore */ if (logFlags.p2pNonFatal) warn('Got join request from invalid reserved IP')
        nestedCountersInstance.countEvent('p2p', `join-reject-reserved`)
        return RESERVED_IP_REJECTED_ERROR
      }
    }
  } catch (er) {
    nestedCountersInstance.countEvent('p2p', `join-reject-bogon-ex:${er}`)
    return {
      success: false,
      reason: `Error in checking IP: ${er}`,
      fatal: true,
    }
  }

  return null
}

export const BAD_STRUCTURE_ERROR = {
  success: false,
  reason: `Bad join request object structure`,
  fatal: true,
}
export const BAD_NODE_INFO_STRUCTURE_ERROR = {
  success: false,
  reason: 'Bad nodeInfo object structure within join request',
  fatal: true,
}
export const BAD_SIGNATURE_STRUCTURE_ERROR = {
  success: false,
  reason: 'Bad signature object structure within join request',
  fatal: true,
}
/**
 * This function is a little weird because it was taken directly from
 * `addJoinRequest`, but here's how it works:
 *
 * It validates the types of the `joinRequest`. If the types are invalid, it
 * returns a `JoinRequestResponse` object with `success` set to `false` and
 * `fatal` set to `true`. The `reason` field will contain a message describing
 * the validation error.
 *
 * If the types are valid, it returns `null`.
 */
export function verifyJoinRequestTypes(joinRequest: P2P.JoinTypes.JoinRequest): JoinRequestResponse | null {
  // Validate joinReq
  let err = utils.validateTypes(joinRequest, {
    cycleMarker: 's',
    nodeInfo: 'o',
    sign: 'o',
    version: 's',
  })
  if (err) {
    /* prettier-ignore */ if (logFlags.p2pNonFatal) warn('join bad joinRequest ' + err)
    return BAD_STRUCTURE_ERROR
  }
  err = utils.validateTypes(joinRequest.nodeInfo, {
    activeTimestamp: 'n',
    address: 's',
    externalIp: 's',
    externalPort: 'n',
    internalIp: 's',
    internalPort: 'n',
    joinRequestTimestamp: 'n',
    publicKey: 's',
  })
  if (err) {
    /* prettier-ignore */ if (logFlags.p2pNonFatal) warn('join bad joinRequest.nodeInfo ' + err)
    return BAD_NODE_INFO_STRUCTURE_ERROR
  }
  err = utils.validateTypes(joinRequest.sign, { owner: 's', sig: 's' })
  if (err) {
    /* prettier-ignore */ if (logFlags.p2pNonFatal) warn('join bad joinRequest.sign ' + err)
    return BAD_SIGNATURE_STRUCTURE_ERROR
  }

  return null
}

export const ALREADY_KNOWN_PK_ERROR = {
  success: false,
  reason: 'Cannot add join request for this node, already a known node (by public key).',
  fatal: false,
}
export const ALREADY_KNOWN_IP_ERROR = {
  success: false,
  reason: 'Cannot add join request for this node, already a known node (by IP address).',
  fatal: true,
}
/**
 * Makes sure that the given `nodeInfo` is not already known to the network.
 * If it is, it returns a `JoinRequestResponse` object with `success` set to
 * `false` and `fatal` set to `true`. The `reason` field will contain a message
 * describing the validation error.
 *
 * If the `nodeInfo` is not already known to the network, it returns `null`.
 */
export function verifyNodeUnknown(nodeInfo: P2P.P2PTypes.P2PNode): JoinRequestResponse | null {
  if (NodeList.getByPubKeyMap().has(nodeInfo.publicKey)) {
    /* prettier-ignore */ if (logFlags.p2pNonFatal) warn(ALREADY_KNOWN_PK_ERROR.reason)
    return ALREADY_KNOWN_PK_ERROR
  }
  const ipPort = NodeList.ipPort(nodeInfo.internalIp, nodeInfo.internalPort)
  if (NodeList.getByIpPortMap().has(ipPort)) {
    /* prettier-ignore */ if (logFlags.p2pNonFatal) info(ALREADY_KNOWN_IP_ERROR.reason, Utils.safeStringify(NodeList.getByIpPortMap().get(ipPort)))
    if (logFlags.p2pNonFatal) nestedCountersInstance.countEvent('p2p', `join-skip-already-known`)
    return ALREADY_KNOWN_IP_ERROR
  }

  return null
}

export const IPV6_ERROR = {
  success: false,
  reason: `Bad ip version, IPv6 are not accepted`,
  fatal: true,
}
/**
 * Makes sure that the given `externalIp` is not an IPv6 address. If it
 * is, it returns a `JoinRequestResponse` object with `success` set to `false`
 * and `fatal` set to `true`. The `reason` field will contain a message
 * describing the validation error.
 *
 * If the `externalIp` is not an IPv6 address, it returns `null`.
 */
export function verifyNotIPv6(externalIp: string): JoinRequestResponse | null {
  if (isIPv6(externalIp)) {
    /* prettier-ignore */ if (logFlags.p2pNonFatal) warn('Got join request from IPv6')
    nestedCountersInstance.countEvent('p2p', `join-reject-ipv6`)
    return IPV6_ERROR
  }
  return null
}

export const BAD_VERSION_ERROR = {
  success: false,
  reason: `Old shardus core version, please satisfy at least ${version}`,
  fatal: true,
}
/**
 * Makes sure that the given `joinRequestVersion` is not older than the
 * current version of the node. If it is, it returns a `JoinRequestResponse`
 * object with `success` set to `false` and `fatal` set to `true`. The `reason`
 * field will contain a message describing the validation error.
 *
 * If the `joinRequestVersion` is not older than the current version of the
 * node, it returns `null`.
 */
export function validateVersion(joinRequestVersion: string): JoinRequestResponse | null {
  if (config.p2p.checkVersion && !isEqualOrNewerVersion(version, joinRequestVersion)) {
    /* prettier-ignore */ warn(`version number is old. Our node version is ${version}. Join request node version is ${joinRequestVersion}`)
    nestedCountersInstance.countEvent('p2p', `join-reject-version ${joinRequestVersion}`)
    return BAD_VERSION_ERROR
  } else return null
}

export const BAD_SIGNATURE_ERROR = {
  success: false,
  reason: 'Bad signature, sign owner and node attempted joining mismatched',
  fatal: true,
}
/**
 * Makes sure that the given `joinRequest` is signed by the node that is
 * attempting to join. If it is not, it returns a `JoinRequestResponse` object
 * with `success` set to `false` and `fatal` set to `true`. The `reason` field
 * will contain a message describing the validation error.
 *
 * If the `joinRequest` is signed by the node that is attempting to join, it
 * returns `null`.
 */
export function verifyJoinRequestSigner(joinRequest: P2P.JoinTypes.JoinRequest): JoinRequestResponse | null {
  //If the node that signed the request is not the same as the node that is joining
  if (joinRequest.sign.owner != joinRequest.nodeInfo.publicKey) {
    /* prettier-ignore */ warn(`join-reject owner != publicKey ${{ sign: joinRequest.sign.owner, info: joinRequest.nodeInfo.publicKey }}`)
    nestedCountersInstance.countEvent('p2p', `join-reject owner != publicKey`)
    return BAD_SIGNATURE_ERROR
  }

  return null
}

export const ALREADY_SEEN_ERROR = {
  success: false,
  reason: 'Node has already been seen this cycle. Unable to add join request.',
  fatal: false,
}
/**
 * Makes sure that the given `joinRequest`'s node  has not already been seen this
 * cycle. If it has, it returns a `JoinRequestResponse` object with `success`
 * set to `false` and `fatal` set to `false`. The `reason` field will contain a
 * message describing the validation error.
 *
 * If the `joinRequest`'s node has not already been seen this cycle, it returns
 * `null`.
 */
export function verifyUnseen(publicKey: hexstring): JoinRequestResponse | null {
  // Check if this node has already been seen this cycle
  if (getSeen().has(publicKey)) {
    if (logFlags.p2pNonFatal) nestedCountersInstance.countEvent('p2p', `join-skip-seen-pubkey`)
    if (logFlags.p2pNonFatal) info(ALREADY_SEEN_ERROR.reason)
    return ALREADY_SEEN_ERROR
  }

  // Mark node as seen for this cycle
  getSeen().add(publicKey)

  return null
}

export const EARLY_TIMESTAMP_ERROR = {
  success: false,
  reason: 'Cannot add join request for this node, timestamp is earlier than allowed cycle range',
  fatal: false,
}
export const LATE_TIMESTAMP_ERROR = {
  success: false,
  reason: 'Cannot add join request, timestamp exceeds allowed cycle range',
  fatal: false,
}
function validateJoinRequestTimestamp(joinRequestTimestamp: number): JoinRequestResponse | null {
  //TODO - figure out why joinRequest is send with previous cycle marker instead of current cycle marker
  /*
   CONTEXT: when node create join request the cycleMarker is (current - 1).
   The reason join request didn't use current cycleMarker is most likely the the current cycle is potential not agreed upon yet.
   but the joinRequestTimestamp is Date.now
   so checking if the timestamp is within its cycleMarker is gurantee to fail
   let request cycle marker be X, then X+1 is current cycle, then we check if the timestamp is in the current cycleMarker
  */
  // const cycleThisJoinRequestBelong = CycleChain.cyclesByMarker[joinRequest.cycleMarker]
  // const cycleStartedAt = cycleThisJoinRequestBelong.start
  // const cycleWillEndsAt = cycleStartedAt + cycleDuration
  const cycleDuration = CycleChain.newest.duration
  const cycleStarts = CycleChain.newest.start
  const requestValidUpperBound = cycleStarts + cycleDuration
  const requestValidLowerBound = cycleStarts - cycleDuration

  if (joinRequestTimestamp < requestValidLowerBound) {
    nestedCountersInstance.countEvent('p2p', `join-skip-timestamp-not-meet-lowerbound`)
    /* prettier-ignore */ if (logFlags.p2pNonFatal) warn(EARLY_TIMESTAMP_ERROR.reason)
    return EARLY_TIMESTAMP_ERROR
  }

  if (joinRequestTimestamp > requestValidUpperBound) {
    nestedCountersInstance.countEvent('p2p', `join-skip-timestamp-beyond-upperbound`)
    /* prettier-ignore */ if (logFlags.p2pNonFatal) warn('Cannot add join request for this node, its timestamp exceeds allowed cycle range')
    return LATE_TIMESTAMP_ERROR
  }
}
