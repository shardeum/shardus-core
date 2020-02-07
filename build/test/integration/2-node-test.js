"use strict";
const su = require('../../tools/server-start-utils')({
    baseDir: '../..',
    verbose: true
});
async function main() {
    su.startServers(2, null, null, 'id', null, false);
}
main();
//# sourceMappingURL=2-node-test.js.map