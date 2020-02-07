"use strict";
const su = require('../../tools/server-start-utils')({
    baseDir: '../..',
    verbose: true
});
let totalNodes = 30;
async function main() {
    let i = 0;
    let startInterval = setInterval(() => {
        su.startServer(9000 + i, 8000 + i, null, 'id', null, false);
        i += 1;
        if (i > totalNodes)
            clearInterval(startInterval);
    }, 5000);
}
main();
//# sourceMappingURL=monitor-test.js.map