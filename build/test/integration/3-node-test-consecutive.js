"use strict";
const su = require('../../tools/server-start-utils')({
    baseDir: '../..',
    verbose: true
});
async function main() {
    await su.startServer(9001, 10001, 'active', null, false);
    console.log();
    await su.startServer(9002, 10002, 'active', null, false);
    console.log();
    await su.startServer(9003, 10003, 'active', null, false);
}
main()
    .finally(() => {
    su.stopAllServers();
});
//# sourceMappingURL=3-node-test-consecutive.js.map