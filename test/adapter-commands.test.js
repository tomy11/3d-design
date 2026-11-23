import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAdapterCommands } from '../src/adapter-commands.js'

test('commits the mesh, dimensions and undo edit together, then restores with a new revision', async () => {
  const mesh = { positions: new Float32Array([0, 0, 0.018]) }
  const edits = []
  const commands = createAdapterCommands({
    runCad: async (action, dimensions) => {
      assert.equal(action, 'mesh')
      assert.equal(dimensions.thickness, 18)
      assert.equal(dimensions.count, 4)
      return mesh
    },
    onEdit: (before, after) => edits.push({ before, after }),
  })
  const original = commands.get_body()
  assert.equal(original.id, 'flange-adapter')
  assert.equal(original.units, 'mm')
  assert.equal(original.dimensions.thickness, 12)

  const changed = await commands.set_adapter_dimensions({
    expected_revision: original.revision,
    dimensions: { thickness: 18 },
  })
  assert.equal(changed.dimensions.thickness, 18)
  assert.equal(changed.revision, original.revision + 1)
  assert.equal(commands.getSnapshot().mesh, mesh)
  assert.equal(edits.length, 1)
  assert.equal(edits[0].before.thickness, 12)
  assert.equal(edits[0].after.thickness, 18)

  commands.restore(edits[0].before)
  assert.equal(commands.get_body().dimensions.thickness, 12)
  assert.equal(commands.get_body().revision, changed.revision + 1)
  assert.equal(edits.length, 1)
  await assert.rejects(commands.set_adapter_dimensions({
    expected_revision: original.revision,
    dimensions: { thickness: 20 },
  }), { code: 'REVISION_CONFLICT' })
})

test('validation and no-op edits leave the body, kernel and undo history untouched', async () => {
  const commands = createAdapterCommands({
    runCad: () => assert.fail('Unexpected CAD rebuild'),
    onEdit: () => assert.fail('Unexpected undo entry'),
  })
  const original = commands.get_body()
  await assert.rejects(commands.set_adapter_dimensions({
    expected_revision: original.revision, dimensions: { thickness: 1 },
  }), { code: 'INVALID_DIMENSIONS' })
  await assert.rejects(commands.set_adapter_dimensions({
    expected_revision: original.revision, dimensions: { typo: 5 },
  }), { code: 'INVALID_DIMENSIONS' })
  assert.throws(() => commands.get_body({ id: 'unknown' }), { code: 'BODY_NOT_FOUND' })
  assert.deepEqual(await commands.set_adapter_dimensions({
    expected_revision: original.revision, dimensions: { thickness: 12 },
  }), original)
  assert.deepEqual(commands.get_body(), original)
})

test('a failed CAD rebuild keeps the saved body and does not add an undo entry', async () => {
  const commands = createAdapterCommands({
    runCad: async () => { throw new Error('test kernel failure') },
    onEdit: () => assert.fail('Unexpected undo entry'),
  })
  const original = commands.get_body()
  await assert.rejects(commands.set_adapter_dimensions({
    expected_revision: original.revision, dimensions: { thickness: 18 },
  }), { code: 'BUILD_FAILED' })
  assert.deepEqual(commands.get_body(), original)
  assert.equal(commands.getSnapshot().building, false)
})

test('an in-flight rebuild cannot overwrite a loaded project or add undo history to it', async () => {
  let finish
  const commands = createAdapterCommands({
    runCad: () => new Promise((resolve) => { finish = resolve }),
    onEdit: () => assert.fail('Unexpected undo entry'),
  })
  const original = commands.get_body()
  const committedDimensions = commands.getSnapshot().dimensions
  const build = commands.set_adapter_dimensions({
    expected_revision: original.revision, dimensions: { thickness: 18 },
  })
  assert.equal(commands.getSnapshot().building, true)
  assert.equal(commands.getSnapshot().dimensions, committedDimensions)
  assert.deepEqual(commands.get_body(), original)
  await assert.rejects(commands.set_adapter_dimensions({
    expected_revision: original.revision, dimensions: { thickness: 20 },
  }), { code: 'ADAPTER_BUSY' })
  commands.restore({ ...original.dimensions, thickness: 24 })
  finish({ positions: new Float32Array([0, 0, 0.018]) })
  await assert.rejects(build, { code: 'REVISION_CONFLICT' })
  assert.equal(commands.get_body().dimensions.thickness, 24)
  assert.equal(commands.get_body().revision, original.revision + 1)
})
