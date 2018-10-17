const Qn = require('shardus-quic-net')

module.exports = (localPort, localAddress) => {
  // both args must be passed in
  if (!localPort) throw new Error('Fatal: network module requires localPort')
  if (!localAddress) throw new Error('Fatal: network module requires localAddress')

  // instantiate the shardus quic net library
  const qn = Qn({
    port: localPort,
    address: localAddress
  })

  // ATTOW this is just a (very, very) thin wrapper around the shardus
  // quic net library. Once more is required from the network module,
  // more can / will be added.
  return qn
}
