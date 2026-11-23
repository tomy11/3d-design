import * as T from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { maxTraceSize } from './trace'

// A reference mesh is any GLB, glTF, OBJ or STL, such as the output of an AI
// image-to-3D service or a scan. It is only used to look at and to make silhouettes.

export const meshAccept = '.glb,.gltf,.obj,.stl'
const maxMeshBytes = 200 * 1024 * 1024

async function parse(file) {
  const extension = file.name.split('.').pop().toLowerCase()
  if (extension === 'glb' || extension === 'gltf') {
    const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
      import('three/addons/loaders/GLTFLoader.js'), import('three/addons/libs/meshopt_decoder.module.js'),
    ])
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    const source = extension === 'glb' ? await file.arrayBuffer() : await file.text()
    const gltf = await loader.parseAsync(source, '')
    // glTF is in metres.
    return { root: gltf.scene, mmPerUnit: 1000 }
  }
  if (extension === 'obj') {
    const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js')
    return { root: new OBJLoader().parse(await file.text()), mmPerUnit: 1 }
  }
  if (extension === 'stl') {
    const { STLLoader } = await import('three/addons/loaders/STLLoader.js')
    return { root: new T.Mesh(new STLLoader().parse(await file.arrayBuffer())), mmPerUnit: 1 }
  }
  throw new Error('Choose a GLB, glTF, OBJ or STL file.')
}

// Merges every mesh into one position-only geometry in the file's own units.
export async function loadMesh(file) {
  if (file.size > maxMeshBytes) throw new Error('The mesh exceeds 200 MB.')
  const { root, mmPerUnit } = await parse(file)
  root.updateMatrixWorld(true)
  const parts = []
  root.traverse((node) => {
    if (!node.isMesh || !node.geometry?.attributes.position) return
    let geometry = new T.BufferGeometry()
    geometry.setAttribute('position', node.geometry.attributes.position.clone())
    if (node.geometry.index) geometry.setIndex(node.geometry.index.clone())
    geometry = geometry.index ? geometry.toNonIndexed() : geometry
    geometry.applyMatrix4(node.matrixWorld)
    parts.push(geometry)
  })
  root.traverse((node) => {
    node.geometry?.dispose()
    for (const material of [node.material].flat()) {
      if (!material) continue
      for (const value of Object.values(material)) if (value?.isTexture) value.dispose()
      material.dispose()
    }
  })
  if (!parts.length) throw new Error('The file contains no mesh.')
  const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts)
  for (const part of parts) if (part !== geometry) part.dispose()
  return { name: file.name, geometry, mmPerUnit, triangles: geometry.attributes.position.count / 3 }
}

// The mesh in millimetres: turned, scaled so its longest side is `longest` mm, centred on its box.
export function placeMesh(base, turn, longest) {
  const geometry = base.geometry.clone()
  geometry.applyMatrix4(turn)
  geometry.computeBoundingBox()
  const size = geometry.boundingBox.getSize(new T.Vector3())
  const scale = longest / Math.max(size.x, size.y, size.z, 1e-9)
  const center = geometry.boundingBox.getCenter(new T.Vector3())
  geometry.translate(-center.x, -center.y, -center.z)
  geometry.scale(scale, scale, scale)
  geometry.computeBoundingBox()
  geometry.computeVertexNormals()
  return { geometry, size: size.multiplyScalar(scale).toArray() }
}

// Each view: where its camera sits and which way is up, matching the tracing kernel.
// Front looks along -Z, right along -X (image right is -Z), top along -Y (image up is -Z).
const cameras = {
  front: { position: [0, 0, 1], up: [0, 1, 0], across: 0, down: 1 },
  right: { position: [1, 0, 0], up: [0, 1, 0], across: 2, down: 1 },
  top: { position: [0, 1, 0], up: [0, 0, -1], across: 0, down: 2 },
}

// Renders black-on-white orthographic silhouettes of a millimetre mesh.
// Returns { front, right, top } of { blob, width } where width is the real width in mm.
export async function renderSilhouettes(geometry) {
  geometry.computeBoundingBox()
  const box = geometry.boundingBox
  const size = box.getSize(new T.Vector3()).toArray()
  const reach = Math.max(...size)
  const canvas = document.createElement('canvas')
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
  const scene = new T.Scene()
  scene.background = new T.Color('#ffffff')
  const material = new T.MeshBasicMaterial({ color: '#000000', side: T.DoubleSide })
  scene.add(new T.Mesh(geometry, material))
  const results = {}
  try {
    for (const [name, { position, up, across, down }] of Object.entries(cameras)) {
      const width = size[across]
      const height = size[down]
      // Leave a margin so the outline never touches the image edge.
      const margin = Math.max(width, height) * 0.06 + 1e-6
      const pixels = (maxTraceSize - 2) / (Math.max(width, height) + 2 * margin)
      const imageWidth = Math.max(8, Math.round((width + 2 * margin) * pixels))
      const imageHeight = Math.max(8, Math.round((height + 2 * margin) * pixels))
      renderer.setPixelRatio(1)
      renderer.setSize(imageWidth, imageHeight, false)
      const halfWidth = imageWidth / pixels / 2
      const halfHeight = imageHeight / pixels / 2
      const camera = new T.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 0.001, reach * 4 + 10)
      camera.position.set(...position).multiplyScalar(reach * 2 + 5)
      camera.up.set(...up)
      camera.lookAt(0, 0, 0)
      renderer.render(scene, camera)
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      results[name] = { blob, width }
    }
  } finally {
    material.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
  return results
}
