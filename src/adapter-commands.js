import { adapterDefaults, adapterFields, validateAdapter } from './adapter-spec.js'

const bodyId = 'flange-adapter'
const dimensionKeys = new Set(adapterFields.map(({ id }) => id))

class AdapterCommandError extends Error {
  constructor(code, message, revision, options) {
    super(message, options)
    this.name = 'AdapterCommandError'
    this.code = code
    this.revision = revision
  }
}

export function createAdapterCommands({ runCad, onEdit }) {
  const listeners = new Set()
  let snapshot = makeSnapshot(0, adapterDefaults)
  let pending

  function makeSnapshot(revision, dimensions, mesh = null) {
    return Object.freeze({ revision, dimensions: Object.freeze({ ...dimensions }), mesh, building: false })
  }

  function publish(next) {
    snapshot = next
    for (const listener of listeners) listener()
  }

  function fail(code, message, options) {
    return new AdapterCommandError(code, message, snapshot.revision, options)
  }

  function requireBody(id) {
    if (id !== bodyId) throw fail('BODY_NOT_FOUND', 'This project body was not found.')
  }

  function get_body({ id = bodyId } = {}) {
    requireBody(id)
    return { id, revision: snapshot.revision, units: 'mm', dimensions: { ...snapshot.dimensions } }
  }

  async function set_adapter_dimensions({ id = bodyId, expected_revision, dimensions } = {}) {
    requireBody(id)
    if (expected_revision !== snapshot.revision) {
      throw fail('REVISION_CONFLICT', 'The adapter has changed. Read its current dimensions before editing.')
    }
    if (pending) throw fail('ADAPTER_BUSY', 'The adapter is already rebuilding.')
    if (!dimensions || typeof dimensions !== 'object' || Array.isArray(dimensions) ||
        Object.keys(dimensions).some((key) => !dimensionKeys.has(key))) {
      throw fail('INVALID_DIMENSIONS', 'Provide adapter dimensions using the supported field names.')
    }

    const before = snapshot
    const next = { ...before.dimensions, ...dimensions }
    const invalid = validateAdapter(next)
    if (invalid) throw fail('INVALID_DIMENSIONS', invalid)
    if ([...dimensionKeys].every((key) => next[key] === before.dimensions[key])) return get_body({ id })

    const job = Symbol()
    pending = job
    publish(Object.freeze({ ...before, building: true }))
    try {
      let mesh
      try {
        mesh = await runCad('mesh', next)
      } catch (cause) {
        if (pending !== job) throw fail('REVISION_CONFLICT', 'The adapter was replaced while building.')
        throw fail('BUILD_FAILED', 'Open CASCADE could not rebuild the adapter. ' + (cause?.message ?? String(cause)), { cause })
      }
      if (pending !== job) throw fail('REVISION_CONFLICT', 'The adapter was replaced while building.')

      const committed = makeSnapshot(before.revision + 1, next, mesh)
      onEdit?.(before.dimensions, committed.dimensions)
      pending = undefined
      publish(committed)
      return get_body({ id })
    } finally {
      if (pending === job) {
        pending = undefined
        publish(before)
      }
    }
  }

  function restore(dimensions) {
    const invalid = validateAdapter(dimensions)
    if (invalid) throw fail('INVALID_DIMENSIONS', invalid)
    pending = undefined
    publish(makeSnapshot(snapshot.revision + 1, dimensions))
  }

  return {
    get_body,
    set_adapter_dimensions,
    restore,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
