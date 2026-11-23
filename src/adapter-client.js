let worker
let nextId = 0
let workerUnavailable = false
const pending = new Map()

function local(action, payload, kind) {
  return import('./adapter-kernel').then((kernel) => (kind === 'trace' ? kernel.runTrace : kernel.runAdapter)(action, payload))
}

// kind is 'adapter' (payload: flange dimensions) or 'trace' (payload: traced profile spec).
export function runCad(action, payload, kind = 'adapter') {
  if (workerUnavailable) return local(action, payload, kind)
  if (!worker) {
    try {
      worker = new Worker(new URL('./adapter.worker.js', import.meta.url), { type: 'module' })
      worker.onmessage = ({ data }) => {
        const job = pending.get(data.id)
        if (!job) return
        pending.delete(data.id)
        if (data.error) job.reject(new Error(data.error))
        else job.resolve(data.value)
      }
      worker.onerror = (event) => {
        event.preventDefault()
        workerUnavailable = true
        worker.terminate()
        for (const job of pending.values()) local(job.action, job.payload, job.kind).then(job.resolve, job.reject)
        pending.clear()
      }
    } catch {
      workerUnavailable = true
      return local(action, payload, kind)
    }
  }
  return new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { action, payload, kind, resolve, reject })
    worker.postMessage({ id, kind, action, payload })
  })
}
