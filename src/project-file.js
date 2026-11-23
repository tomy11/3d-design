import { validateAdapter, adapterFields } from './adapter-spec.js'
import { driveIds } from './drive.js'
import { decodeTrace } from './trace-state.js'

export const PROJECT_EXTENSION = 'assemblylab'
export const desktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
const maxBytes = 16 * 1024 * 1024

async function command(name, args) {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke(name, args)
}

export async function openNativeProject() {
  return command('open_project')
}

function download(data, name, type) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function saveProject(project) {
  const document = JSON.stringify({ format: 'assembly-lab', version: 1, ...project }, null, 2)
  if (desktop) return command('save_project', { document })
  download(document, 'assembly-lab.' + PROJECT_EXTENSION, 'application/json')
  return true
}

export async function saveStep(document, name = 'flange-adapter.step') {
  if (desktop) return command('save_step', { document, name })
  download(document, name, 'model/step')
  return true
}

const vector = (item, length, limit = 1000) => Array.isArray(item) && item.length === length &&
  item.every((value) => Number.isFinite(value) && Math.abs(value) <= limit)

export async function readBrowserProject(file) {
  if (file.size > maxBytes) throw new Error('This project exceeds 16 MB.')
  return file.text()
}

export function decodeProject(source, { modes, parts, joints }) {
  const document = JSON.parse(source)
  const validAngles = (values) => vector(values, 6) && values.every((value, index) => Math.abs(value) <= joints[index].limit)
  const ids = (items, valid) => Array.isArray(items) && items.every((id) => valid.includes(id))
  const id = (value, valid) => value === null || valid.includes(value)
  const between = (value, min, max) => Number.isFinite(value) && value >= min && value <= max
  const integer = (value, min, max) => Number.isInteger(value) && between(value, min, max)
  const clause = (condition, message) => { if (!condition) throw new Error(message) }
  clause(document?.format === 'assembly-lab' && document.version === 1, 'Unsupported Assembly Lab project format.')
  const { workspace, frame, pose, taught, adapter, selected, hidden, isolated, expanded, transforms, camera,
    grid, wireframe, snap, section, showAxes, explosion, service } = document
  clause(modes.includes(workspace) && integer(frame, 0, workspace === 'pick' ? 240 : 120) && validAngles(pose), 'Invalid workspace or pose.')
  clause(Array.isArray(taught) && taught.length <= 121 && taught.every((key, index) =>
    integer(key?.frame, 0, 120) && validAngles(key.angles) && (!index || key.frame > taught[index - 1].frame)), 'Invalid taught timeline.')
  clause(!validateAdapter(adapter), 'The project has invalid adapter dimensions.')
  clause(id(selected, parts) && id(isolated, parts) && ids(hidden, parts) && ids(expanded, parts), 'Invalid scene hierarchy.')
  clause(transforms && !Array.isArray(transforms) && typeof transforms === 'object' && Object.entries(transforms).every(([key, value]) =>
    parts.includes(key) && vector(value?.position, 3) && vector(value?.rotation, 3, 1e6) && vector(value?.scale, 3)), 'Invalid object transforms.')
  clause(vector(camera?.position, 3) && vector(camera?.target, 3) &&
    Math.hypot(...camera.position.map((value, index) => value - camera.target[index])) >= 0.01, 'Invalid camera state.')
  clause([grid, wireframe, snap, section?.enabled, showAxes].every((value) => typeof value === 'boolean') &&
    ['x', 'y', 'z'].includes(section.axis) && between(section.offset, -1500, 1500) && between(explosion, 0, 1), 'Invalid viewport settings.')
  clause(integer(service?.joint, 0, 5) && between(service.separation, 0, 1) &&
    id(service.part, driveIds) && ids(service.hidden, driveIds), 'Invalid service settings.')
  // Traced parts were added later, so older projects have none.
  clause(document.cadSource === undefined || ['adapter', 'trace'].includes(document.cadSource), 'Invalid CAD source.')
  const traced = document.trace === undefined ? null : decodeTrace(document.trace)
  return { ...document, traced, cadSource: document.cadSource ?? 'adapter', adapter: Object.fromEntries(adapterFields.map(({ id: key }) => [key, adapter[key]])) }
}
