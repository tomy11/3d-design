import { draw, makeCylinder, setOC } from 'replicad'
import initCascade from 'replicad-opencascadejs'
import cascadeWasm from 'replicad-opencascadejs/wasm?url'
import { validateAdapter } from './adapter-spec'
import { clipToAxis, validateTrace } from './trace-spec'

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
    return await output(action, solid)
  } finally {
    solid.delete()
  }
}

async function output(action, solid) {
  if (action === 'step') return await solid.blobSTEP().text()
  const { vertices, normals, triangles } = solid.mesh({ tolerance: 0.035, angularTolerance: 0.15 })
  return { positions: Float32Array.from(vertices, (value) => value / 1000), normals: Float32Array.from(normals), indices: Uint32Array.from(triangles) }
}

function outline(points) {
  const pen = draw(points[0])
  for (const point of points.slice(1)) pen.lineTo(point)
  return pen.close()
}

// Replaces solid with solid <op> tool and frees both inputs.
function combine(solid, tool, op) {
  if (!solid) return tool
  try {
    const next = solid[op](tool)
    solid.delete()
    return next
  } finally {
    tool.delete()
  }
}

export async function runTrace(action, spec) {
  const error = validateTrace(spec)
  if (error) throw new Error(error)
  await init()
  const { mode, thickness, axis } = spec
  const body = (points, through) => mode === 'extrude'
    ? outline(points).sketchOnPlane('XY', through ? -1 : 0).extrude(thickness + (through ? 2 : 0))
    : outline(points).sketchOnPlane('XY').revolve([0, 1, 0], { origin: [0, 0, 0] })
  const profile = (points) => mode === 'extrude' ? points : clipToAxis(points, axis)
  let solid = null
  try {
    for (const region of spec.regions) {
      const outer = profile(region.outer)
      if (outer.length < 3) continue
      let part = body(outer, false)
      for (const hole of region.holes) {
        const cut = profile(hole)
        if (cut.length >= 3) part = combine(part, body(cut, true), 'cut')
      }
      solid = combine(solid, part, 'fuse')
    }
    if (!solid) throw new Error('Nothing of the outline lies on the right of the revolve axis.')
    return await output(action, solid)
  } finally {
    solid?.delete()
  }
}
