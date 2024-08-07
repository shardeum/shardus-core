/**
 * Simple script for adding / prettier-ignore / to instrumentation lines
 */

const replace = require('replace-in-file');
const prettierConfig = require('./prettier.config');

const PRINT_WIDTH = prettierConfig.printWidth;

const prettierIgnore = '/* prettier-ignore */ ';

// Including leading whitespace
const instrumentationLines = [
  /\s+nestedCountersInstance.countEvent.+/g,
  /\s+nestedCountersInstance.countRareEvent.+/g,
  /\s+stateManager.statemanager_fatal.+/g,
  /\s+if\s*\(\s*logFlags.+/g,
];

const options = {
  files: 'src/**/*.ts',
  from: instrumentationLines,
  to: (match) => {
    const numColumns = match.length;
    const shortLine = numColumns < PRINT_WIDTH;
    const alreadyHasPrettierIgnore = match.includes('prettier-ignore');

    if (shortLine || alreadyHasPrettierIgnore) {
      return match;
    }

    const firstNonWhitespaceIndex = match.search(/\S/);

    // Insert / prettier-ignore / after the whitespace but before the line content
    const updatedLine = [
      match.slice(0, firstNonWhitespaceIndex),
      prettierIgnore,
      match.slice(firstNonWhitespaceIndex),
    ].join('');

    return updatedLine;
  },
};

const main = async () => {
  const results = await replace(options);
  console.log('Replacement results:', results);
};

main().catch((err) => {
  console.error('An error occured: ', err);
});
