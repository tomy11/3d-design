// A traced CAD profile in millimetres. views maps front/right/top to regions:
// [{ outer: loop, holes: [loop] }], where a loop is { points: [[x, y], ...] } or { circle: [cx, cy, r] }.
// A traced circle may also carry diameter: a size in mm typed by the user, kept when the scale changes.
// In single-view extrude, a hole may have depth (a blind hole or pocket from the front face) and a
// region its own height; edge rounds or bevels the edges of the front faces.
// mode 'extrude' extrudes the front view to thickness along Z; 'revolve' spins the front view
// right of axis around Y (the image vertical); 'views' intersects the views extruded through the part.
export const traceLimits = { width: [0.1, 5000], thickness: [0.2, 1000], edge: [0.1, 100], points: 2000, loops: 200 }
export const edgeKinds = ['none', 'fillet', 'chamfer']

const finite = (value) => Number.isFinite(value) && Math.abs(value) <= 10000
const point = (item) => Array.isArray(item) && item.length === 2 && item.every(finite)
const optionalSize = (value) => value === undefined || (finite(value) && value > 0)

export function validLoop(loop) {
  if (loop?.circle) {
    return Array.isArray(loop.circle) && loop.circle.length === 3 && loop.circle.every(finite) && loop.circle[2] > 0 &&
      optionalSize(loop.diameter) && optionalSize(loop.depth)
  }
  return optionalSize(loop?.depth) && Array.isArray(loop?.points) && loop.points.length >= 3 && loop.points.length <= traceLimits.points && loop.points.every(point)
}

export const validRegions = (regions) => Array.isArray(regions) &&
  regions.every((region) => validLoop(region?.outer) && optionalSize(region.height) && Array.isArray(region.holes) && region.holes.every(validLoop))

export function validEdge(edge) {
  return edge === undefined || (edgeKinds.includes(edge?.kind) && finite(edge.size) &&
    edge.size >= traceLimits.edge[0] && edge.size <= traceLimits.edge[1])
}

export function validateTrace(spec) {
  if (!spec || !['extrude', 'revolve', 'views'].includes(spec.mode)) return 'Choose extrude or revolve.'
  const [minThickness, maxThickness] = traceLimits.thickness
  if (spec.mode === 'extrude' && !(spec.thickness >= minThickness && spec.thickness <= maxThickness)) {
    return 'Thickness must be between ' + minThickness + ' and ' + maxThickness + ' mm.'
  }
  if (spec.mode === 'revolve' && !finite(spec.axis)) return 'The revolve axis is not valid.'
  if (!validEdge(spec.edge)) return 'Edge rounding must be between ' + traceLimits.edge[0] + ' and ' + traceLimits.edge[1] + ' mm.'
  const views = Object.entries(spec.views ?? {})
  if (!views.length || !spec.views.front?.length) return 'Trace a front view outline before building a solid.'
  if (!views.every(([name, regions]) => ['front', 'right', 'top'].includes(name) && regions.length && validRegions(regions))) {
    return 'The traced outline is not valid.'
  }
  const loops = views.reduce((count, [, regions]) => count + regions.reduce((n, region) => n + 1 + region.holes.length, 0), 0)
  if (loops > traceLimits.loops) return 'The trace has too many separate outlines. Raise "Ignore specks" or simplify the image.'
  return null
}

// Keeps the part of a polygon at x >= axis, shifted so the axis sits at x = 0.
export function clipToAxis(points, axis) {
  const result = []
  for (let index = 0; index < points.length; index++) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    const currentIn = current[0] >= axis
    const nextIn = next[0] >= axis
    if (currentIn) result.push(current)
    if (currentIn !== nextIn) {
      const t = (axis - current[0]) / (next[0] - current[0])
      result.push([axis, current[1] + t * (next[1] - current[1])])
    }
  }
  const shifted = result.map(([x, y]) => [x - axis, y])
  return shifted.filter((item, index) => {
    const previous = shifted[(index - 1 + shifted.length) % shifted.length]
    return Math.hypot(item[0] - previous[0], item[1] - previous[1]) > 1e-6
  })
}
