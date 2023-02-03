// Inspiration from https://github.com/sindresorhus/is-port-reachable/blob/main/index.js

import net from 'node:net'

/**
 * Checks if a port at a given host can be reached
 * @returns boolean
 */
export const isPortReachable = async ({
  host,
  port,
  timeout = 1000,
}: {
  host: string
  port: number
  timeout?: number
}) => {
  const promise = new Promise<void>((resolve, reject) => {
    const socket = new net.Socket()

    const onError = () => {
      socket.destroy()
      reject()
    }

    socket.setTimeout(timeout)
    socket.once('error', onError)
    socket.once('timeout', onError)

    socket.connect(port, host, () => {
      socket.end()
      resolve()
    })
  })

  try {
    await promise
    return true
  } catch {
    return false
  }
}
