export function isIPv6(ip: string) {
  const slicedArr = ip.split(':')
  if (slicedArr.length !== 8) return false

  for (let str of slicedArr) {
    // Check if string is a valid regex
    const hexRegex = /^[0-9A-Fa-f]+$/
    if (str.length < 0 || str.length > 4) return false
    if (str.match(hexRegex) == null) return false
  }

  return true
}

export function isBogonIP(ip) {
  const ipArr = getIpArr(ip)
  return isPrivateIP(ipArr) || isReservedIP(ipArr)
}

function getIpArr(ip: string) {
  const slicedArr = ip.split('.')
  if (slicedArr.length !== 4) {
    throw new Error('Invalid IP address provided')
  }

  for (let number of slicedArr) {
    const num = Number(number)
    if (num.toString() !== number) {
      throw new Error('Leading zero detected. Invalid IP address')
    }
    if (num < 0 || num > 255) {
      throw new Error('Invalid IP address provided')
    }
  }

  return slicedArr
}

function isPrivateIP(ip) {
  return (
    // 10.0.0.0/8  Private-use networks
    ip[0] === 10 ||
    // 100.64.0.0/10 Carrier-grade NAT
    (ip[0] === 100 && ip[1] >= 64 && ip[1] <= 127) ||
    // 127.0.0.0/8 Loopback + Name collision occurrence (127.0.53.53)
    ip[0] === 127 ||
    // 169.254.0.0/16  Link local
    (ip[0] === 169 && ip[1] === 254) ||
    // 172.16.0.0/12 Private-use networks
    (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31) ||
    // 192.168.0.0/16  Private-use networks
    (ip[0] === 192 && ip[1] === 168)
  )
}

function isReservedIP(ip) {
  return (
    // 0.0.0.0/8 "This" network
    ip[0] === 0 ||
    // 192.0.0.0/24  IETF protocol assignments
    (ip[0] === 192 && ip[1] === 0 && ip[2] === 0) ||
    // 192.0.2.0/24  TEST-NET-1
    (ip[0] === 192 && ip[1] === 0 && ip[2] === 2) ||
    // 198.18.0.0/15 Network interconnect device benchmark testing
    (ip[0] === 198 && ip[1] >= 18 && ip[1] <= 19) ||
    // 198.51.100.0/24 TEST-NET-2
    (ip[0] === 198 && ip[1] === 51 && ip[2] === 100) ||
    // 203.0.113.0/24  TEST-NET-3
    (ip[0] === 203 && ip[1] === 0 && ip[2] === 113) ||
    // 224.0.0.0/4 Multicast
    (ip[0] >= 224 && ip[0] <= 239) ||
    // 240.0.0.0/4 Reserved for future use
    ip[0] >= 240 ||
    // 255.255.255.255/32
    (ip[0] === 255 && ip[1] === 255 && ip[2] === 255 && ip[3] === 255)
  )
}
