"use strict";
const su = require('../../tools/server-start-utils')({
    baseDir: '../..',
    verbose: true,
    nodeUpTimeout: 120000
});
async function main() {
    for (let i = 1; i < 21; i++) {
        await su.startServer(9000 + i, 10000 + i, 'active');
        console.log();
    }
}
main();
//# sourceMappingURL=20-node-test.js.map