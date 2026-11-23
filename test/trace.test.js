import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  defaultTraceSettings, fitCircle, groupRegions, isRoundView, signedArea, traceImage, traceLoops, traceToSpec, viewToMillimetres,
} from '../src/trace.js'
import { clipToAxis, validateTrace } from '../src/trace-spec.js'

// A synthetic trace image: solid (dark) wherever solid(x, y) is true.
function image(width, height, solid) {
  const brightness = new Uint8Array(width * height)
  const alpha = new Uint8Array(width * height).fill(255)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) brightness[y * width + x] = solid(x, y) ? 0 : 255
  return { width, height, brightness, alpha, hasAlpha: false, autoThreshold: 128 }
}

const plate = image(120, 80, (x, y) => {
  const inside = x >= 10 && x < 110 && y >= 10 && y < 70
  const hole = Math.hypot(x + 0.5 - 80, y + 0.5 - 40) < 12
  return inside && !hole
})

function view(regions, scale = { mode: 'width', width: 200, points: [], distance: 10 }) {
  return { imageId: 'a', settings: defaultTraceSettings, regions, edited: false, scale }
}

test('traces outer boundaries with positive area and holes with negative area', () => {
  const loops = traceLoops(new Uint8Array([1, 1, 1, 1, 0, 1, 1, 1, 1]), 3, 3)
  assert.equal(loops.length, 2)
  const areas = loops.map(signedArea).sort((a, b) => a - b)
  assert.deepEqual(areas, [-1, 9])
  const regions = groupRegions(loops, 0)
  assert.equal(regions.length, 1)
  assert.equal(regions[0].holes.length, 1)
})

test('a rectangular plate traces to four corners and a true circle hole', () => {
  const regions = traceImage(plate, defaultTraceSettings)
  assert.equal(regions.length, 1)
  assert.equal(regions[0].outer.points.length, 4)
  assert.equal(regions[0].holes.length, 1)
  const [cx, cy, r] = regions[0].holes[0].circle
  assert.ok(Math.abs(cx - 80) < 0.5 && Math.abs(cy - 40) < 0.5, 'hole centre ' + cx + ', ' + cy)
  assert.ok(Math.abs(r - 12) < 0.5, 'hole radius ' + r)
})

test('fitCircle rejects a square outline', () => {
  const square = []
  for (let i = 0; i < 20; i++) square.push([i, 0])
  for (let i = 0; i < 20; i++) square.push([20, i])
  for (let i = 20; i > 0; i--) square.push([i, 20])
  for (let i = 20; i > 0; i--) square.push([0, i])
  assert.equal(fitCircle(square), null)
})

test('converts to millimetres centred on the outline with y up', () => {
  const regions = [{ outer: { points: [[10, 10], [110, 10], [110, 60], [10, 60]] }, holes: [] }]
  const result = viewToMillimetres(view(regions))
  assert.equal(result.width, 200)
  assert.equal(result.height, 100)
  assert.deepEqual(result.regions[0].outer.points[0], [-100, 50])
})

test('a hole with a typed diameter keeps its millimetre size when the scale changes', () => {
  const outer = { points: [[0, 0], [100, 0], [100, 50], [0, 50]] }
  const holes = [{ circle: [50, 25, 5] }, { circle: [20, 25, 5], diameter: 8 }]
  for (const width of [100, 200]) {
    const [traced, typed] = viewToMillimetres(view([{ outer, holes }], { mode: 'width', width, points: [], distance: 10 })).regions[0].holes
    assert.equal(traced.circle[2], 5 * width / 100)
    assert.equal(typed.circle[2], 4)
  }
})

test('two-point scale uses the picked distance', () => {
  const regions = [{ outer: { points: [[0, 0], [80, 0], [80, 40], [0, 40]] }, holes: [] }]
  const result = viewToMillimetres(view(regions, { mode: 'points', width: 1, points: [[0, 0], [40, 0]], distance: 10 }))
  assert.equal(result.width, 20)
})

test('traceToSpec builds each solid mode and warns about mismatched views', () => {
  const box = (w, h) => [{ outer: { points: [[0, 0], [w, 0], [w, h], [0, h]] }, holes: [] }]
  const scaled = (regions, width) => view(regions, { mode: 'width', width, points: [], distance: 10 })
  const shape = { mode: 'extrude', thickness: 10, axis: 50 }
  assert.match(traceToSpec({ view: 'front', views: { front: null, right: null, top: null }, shape }).error, /Import a front view/)

  const single = traceToSpec({ view: 'front', views: { front: scaled(box(100, 50), 100), right: null, top: null }, shape })
  assert.equal(single.spec.mode, 'extrude')
  assert.equal(validateTrace(single.spec), null)

  const revolve = traceToSpec({ view: 'front', views: { front: scaled(box(100, 50), 100), right: null, top: null }, shape: { ...shape, mode: 'revolve', axis: 25 } })
  assert.equal(revolve.spec.axis, -25)

  const views = traceToSpec({ view: 'front', views: { front: scaled(box(100, 50), 100), right: scaled(box(60, 40), 60), top: null }, shape })
  assert.equal(views.spec.mode, 'views')
  assert.equal(validateTrace(views.spec), null)
  assert.equal(views.warnings.length, 1)
  assert.match(views.warnings[0], /heights differ/)
})

test('isRoundView spots a single round outline', () => {
  const circle = []
  for (let i = 0; i < 64; i++) circle.push([50 + 40 * Math.cos(i / 64 * 2 * Math.PI), 50 + 40 * Math.sin(i / 64 * 2 * Math.PI)])
  assert.equal(isRoundView(view([{ outer: { points: circle }, holes: [] }])), true)
  assert.equal(isRoundView(view([{ outer: { circle: [5, 5, 5] }, holes: [] }])), true)
  assert.equal(isRoundView(view([{ outer: { points: [[0, 0], [80, 0], [80, 80], [0, 80]] }, holes: [] }])), false)
  assert.equal(isRoundView(null), false)
})

test('clipToAxis keeps the profile right of the axis, shifted to zero', () => {
  assert.deepEqual(clipToAxis([[-10, 0], [10, 0], [10, 5], [-10, 5]], 2), [[0, 0], [8, 0], [8, 5], [0, 5]])
})

test('validateTrace rejects bad specs', () => {
  const regions = [{ outer: { points: [[0, 0], [1, 0], [1, 1]] }, holes: [] }]
  assert.match(validateTrace({ mode: 'extrude', thickness: 0, views: { front: regions } }), /Thickness/)
  assert.match(validateTrace({ mode: 'extrude', thickness: 5, views: {} }), /front view/)
  assert.match(validateTrace({ mode: 'extrude', thickness: 5, views: { front: [{ outer: { circle: [0, 0, -1] }, holes: [] }] } }), /not valid/)
  assert.match(validateTrace({ mode: 'extrude', thickness: 5, views: { front: [{ outer: { circle: [0, 0, 1], diameter: -2 }, holes: [] }] } }), /not valid/)
})

test('depths, region heights and edge finish reach the extrude spec in millimetres', () => {
  const regions = [
    { outer: { points: [[0, 0], [100, 0], [100, 50], [0, 50]] }, holes: [{ points: [[10, 10], [30, 10], [30, 30], [10, 30]], depth: 4 }, { circle: [70, 25, 5] }] },
    { outer: { points: [[120, 0], [140, 0], [140, 50], [120, 50]] }, holes: [], height: 25 },
  ]
  const front = view(regions, { mode: 'points', width: 1, points: [[0, 0], [10, 0]], distance: 10 })
  const shape = { mode: 'extrude', thickness: 10, axis: 50, edge: { kind: 'fillet', size: 1.5 } }
  const { spec } = traceToSpec({ view: 'front', views: { front, right: null, top: null }, shape })
  assert.equal(spec.views.front[0].holes[0].depth, 4)
  assert.equal('depth' in spec.views.front[0].holes[1], false)
  assert.equal(spec.views.front[1].height, 25)
  assert.deepEqual(spec.edge, { kind: 'fillet', size: 1.5 })
  assert.equal(validateTrace(spec), null)
  const sharp = traceToSpec({ view: 'front', views: { front, right: null, top: null }, shape: { ...shape, edge: { kind: 'none', size: 1 } } })
  assert.equal('edge' in sharp.spec, false)
})

test('validateTrace rejects bad depths, heights and edge sizes', () => {
  const box = { points: [[0, 0], [1, 0], [1, 1]] }
  const spec = (front, edge) => ({ mode: 'extrude', thickness: 5, views: { front }, ...(edge ? { edge } : {}) })
  assert.match(validateTrace(spec([{ outer: box, holes: [{ ...box, depth: 0 }] }])), /not valid/)
  assert.match(validateTrace(spec([{ outer: box, holes: [], height: -3 }])), /not valid/)
  assert.match(validateTrace(spec([{ outer: box, holes: [] }], { kind: 'fillet', size: 0 })), /Edge rounding/)
  assert.match(validateTrace(spec([{ outer: box, holes: [] }], { kind: 'bevel', size: 1 })), /Edge rounding/)
})
