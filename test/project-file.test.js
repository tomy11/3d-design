import assert from 'node:assert/strict'
import { test } from 'node:test'
import { adapterDefaults } from '../src/adapter-spec.js'
import { decodeProject } from '../src/project-file.js'
import { decodeTrace, emptyTrace, serializeTrace } from '../src/trace-state.js'
import { defaultTraceSettings } from '../src/trace.js'

const pixel = 'data:image/png;base64,iVBORw0KGgo='
const context = { modes: ['inspect', 'cad'], parts: ['base', 'shoulder'], joints: Array.from({ length: 6 }, () => ({ limit: 6.3 })) }

function project(extra = {}) {
  return {
    format: 'assembly-lab', version: 1, workspace: 'cad', frame: 0, pose: [0, 0, 0, 0, 0, 0], taught: [],
    adapter: adapterDefaults, selected: null, hidden: [], isolated: null, expanded: ['base'], transforms: {},
    camera: { position: [1, 1, 1], target: [0, 0, 0] }, grid: true, wireframe: false, snap: false,
    section: { enabled: false, axis: 'x', offset: 0 }, showAxes: true, explosion: 0,
    service: { joint: 0, part: null, hidden: [], separation: 0 }, ...extra,
  }
}

function tracedPart() {
  const front = {
    imageId: 'img-1', settings: defaultTraceSettings, edited: true,
    regions: [{ outer: { points: [[0, 0], [10, 0], [10, 10]] }, holes: [{ circle: [5, 3, 1], diameter: 4 }] }],
    scale: { mode: 'points', width: 100, points: [[0, 0], [10, 0]], distance: 25 },
  }
  const trace = { ...emptyTrace, views: { ...emptyTrace.views, front } }
  return serializeTrace(trace, { 'img-1': { name: 'part.png', url: pixel }, 'img-unused': { name: 'x.png', url: pixel } })
}

test('serializeTrace embeds only the images in use, and decodeTrace reads them back', () => {
  const saved = tracedPart()
  assert.deepEqual(Object.keys(saved.images), ['img-1'])
  const { trace, images } = decodeTrace(JSON.parse(JSON.stringify(saved)))
  assert.equal(images['img-1'].name, 'part.png')
  assert.equal(trace.views.front.regions[0].holes[0].diameter, 4)
  assert.equal('images' in trace, false)
})

test('decodeTrace rejects images that are not embedded PNG or JPEG data', () => {
  const saved = tracedPart()
  assert.throws(() => decodeTrace({ ...saved, images: { 'img-1': { name: 'part.png', url: 'https://example.com/a.png' } } }), /Invalid traced part/)
  assert.throws(() => decodeTrace({ ...saved, images: {} }), /Invalid traced part/)
})

test('decodeTrace rejects a negative hole diameter', () => {
  const saved = tracedPart()
  saved.views.front.regions[0].holes[0].diameter = -1
  assert.throws(() => decodeTrace(saved), /Invalid traced part/)
})

test('decodeProject reads older projects without a traced part', () => {
  const result = decodeProject(JSON.stringify(project()), context)
  assert.equal(result.cadSource, 'adapter')
  assert.equal(result.traced, null)
  assert.deepEqual(Object.keys(result.adapter).sort(), Object.keys(adapterDefaults).sort())
})

test('decodeProject reads a traced part and its CAD source', () => {
  const result = decodeProject(JSON.stringify(project({ cadSource: 'trace', trace: tracedPart() })), context)
  assert.equal(result.cadSource, 'trace')
  assert.equal(result.traced.trace.views.front.scale.distance, 25)
})

test('decodeProject rejects malformed projects', () => {
  assert.throws(() => decodeProject(JSON.stringify({ ...project(), version: 2 }), context), /Unsupported/)
  assert.throws(() => decodeProject(JSON.stringify(project({ pose: [9, 0, 0, 0, 0, 0] })), context), /pose/)
  assert.throws(() => decodeProject(JSON.stringify(project({ selected: 'elbow' })), context), /hierarchy/)
  assert.throws(() => decodeProject(JSON.stringify(project({ cadSource: 'mesh' })), context), /CAD source/)
  assert.throws(() => decodeProject(JSON.stringify(project({ service: { joint: 0, part: 'nope', hidden: [], separation: 0 } })), context), /service/)
})

test('decodeTrace keeps pocket depths, region heights and the edge finish', () => {
  const saved = tracedPart()
  saved.views.front.regions[0].holes.push({ points: [[1, 1], [3, 1], [3, 3]], depth: 2 })
  saved.views.front.regions[0].height = 15
  saved.shape = { ...saved.shape, edge: { kind: 'chamfer', size: 0.5 } }
  const { trace } = decodeTrace(JSON.parse(JSON.stringify(saved)))
  assert.equal(trace.views.front.regions[0].holes[1].depth, 2)
  assert.equal(trace.views.front.regions[0].height, 15)
  assert.deepEqual(trace.shape.edge, { kind: 'chamfer', size: 0.5 })
  assert.throws(() => decodeTrace({ ...saved, shape: { ...saved.shape, edge: { kind: 'chamfer', size: 500 } } }), /Invalid traced part/)
})

test('decodeProject keeps tool mounting, and older projects have none', () => {
  assert.deepEqual(decodeProject(JSON.stringify(project()), context).pickTool, { mounted: false, retarget: false })
  const mounted = { mounted: true, retarget: true }
  assert.deepEqual(decodeProject(JSON.stringify(project({ pickTool: mounted })), context).pickTool, mounted)
  assert.throws(() => decodeProject(JSON.stringify(project({ pickTool: { mounted: 1, retarget: false } })), context), /tool mounting/)
})
