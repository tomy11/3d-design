let worker
let nextId = 0
let workerUnavailable = false
const pending = new Map()

function local(action, dimensions) {
  return import('./adapter-kernel').then(({ runAdapter }) => runAdapter(action, dimensions))
}

export function runCad(action, dimensions) {
  if (workerUnavailable) return local(action, dimensions)
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
        for (const job of pending.values()) local(job.action, job.dimensions).then(job.resolve, job.reject)
        pending.clear()
      }
    } catch {
      workerUnavailable = true
      return local(action, dimensions)
    }
  }
  return new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { action, dimensions, resolve, reject })
    worker.postMessage({ id, action, dimensions })
  })
}
