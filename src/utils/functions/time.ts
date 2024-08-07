import { shardusGetTime } from '../../network';

export const sleep = (ms): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

/** Be very careful this uses shardusGetTime() the timetamp passed in must repect this */
export const getTime = (format = 'ms'): number => {
  let time;
  switch (format) {
    case 'ms':
      time = shardusGetTime();
      break;
    case 's':
      time = Math.floor(shardusGetTime() / 1000);
      break;
    default:
      throw Error('Error: Invalid format given.');
  }
  return time;
};

/** Be very careful this uses shardusGetTime() the timetamp passed in must repect this */
export const setAlarm = (callback, timestamp): void => {
  const now = shardusGetTime();
  if (timestamp <= now) {
    callback();
    return;
  }
  const toWait = timestamp - now;
  setTimeout(callback, toWait);
};

export function inRangeOfCurrentTime(timestamp: number, before: number, after: number): boolean {
  const currentTime = shardusGetTime();
  if (timestamp - currentTime <= after) {
    if (currentTime - timestamp <= before) {
      return true;
    }
  }
  return false;
}
