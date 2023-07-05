import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

export const readJSON = <T>(filename): T => {
  const file = readFileSync(filename).toString()
  const config = JSON.parse(file)
  return config
}

export const readJSONDir = (dir): Record<string, unknown> => {
  // => filesObj
  const filesObj = {}
  readdirSync(dir).forEach((fileName) => {
    const name = fileName.split('.')[0]
    // eslint-disable-next-line security/detect-object-injection
    filesObj[name] = readJSON(join(dir, fileName))
  })
  return filesObj
}
