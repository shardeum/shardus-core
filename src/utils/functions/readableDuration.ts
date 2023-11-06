import { shardusGetTime } from '../../network'

/**
 * Returns a string in the format 'HH:MM:SS.mmm' representing the duration between the given start and end times.
 * @param startTime The start time in milliseconds (shardusGetTime()).
 * @param endTime The end time in milliseconds. If not provided, the current time will be used.
 */
export function readableDuration(startTime: number, endTime: number | undefined = undefined): string {
  if (endTime === undefined) endTime = shardusGetTime()
  let difference = endTime - startTime
  const hours = Math.floor(difference / (1000 * 60 * 60))
  difference -= hours * 1000 * 60 * 60
  const minutes = Math.floor(difference / (1000 * 60))
  difference -= minutes * 1000 * 60
  const seconds = Math.floor(difference / 1000)
  difference -= seconds * 1000
  const milliseconds = difference
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(
    2,
    '0'
  )}.${String(milliseconds).padStart(3, '0')}`
}
