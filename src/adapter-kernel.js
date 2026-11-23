import { makeCylinder, setOC } from 'replicad'
import initCascade from 'replicad-opencascadejs'
import cascadeWasm from 'replicad-opencascadejs/wasm?url'
import { validateAdapter } from './adapter-spec'

let startup
function init() {
  startup ??= initCascade({ locateFile: () => cascadeWasm })
    .then(setOC)
    .catch((error) => { startup = undefined; throw error })
  return startup
}

export async function runAdapter(action, dimensions) {
  const error = validateAdapter(dimensions)
  if (error) throw new Error(error)
  await init()
  const { diameter, thickness, bore, pitch, hole, count } = dimensions
  let solid = makeCylinder(diameter / 2, thickness)
  try {
    const holes = [[0, 0, bore / 2]]
    for (let index = 0; index < count; index++) {
      const angle = 2 * Math.PI * index / count
      holes.push([pitch / 2 * Math.cos(angle), pitch / 2 * Math.sin(angle), hole / 2])
    }
    for (const [x, y, radius] of holes) {
      const tool = makeCylinder(radius, thickness + 2, [x, y, -1])
      try {
        const next = solid.cut(tool)
        solid.delete()
        solid = next
      } finally {
        tool.delete()
      }
    }
    if (action === 'step') return await solid.blobSTEP().text()
    const { vertices, normals, triangles } = solid.mesh({ tolerance: 0.035, angularTolerance: 0.15 })
    return { positions: Float32Array.from(vertices, (value) => value / 1000), normals: Float32Array.from(normals), indices: Uint32Array.from(triangles) }
  } finally {
    solid.delete()
  }
}
