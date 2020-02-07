"use strict";
const su = require('../../tools/server-start-utils')({
    baseDir: '../..',
    verbose: true,
    nodeUpTimeout: 720000
});
async function main() {
    await su.startServers(20, 9001, 10001);
}
main();
//# sourceMappingURL=20-node-test-simultaneous.js.map