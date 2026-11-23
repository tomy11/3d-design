import { runAdapter, runTrace } from './adapter-kernel'

self.onmessage = async ({ data: { id, kind, action, payload } }) => {
  try {
    const value = await (kind === 'trace' ? runTrace : runAdapter)(action, payload)
    const transfer = typeof value === 'string' ? [] : Object.values(value).map((array) => array.buffer)
    self.postMessage({ id, value }, transfer)
  } catch (error) {
    self.postMessage({ id, error: error?.message ?? String(error) })
  }
}
