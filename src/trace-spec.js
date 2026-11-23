// A traced CAD profile in millimetres: regions of an outer loop plus holes, made solid
// by extruding along Z or by revolving the right-hand side of the axis around Y (the image vertical).
export const traceLimits = { width: [1, 2000], thickness: [0.2, 1000], points: 2000, loops: 200 }

const finite = (value) => Number.isFinite(value) && Math.abs(value) <= 5000
const loop = (points) => Array.isArray(points) && points.length >= 3 && points.length <= traceLimits.points &&
  points.every((point) => Array.isArray(point) && point.length === 2 && point.every(finite))

export function validateTrace(spec) {
  if (!spec || !['extrude', 'revolve'].includes(spec.mode)) return 'Choose extrude or revolve.'
  const [minThickness, maxThickness] = traceLimits.thickness
  if (spec.mode === 'extrude' && !(spec.thickness >= minThickness && spec.thickness <= maxThickness)) {
    return 'Thickness must be between ' + minThickness + ' and ' + maxThickness + ' mm.'
  }
  if (spec.mode === 'revolve' && !finite(spec.axis)) return 'The revolve axis is not valid.'
  if (!Array.isArray(spec.regions) || !spec.regions.length) return 'Trace an outline before building a solid.'
  const loops = spec.regions.reduce((count, region) => count + 1 + (region?.holes?.length ?? 0), 0)
  if (loops > traceLimits.loops) return 'The trace has too many separate outlines. Raise "Ignore specks" or simplify the image.'
  if (!spec.regions.every((region) => loop(region?.outer) && Array.isArray(region.holes) && region.holes.every(loop))) {
    return 'The traced outline is not valid.'
  }
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
  return shifted.filter((point, index) => {
    const previous = shifted[(index - 1 + shifted.length) % shifted.length]
    return Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 1e-6
  })
}
