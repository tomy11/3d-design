import { draw, drawCircle, makeCylinder, setOC } from 'replicad'
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

// A loop is { points } or a true circle { circle: [cx, cy, r] }.
function drawLoop(loop) {
  return loop.circle ? drawCircle(loop.circle[2]).translate(loop.circle[0], loop.circle[1]) : outline(loop.points)
}

function polygonOf(loop) {
  if (!loop.circle) return loop.points
  const [cx, cy, r] = loop.circle
  return Array.from({ length: 96 }, (_, index) => {
    const angle = index / 96 * Math.PI * 2
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)]
  })
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

// Each region is extruded from z0 for depth, with its holes cut clean through.
// With blind set (single-view extrude), a region may have its own height and a hole its own
// depth, both measured from the front face, which faces the viewer at the top of the region.
function extrudeRegions(regions, z0, depth, blind = false) {
  let solid = null
  for (const region of regions) {
    const height = blind && region.height ? region.height : depth
    let part = drawLoop(region.outer).sketchOnPlane('XY', z0).extrude(height)
    for (const hole of region.holes) {
      // A blind cut starts its depth below the front face; a through cut overshoots both faces by 1 mm.
      const tool = blind && hole.depth && hole.depth < height
        ? drawLoop(hole).sketchOnPlane('XY', z0 + height - hole.depth).extrude(hole.depth + 1)
        : drawLoop(hole).sketchOnPlane('XY', z0 - 1).extrude(height + 2)
      part = combine(part, tool, 'cut')
    }
    solid = combine(solid, part, 'fuse')
  }
  return solid
}

// Rounds or bevels every edge lying on a front face.
function finishEdges(solid, regions, thickness, edge) {
  if (!edge || edge.kind === 'none') return solid
  const fronts = [...new Set(regions.map((region) => region.height || thickness))]
  const filter = (finder) => finder.either(fronts.map((z) => (f) => f.inPlane('XY', z)))
  try {
    const next = edge.kind === 'fillet' ? solid.fillet(edge.size, filter) : solid.chamfer(edge.size, filter)
    solid.delete()
    return next
  } catch {
    throw new Error('The ' + (edge.kind === 'fillet' ? 'rounding' : 'chamfer') + ' of ' + edge.size + ' mm does not fit this outline. Try a smaller size.')
  }
}

// Image axes of each view: front looks along -Z, right along -X, top along -Y.
const viewTurns = { front: null, right: [90, [0, 1, 0]], top: [-90, [1, 0, 0]] }

function revolveRegions(regions, axis) {
  let solid = null
  const body = (points) => outline(points).sketchOnPlane('XY').revolve([0, 1, 0], { origin: [0, 0, 0] })
  for (const region of regions) {
    const outer = clipToAxis(polygonOf(region.outer), axis)
    if (outer.length < 3) continue
    let part = body(outer)
    for (const hole of region.holes) {
      const cut = clipToAxis(polygonOf(hole), axis)
      if (cut.length >= 3) part = combine(part, body(cut), 'cut')
    }
    solid = combine(solid, part, 'fuse')
  }
  if (!solid) throw new Error('Nothing of the outline lies on the right of the revolve axis.')
  return solid
}

function extent(regions) {
  let largest = 0
  for (const { outer } of regions) {
    for (const [x, y] of polygonOf(outer)) largest = Math.max(largest, Math.abs(x), Math.abs(y))
  }
  return largest
}

export async function runTrace(action, spec) {
  const error = validateTrace(spec)
  if (error) throw new Error(error)
  await init()
  let solid = null
  try {
    if (spec.mode === 'revolve') solid = revolveRegions(spec.views.front, spec.axis)
    else if (spec.mode === 'extrude') {
      solid = extrudeRegions(spec.views.front, 0, spec.thickness, true)
      solid = finishEdges(solid, spec.views.front, spec.thickness, spec.edge)
    }
    else {
      // Every view is extruded through the whole part, and the solid is what all of them share.
      const reach = Math.max(...Object.values(spec.views).map(extent)) + 5
      for (const [name, regions] of Object.entries(spec.views)) {
        let block = extrudeRegions(regions, -reach, reach * 2)
        if (viewTurns[name]) block = block.rotate(viewTurns[name][0], [0, 0, 0], viewTurns[name][1])
        solid = combine(solid, block, 'intersect')
      }
    }
    if (!solid) throw new Error('The traced outline produced no solid.')
    return await output(action, solid)
  } finally {
    solid?.delete()
  }
}
