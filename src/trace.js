// Image-to-outline tracing. Everything here works in image pixels (x right, y down)
// until toMillimetres converts the traced regions into a CAD profile.

export const maxTraceSize = 720

export async function loadTraceImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Choose a PNG, JPEG, WebP or other image file.')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxTraceSize / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const pixels = context.getImageData(0, 0, width, height)
  return { name: file.name, width, height, url: canvas.toDataURL('image/png'), ...analyse(pixels) }
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

export function traceImage(image, settings) {
  const mask = makeMask(image, settings)
  const loops = traceLoops(mask, image.width, image.height)
  const regions = groupRegions(loops, settings.minArea)
  const simplify = (loop) => {
    let tolerance = settings.tolerance
    let result = simplifyLoop(loop, tolerance)
    // Keep each loop small enough for the CAD kernel.
    while (result.length > 360) {
      tolerance *= 1.5
      result = simplifyLoop(loop, tolerance)
    }
    return result
  }
  return regions.map(({ outer, holes }) => ({ outer: simplify(outer), holes: holes.map(simplify).filter((hole) => hole.length >= 3) }))
}

export function regionBounds(regions) {
  const xs = regions.flatMap(({ outer }) => outer.map(([x]) => x))
  const ys = regions.flatMap(({ outer }) => outer.map(([, y]) => y))
  if (!xs.length) return null
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

// Converts pixel regions to millimetres, centred on the shape, y up.
export function toMillimetres(regions, widthMm) {
  const bounds = regionBounds(regions)
  if (!bounds || bounds.maxX <= bounds.minX) return null
  const scale = widthMm / (bounds.maxX - bounds.minX)
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  const convert = (loop) => loop.map(([x, y]) => [round((x - cx) * scale), round((cy - y) * scale)])
  return {
    regions: regions.map(({ outer, holes }) => ({ outer: convert(outer), holes: holes.map(convert) })),
    width: widthMm,
    height: round((bounds.maxY - bounds.minY) * scale),
  }
}

const round = (value) => Math.round(value * 1000) / 1000
