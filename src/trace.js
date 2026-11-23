// Image-to-outline tracing. Everything here works in image pixels (x right, y down)
// until toMillimetres converts the traced regions into a CAD profile.

// A traced loop is either { points: [[x, y], ...] } or a true circle { circle: [cx, cy, r] }.
// A circle the user placed or sized also has diameter in mm, which wins over its pixel radius.
// Regions are [{ outer: loop, holes: [loop, ...] }].

// Photos and drawings are reduced to 720 px; mesh silhouettes are sharp, so they keep 1600 px.
export const maxTraceSize = 720
export const meshTraceSize = 1600
export const viewNames = ['front', 'right', 'top']
export const viewLabels = { front: 'Front', right: 'Right', top: 'Top' }
export const defaultTraceSettings = { threshold: 128, invert: false, useAlpha: false, tolerance: 1.2, minArea: 40, circles: true }

export async function loadTraceImage(file, name = file.name, { maxSize = maxTraceSize, lossless = false } = {}) {
  if (!file.type.startsWith('image/')) throw new Error('Choose a PNG, JPEG, WebP or other image file.')
  const bitmap = await createImageBitmap(file)
  return imageFromSource(bitmap, bitmap.width, bitmap.height, name, { maxSize, lossless })
}

// Draws any canvas image source into a trace image, reduced to maxSize.
function imageFromSource(source, sourceWidth, sourceHeight, name, { maxSize, lossless, url: keepUrl }) {
  const scale = Math.min(1, maxSize / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(source, 0, 0, width, height)
  source.close?.()
  const pixels = context.getImageData(0, 0, width, height)
  const analysis = analyse(pixels)
  // Kept small enough to embed in a project file: PNG only when transparency or sharp edges matter.
  const url = keepUrl ?? (analysis.hasAlpha || lossless ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.9))
  return { name, width, height, url, ...analysis }
}

export function imageFromCanvas(canvas, name) {
  return imageFromSource(canvas, canvas.width, canvas.height, name, { maxSize: maxTraceSize })
}

// Reopens an image saved in a project at its saved size, so traced pixel positions still match.
export async function imageFromDataUrl(url, name) {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob())
  return imageFromSource(bitmap, bitmap.width, bitmap.height, name, { maxSize: Math.max(bitmap.width, bitmap.height), url })
}

// Lightly blurred brightness and alpha, plus an automatic threshold.
function analyse({ data, width, height }) {
  const raw = new Float32Array(width * height)
  const alpha = new Uint8Array(width * height)
  let transparent = 0
  for (let index = 0; index < raw.length; index++) {
    const offset = index * 4
    alpha[index] = data[offset + 3]
    if (alpha[index] < 128) transparent++
    // Transparent pixels count as white background.
    const a = data[offset + 3] / 255
    const luminance = 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]
    raw[index] = luminance * a + 255 * (1 - a)
  }
  const brightness = new Uint8Array(raw.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      let count = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          sum += raw[ny * width + nx]
          count++
        }
      }
      brightness[y * width + x] = Math.round(sum / count)
    }
  }
  return { brightness, alpha, hasAlpha: transparent > raw.length * 0.02, autoThreshold: otsu(brightness) }
}

function otsu(values) {
  const histogram = new Float64Array(256)
  for (const value of values) histogram[value]++
  let total = 0
  for (let level = 0; level < 256; level++) total += level * histogram[level]
  let background = 0
  let backgroundSum = 0
  let best = 128
  let bestVariance = -1
  for (let level = 0; level < 256; level++) {
    background += histogram[level]
    if (!background) continue
    const foreground = values.length - background
    if (!foreground) break
    backgroundSum += level * histogram[level]
    const meanBackground = backgroundSum / background
    const meanForeground = (total - backgroundSum) / foreground
    const variance = background * foreground * (meanBackground - meanForeground) ** 2
    if (variance > bestVariance) {
      bestVariance = variance
      best = level
    }
  }
  return best
}

// Solid pixels are darker than the threshold, or opaque when the image has transparency.
export function makeMask(image, { threshold, invert, useAlpha }) {
  const { brightness, alpha } = image
  const mask = new Uint8Array(brightness.length)
  for (let index = 0; index < mask.length; index++) {
    const solid = useAlpha ? alpha[index] >= 128 : brightness[index] < threshold
    mask[index] = solid !== invert ? 1 : 0
  }
  return mask
}

export function signedArea(loop) {
  let area = 0
  for (let index = 0; index < loop.length; index++) {
    const [x1, y1] = loop[index]
    const [x2, y2] = loop[(index + 1) % loop.length]
    area += x1 * y2 - x2 * y1
  }
  return area / 2
}

// Walks the pixel edges between solid and empty pixels. Solid is always on the
// right-hand side (y down), so outer boundaries have positive area and holes negative.
export function traceLoops(mask, width, height) {
  const solid = (x, y) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1
  const stride = width + 1
  const key = (x, y) => y * stride + x
  const outgoing = new Map()
  const add = (x1, y1, x2, y2) => {
    const start = key(x1, y1)
    const list = outgoing.get(start)
    const edge = { x1, y1, x2, y2, used: false }
    if (list) list.push(edge)
    else outgoing.set(start, [edge])
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!solid(x, y)) continue
      if (!solid(x, y - 1)) add(x, y, x + 1, y)
      if (!solid(x + 1, y)) add(x + 1, y, x + 1, y + 1)
      if (!solid(x, y + 1)) add(x + 1, y + 1, x, y + 1)
      if (!solid(x - 1, y)) add(x, y + 1, x, y)
    }
  }
  const loops = []
  for (const list of outgoing.values()) {
    for (const first of list) {
      if (first.used) continue
      const loop = []
      let edge = first
      while (edge && !edge.used) {
        edge.used = true
        loop.push([edge.x1, edge.y1])
        const dx = edge.x2 - edge.x1
        const dy = edge.y2 - edge.y1
        const options = (outgoing.get(key(edge.x2, edge.y2)) ?? []).filter((next) => !next.used)
        // At a corner where two solid pixels touch diagonally, always turn right so loops stay simple.
        edge = options.find((next) => dx * (next.y2 - next.y1) - dy * (next.x2 - next.x1) > 0) ?? options[0]
      }
      if (loop.length >= 4) loops.push(dropCollinear(loop))
    }
  }
  return loops
}

function dropCollinear(loop) {
  return loop.filter((point, index) => {
    const before = loop[(index - 1 + loop.length) % loop.length]
    const after = loop[(index + 1) % loop.length]
    return (point[0] - before[0]) * (after[1] - point[1]) !== (point[1] - before[1]) * (after[0] - point[0])
  })
}

function segmentDistance([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax
  const dy = by - ay
  const length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}

function douglasPeucker(points, tolerance) {
  if (points.length < 3) return points
  let farthest = 0
  let index = 0
  for (let n = 1; n < points.length - 1; n++) {
    const distance = segmentDistance(points[n], points[0], points.at(-1))
    if (distance > farthest) {
      farthest = distance
      index = n
    }
  }
  if (farthest <= tolerance) return [points[0], points.at(-1)]
  return [...douglasPeucker(points.slice(0, index + 1), tolerance).slice(0, -1), ...douglasPeucker(points.slice(index), tolerance)]
}

// Simplifies a closed loop by splitting it at its two most distant points.
export function simplifyLoop(loop, tolerance) {
  if (loop.length <= 4) return loop
  let far = 0
  let farDistance = 0
  for (let index = 1; index < loop.length; index++) {
    const distance = Math.hypot(loop[index][0] - loop[0][0], loop[index][1] - loop[0][1])
    if (distance > farDistance) {
      farDistance = distance
      far = index
    }
  }
  const first = douglasPeucker(loop.slice(0, far + 1), tolerance)
  const second = douglasPeucker([...loop.slice(far), loop[0]], tolerance)
  const result = [...first.slice(0, -1), ...second.slice(0, -1)]
  return result.length >= 3 ? result : loop
}

export function pointInLoop([x, y], loop) {
  let inside = false
  for (let index = 0, previous = loop.length - 1; index < loop.length; previous = index++) {
    const [xi, yi] = loop[index]
    const [xj, yj] = loop[previous]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// Groups loops into solid regions, each an outer boundary with the holes inside it.
export function groupRegions(loops, minArea) {
  const kept = loops.filter((loop) => Math.abs(signedArea(loop)) >= minArea)
  const outers = kept.filter((loop) => signedArea(loop) > 0)
    .map((outer) => ({ outer, holes: [], area: signedArea(outer) }))
    .sort((a, b) => b.area - a.area)
  for (const hole of kept.filter((loop) => signedArea(loop) < 0)) {
    const sample = hole.reduce(([sx, sy], [x, y]) => [sx + x / hole.length, sy + y / hole.length], [0, 0])
    const owner = outers.filter(({ outer }) => pointInLoop(sample, outer) || pointInLoop(hole[0], outer)).at(-1)
    owner?.holes.push(hole)
  }
  return outers.map(({ outer, holes }) => ({ outer, holes }))
}

// Fits a circle to a dense pixel boundary. Returns [cx, cy, r] when the loop is round.
export function fitCircle(loop) {
  if (loop.length < 8) return null
  const area = signedArea(loop)
  let cx = 0
  let cy = 0
  for (let index = 0; index < loop.length; index++) {
    const [x1, y1] = loop[index]
    const [x2, y2] = loop[(index + 1) % loop.length]
    const cross = x1 * y2 - x2 * y1
    cx += (x1 + x2) * cross
    cy += (y1 + y2) * cross
  }
  cx /= 6 * area
  cy /= 6 * area
  const radii = loop.map(([x, y]) => Math.hypot(x - cx, y - cy))
  const r = radii.reduce((sum, value) => sum + value, 0) / radii.length
  if (r < 3) return null
  const deviation = Math.sqrt(radii.reduce((sum, value) => sum + (value - r) ** 2, 0) / radii.length)
  const worst = Math.max(...radii.map((value) => Math.abs(value - r)))
  const fill = Math.abs(area) / (Math.PI * r * r)
  if (deviation > Math.max(0.035 * r, 0.6) || worst > Math.max(0.1 * r, 1.4) || fill < 0.92 || fill > 1.08) return null
  return [round(cx), round(cy), round(r)]
}

export function traceImage(image, settings) {
  const mask = makeMask(image, settings)
  const loops = traceLoops(mask, image.width, image.height)
  const regions = groupRegions(loops, settings.minArea)
  const simplify = (loop) => {
    const circle = settings.circles ? fitCircle(loop) : null
    if (circle) return { circle }
    let tolerance = settings.tolerance
    let result = simplifyLoop(loop, tolerance)
    // Keep each loop small enough for the CAD kernel.
    while (result.length > 360) {
      tolerance *= 1.5
      result = simplifyLoop(loop, tolerance)
    }
    return { points: result }
  }
  return regions.map(({ outer, holes }) => ({
    outer: simplify(outer),
    holes: holes.map(simplify).filter((hole) => hole.circle || hole.points.length >= 3),
  }))
}

// Extents of a loop, true circles included.
function loopExtents(loop) {
  if (loop.circle) {
    const [cx, cy, r] = loop.circle
    return [cx - r, cy - r, cx + r, cy + r]
  }
  const xs = loop.points.map(([x]) => x)
  const ys = loop.points.map(([, y]) => y)
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

export function regionBounds(regions) {
  if (!regions?.length) return null
  const all = regions.map(({ outer }) => loopExtents(outer))
  return {
    minX: Math.min(...all.map((e) => e[0])), minY: Math.min(...all.map((e) => e[1])),
    maxX: Math.max(...all.map((e) => e[2])), maxY: Math.max(...all.map((e) => e[3])),
  }
}

// A circle's radius in image pixels at the given mm-per-pixel scale.
export function circleRadius(loop, scale) {
  return loop.diameter && scale ? loop.diameter / 2 / scale : loop.circle[2]
}

// True when a view is a single round outline, like the top view of a turned part.
export function isRoundView(view) {
  if (view?.regions.length !== 1) return false
  const { outer } = view.regions[0]
  if (outer.circle) return true
  const [minX, minY, maxX, maxY] = loopExtents(outer)
  const width = maxX - minX
  const height = maxY - minY
  if (!width || Math.abs(width - height) > 0.04 * Math.max(width, height)) return false
  const fill = Math.abs(signedArea(outer.points)) / (Math.PI * (width / 2) * (height / 2))
  return fill > 0.95 && fill < 1.04
}

export function loopContains(loop, point, scale = null) {
  if (loop.circle) return Math.hypot(point[0] - loop.circle[0], point[1] - loop.circle[1]) <= circleRadius(loop, scale)
  return pointInLoop(point, loop.points)
}

// Millimetres per image pixel: from two picked points and their real distance, or the overall width.
export function viewScale(view) {
  const { scale } = view
  if (scale.mode === 'points' && scale.points.length === 2 && scale.distance > 0) {
    const pixels = Math.hypot(scale.points[1][0] - scale.points[0][0], scale.points[1][1] - scale.points[0][1])
    return pixels > 0 ? scale.distance / pixels : null
  }
  const bounds = regionBounds(view.regions)
  return bounds && bounds.maxX > bounds.minX && scale.width > 0 ? scale.width / (bounds.maxX - bounds.minX) : null
}

// Converts one view's pixel regions to millimetres, centred on the outline, y up.
export function viewToMillimetres(view) {
  const bounds = regionBounds(view.regions)
  const scale = viewScale(view)
  if (!bounds || !scale) return null
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  const point = ([x, y]) => [round((x - cx) * scale), round((cy - y) * scale)]
  const convert = (loop) => loop.circle
    ? { circle: [...point(loop.circle), round(loop.diameter ? loop.diameter / 2 : loop.circle[2] * scale)] }
    : { points: loop.points.map(point) }
  return {
    regions: view.regions.map(({ outer, holes }) => ({ outer: convert(outer), holes: holes.map(convert) })),
    width: round((bounds.maxX - bounds.minX) * scale),
    height: round((bounds.maxY - bounds.minY) * scale),
  }
}

// Builds the kernel spec from the whole trace state. Returns { spec, sizes, warnings } or { error }.
export function traceToSpec(trace) {
  const { shape } = trace
  const converted = Object.fromEntries(viewNames
    .filter((name) => trace.views[name]?.regions.length)
    .map((name) => [name, viewToMillimetres(trace.views[name])]))
  if (!trace.views.front) return { error: 'Import a front view image to start.' }
  if (!converted.front) return { error: trace.views.front.regions.length ? 'Set the scale of the front view.' : 'No outline found in the front view. Adjust the threshold or try Invert.' }
  for (const name of viewNames) {
    if (trace.views[name]?.regions.length && !converted[name]) return { error: 'Set the scale of the ' + name + ' view.' }
  }
  const sizes = Object.fromEntries(Object.entries(converted).map(([name, value]) => [name, { width: value.width, height: value.height }]))
  const multi = shape.mode === 'extrude' && (converted.right || converted.top)
  const warnings = []
  if (multi) {
    const compare = (a, b, label) => {
      if (a !== undefined && b !== undefined && Math.abs(a - b) > 0.03 * Math.max(a, b)) {
        warnings.push(label + ' differ: ' + a.toFixed(1) + ' mm and ' + b.toFixed(1) + ' mm.')
      }
    }
    compare(sizes.front?.height, sizes.right?.height, 'Front and right heights')
    compare(sizes.front?.width, sizes.top?.width, 'Front and top widths')
    compare(sizes.right?.width, sizes.top?.height, 'Right width and top depth')
  }
  const spec = shape.mode === 'revolve'
    ? { mode: 'revolve', axis: round(-sizes.front.width / 2 + sizes.front.width * shape.axis / 100), views: { front: converted.front.regions } }
    : multi
      ? { mode: 'views', views: Object.fromEntries(Object.entries(converted).map(([name, value]) => [name, value.regions])) }
      : { mode: 'extrude', thickness: shape.thickness, views: { front: converted.front.regions } }
  return { spec, sizes, warnings }
}

const round = (value) => Math.round(value * 1000) / 1000
