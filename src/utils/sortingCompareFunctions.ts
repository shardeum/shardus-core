export const sortAsc = (a, b) => {
  return a === b ? 0 : a < b ? -1 : 1
}

export const sortDec = (a, b) => {
  return a === b ? 0 : a > b ? -1 : 1
}

export const sort_i_Asc = (a, b) => {
  return a.i === b.i ? 0 : a.i < b.i ? -1 : 1
}

export const sort_id_Asc = (a, b) => {
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1
}

export const sortHashAsc = (a, b) => {
  return a.hash === b.hash ? 0 : a.hash < b.hash ? -1 : 1
}

export const sortTimestampAsc = (a, b) => {
  return a.timestamp === b.timestamp ? 0 : a.timestamp < b.timestamp ? -1 : 1
}

export const sortAscProp = (a, b, propName) => {
  const aVal = a[propName]
  const bVal = b[propName]
  return aVal === bVal ? 0 : aVal < bVal ? -1 : 1
}

export const sortDecProp = (a, b, propName) => {
  const aVal = a[propName]
  const bVal = b[propName]
  return aVal === bVal ? 0 : aVal > bVal ? -1 : 1
}
