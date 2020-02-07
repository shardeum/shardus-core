"use strict";
const su = require('../../tools/server-start-utils')({
    baseDir: '../..',
    verbose: true
});
async function main() {
    su.startServer(9001, 10001, null, { server: { reporting: { report: false } } }, false);
}
main();
//# sourceMappingURL=1-node-test.js.map