import { useMemo, useRef, useState } from 'react'
import { Matrix4, Vector3 } from 'three'
import { imageFromDataUrl, loadTraceImage, meshTraceSize, traceToSpec } from './trace'
import { createView, emptyTrace, serializeTrace, withView } from './trace-state'

// Mesh loading, placing and silhouettes are only needed once a reference mesh is imported.
let meshModule
const meshTools = () => (meshModule ??= import('./mesh-reference'))

const newImageId = () => 'img-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

// State of the Trace image workbench: the traced views, their images, the last built spec and
// the optional reference mesh. Edits go through recordChange so they can be undone.
export function useTraceWorkbench({ viewport, recordChange, setNotice }) {
  const [trace, setTrace] = useState(emptyTrace)
  const [traceSpec, setTraceSpec] = useState(null)
  const images = useRef({})
  // Reference mesh: the loaded file, its 90° turns, and the size shown in millimetres.
  const meshBase = useRef(null)
  const meshTurn = useRef(new Matrix4())
  const meshPlaced = useRef(null)
  const [mesh, setMesh] = useState(null)
  const traceResult = useMemo(() => traceToSpec(trace), [trace])
  const traceUpToDate = Boolean(traceSpec && traceResult.spec) && JSON.stringify(traceSpec) === JSON.stringify(traceResult.spec)

  // before is passed when a drag already changed the state live and only needs recording.
  function changeTrace(next, label, before = trace) {
    recordChange({ type: 'trace', label, before, after: next })
    setTrace(next)
  }

  function addImage(image) {
    const id = newImageId()
    images.current[id] = image
    return id
  }

  async function placeReference(longest, visible) {
    const { placeMesh } = await meshTools()
    const placed = placeMesh(meshBase.current, meshTurn.current, longest)
    meshPlaced.current?.dispose()
    meshPlaced.current = placed.geometry
    viewport.current?.setReference(placed.geometry, visible)
    setMesh({ name: meshBase.current.name, triangles: meshBase.current.triangles, longest, size: placed.size, visible })
  }

  async function importMesh(file) {
    try {
      const { loadMesh } = await meshTools()
      const loaded = await loadMesh(file)
      meshBase.current?.geometry.dispose()
      meshBase.current = loaded
      meshTurn.current = new Matrix4()
      loaded.geometry.computeBoundingBox()
      const size = loaded.geometry.boundingBox.getSize(new Vector3())
      // Keep the file's own size when it is plausible, otherwise start at 100 mm.
      const longest = Math.max(size.x, size.y, size.z) * loaded.mmPerUnit
      await placeReference(longest >= 1 && longest <= 5000 ? Math.round(longest * 100) / 100 : 100, true)
      setNotice('Reference mesh loaded: ' + Math.round(loaded.triangles).toLocaleString() + ' triangles.')
    } catch (failure) {
      setNotice('Could not import mesh. ' + (failure?.message ?? String(failure)))
    }
  }

  function turnMesh(axis) {
    const rotation = new Matrix4()
    if (axis === 'x') rotation.makeRotationX(Math.PI / 2)
    if (axis === 'y') rotation.makeRotationY(Math.PI / 2)
    if (axis === 'z') rotation.makeRotationZ(Math.PI / 2)
    meshTurn.current.premultiply(rotation)
    return placeReference(mesh.longest, mesh.visible)
  }

  function removeMesh() {
    meshBase.current?.geometry.dispose()
    meshPlaced.current?.dispose()
    meshBase.current = meshPlaced.current = null
    viewport.current?.setReference(null, false)
    setMesh(null)
  }

  function showMesh(visible) {
    setMesh({ ...mesh, visible })
    viewport.current?.setReference(undefined, visible)
  }

  // Front, right and top silhouettes of the reference mesh become traced views at true scale.
  async function viewsFromMesh() {
    try {
      const { renderSilhouettes } = await meshTools()
      const shots = await renderSilhouettes(meshPlaced.current)
      let next = trace
      for (const [name, { blob, width }] of Object.entries(shots)) {
        const image = await loadTraceImage(blob, mesh.name + ' ' + name + '.png', { maxSize: meshTraceSize, lossless: true })
        const view = createView(image, addImage(image))
        next = withView(next, name, () => ({ ...view, scale: { ...view.scale, mode: 'width', width: Math.round(width * 1000) / 1000 } }))
      }
      changeTrace({ ...next, view: 'front', shape: { ...next.shape, mode: 'extrude' } }, 'views from mesh')
      setNotice('Front, right and top views made from the reference mesh.')
    } catch (failure) {
      setNotice('Could not make views. ' + (failure?.message ?? String(failure)))
    }
  }

  async function importImage(name, file) {
    try {
      const image = await loadTraceImage(file)
      changeTrace({ ...withView(trace, name, () => createView(image, addImage(image))), view: name }, 'traced image')
    } catch (failure) {
      setNotice('Could not import image. ' + (failure?.message ?? String(failure)))
    }
  }

  // Replaces a view with its straightened photo. With the rectangle's real width, the scale is set too.
  function straighten(name, image, realWidth) {
    const view = createView(image, addImage(image))
    const scale = realWidth ? { ...view.scale, mode: 'points', points: [[0, 0], [image.width, 0]], distance: realWidth } : view.scale
    changeTrace(withView(trace, name, () => ({ ...view, scale })), 'straightened photo')
  }

  // Loads the traced part saved in a project (or clears it), and rebuilds its solid.
  async function restore(traced) {
    const loaded = {}
    if (traced) {
      for (const [id, { name, url }] of Object.entries(traced.images)) loaded[id] = await imageFromDataUrl(url, name)
    }
    images.current = loaded
    const next = traced?.trace ?? emptyTrace
    setTrace(next)
    setTraceSpec(traceToSpec(next).spec ?? null)
  }

  return {
    trace, setTrace, traceSpec, traceResult, traceUpToDate, mesh, changeTrace, restore,
    serialize: () => serializeTrace(trace, images.current),
    build: () => setTraceSpec(traceResult.spec),
    panelProps: {
      trace, images: images.current, result: traceResult, onChange: changeTrace, onLive: setTrace, onImport: importImage,
      onStraighten: straighten, mesh, onImportMesh: importMesh, onMeshSize: (longest) => placeReference(longest, mesh.visible),
      onMeshTurn: turnMesh, onMeshVisible: showMesh, onMeshRemove: removeMesh, onViewsFromMesh: viewsFromMesh,
    },
  }
}
