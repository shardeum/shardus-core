const deepmerge = require('deepmerge')

const joinRequests = [{ "curvePk": "8f80e288ce9485982e3de7d668e17b56e02be6817068e9ca5fd11e82230cf731", "ip": "194.195.220.150", "port": 4000, "publicKey": "2db7c949632d26b87d7e7a5a4ad41c306f63ee972655121a37c5e4f52b00a542" }, { "curvePk": "8c866344011d92c5b1711b82d655b04e9f2b3d5f009b291ed7cfe9aa4f233214", "ip": "45.79.113.106", "port": 4000, "publicKey": "6860b9c7264e106594d4330f98b07a73b2b511dc09f39a5a9c56467322a28f4c" }, { "curvePk": "443e381c9ab423da9450dc4326e6c3a55424924bf14e26d9c4a4ff2c2c7d4973", "ip": "45.79.113.106", "port": 4000, "publicKey": "7af699dd711074eb96a8d1103e32b589e511613ebb0c6a789a9e8791b2b05f34" }, { "curvePk": "aac4dc4bb42ee191b23d46a390ff0c76e85ed43a96fe9c28f3cf286c7498eb48", "ip": "194.195.220.150", "port": 4000, "publicKey": "9dc43a9bc2b7f12168faae17837462d30686e20dbac896f8c78b5fc524a982fc" }]
const leaveRequests = [{ "curvePk": "8f80e288ce9485982e3de7d668e17b56e02be6817068e9ca5fd11e82230cf731", "ip": "194.195.220.150", "port": 4000, "publicKey": "2db7c949632d26b87d7e7a5a4ad41c306f63ee972655121a37c5e4f52b00a542" }, { "curvePk": "443e381c9ab423da9450dc4326e6c3a55424924bf14e26d9c4a4ff2c2c7d4973", "ip": "45.79.113.106", "port": 4000, "publicKey": "7af699dd711074eb96a8d1103e32b589e511613ebb0c6a789a9e8791b2b05f34" }]
const requestsCopy = deepmerge({}, [...joinRequests, ...leaveRequests])

console.log(requestsCopy)
