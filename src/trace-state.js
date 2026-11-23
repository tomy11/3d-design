import { defaultTraceSettings, traceImage, viewNames } from './trace'
import { validRegions } from './trace-spec'

// Trace state is plain JSON so it can be undone and saved. Images live apart, keyed by id,
// because their pixel arrays are large: a view only names its imageId.
export const emptyTrace = {
  view: 'front',
  views: { front: null, right: null, top: null },
  shape: { mode: 'extrude', thickness: 10, axis: 50 },
}

export function createView(image, imageId) {
  const settings = { ...defaultTraceSettings, threshold: image.autoThreshold, useAlpha: image.hasAlpha }
  return { imageId, settings, regions: traceImage(image, settings), edited: false, scale: { mode: 'width', width: 100, points: [], distance: 10 } }
}

export function withView(trace, name, change) {
  return { ...trace, views: { ...trace.views, [name]: change(trace.views[name]) } }
}

export function serializeTrace(trace, images) {
  const used = [...new Set(viewNames.map((name) => trace.views[name]?.imageId).filter(Boolean))]
  return { ...trace, images: Object.fromEntries(used.map((id) => [id, { name: images[id].name, url: images[id].url }])) }
}

const maxImageUrl = 12 * 1024 * 1024
const finite = (value) => Number.isFinite(value) && Math.abs(value) <= 1e6
const pixelPoint = (item) => Array.isArray(item) && item.length === 2 && item.every(finite)

function validView(view, images) {
  if (view === null) return true
  const { imageId, settings, regions, edited, scale } = view ?? {}
  return typeof imageId === 'string' && imageId in images &&
    settings && finite(settings.threshold) && finite(settings.tolerance) && finite(settings.minArea) &&
    ['invert', 'useAlpha', 'circles'].every((key) => typeof settings[key] === 'boolean') &&
    validRegions(regions) && typeof edited === 'boolean' &&
    scale && ['width', 'points'].includes(scale.mode) && finite(scale.width) && finite(scale.distance) &&
    Array.isArray(scale.points) && scale.points.length <= 2 && scale.points.every(pixelPoint)
}

// Returns the trace from a project file, or throws when it is malformed.
export function decodeTrace(value) {
  const images = value?.images
  const valid = images && typeof images === 'object' && !Array.isArray(images) &&
    Object.values(images).every((image) => typeof image?.name === 'string' && image.name.length <= 300 &&
      typeof image.url === 'string' && image.url.length <= maxImageUrl && /^data:image\/(png|jpeg);base64,/.test(image.url)) &&
    viewNames.includes(value.view) && value.views && viewNames.every((name) => validView(value.views[name], images)) &&
    ['extrude', 'revolve'].includes(value.shape?.mode) && finite(value.shape.thickness) &&
    finite(value.shape.axis) && value.shape.axis >= 0 && value.shape.axis <= 100
  if (!valid) throw new Error('Invalid traced part.')
  const { images: _images, ...trace } = value
  return { trace: { ...trace, views: Object.fromEntries(viewNames.map((name) => [name, value.views[name]])) }, images }
}
