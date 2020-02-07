"use strict";
const su = require('../../tools/server-start-utils')({
    baseDir: '../..',
    verbose: true,
    nodeUpTimeout: 120000
});
async function main() {
    await su.startServers(3, 9001, 10001, 'active');
}
main();
// .finally(() => {
//   su.stopAllServers()
// })
//# sourceMappingURL=3-node-test-simultaneous.js.map