export default function getCallstack(): string {
  const e = new Error('Artificially induced error to get a call stack');
  return e.stack;
}
