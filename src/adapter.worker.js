import { runAdapter } from './adapter-kernel'

self.onmessage = async ({ data: { id, action, dimensions } }) => {
  try {
    const value = await runAdapter(action, dimensions)
    const transfer = typeof value === 'string' ? [] : Object.values(value).map((array) => array.buffer)
    self.postMessage({ id, value }, transfer)
  } catch (error) {
    self.postMessage({ id, error: error?.message ?? String(error) })
  }
}
