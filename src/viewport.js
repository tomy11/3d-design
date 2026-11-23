import * as T from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { keyframes, loadRobot, makeMotionClip } from './robot'
import { makeDrive } from './drive'
import { loadGripper, makePickCell, pinchOffset } from './pick-cell'
import modelNotice from '../public/models/ur10e-license.txt?raw'
import gripperNotice from '../public/models/robotiq-license.txt?raw'

const axes = ['x', 'y', 'z']
const poses = { perspective: [2.05, 2.1, 6.1], top: [0, 1, 0.001], right: [1, 0, 0], front: [0, 0, 1] }

export async function createViewport(element, { onSelect, onSelectDrive, onChange, onTransform, onMeasure, onOrbit, signal }) {
  const [robot, gripper] = await Promise.all([loadRobot(), loadGripper()])
  signal.throwIfAborted()
  const { plant, objects, pivots, visuals } = robot
  const linkVisuals = Object.fromEntries(visuals.map(({ id, node }) => [id, node]))
  let explosion = 0
  let workspace = 'inspect'
  let servicePart = null
  let lastServiceJoint = -1
  let showToolAxes = true
  robot.setAngles(keyframes[0].angles)
  const drive = makeDrive()
  drive.attach(pivots[0], 0, 0)
  drive.root.visible = false
  const externalMeshes = new Map()
  for (const { node } of visuals) node.traverse((child) => {
    if (child.isMesh) externalMeshes.set(child, child.material)
  })
  const ghost = new T.MeshStandardMaterial({ color: '#90a6b7', transparent: true, opacity: 0.12, depthWrite: false })
  const pickCell = makePickCell(robot, gripper)
  const toolAxes = new T.AxesHelper(0.096)
  toolAxes.name = 'Tool frame indicator'
  robot.tool.add(toolAxes)
  toolAxes.visible = false
  const scene = new T.Scene()
  scene.background = new T.Color('#151b25')
  scene.fog = new T.Fog('#151b25', 3.1, 10)
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = T.PCFShadowMap
  renderer.toneMapping = T.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.11
  renderer.domElement.setAttribute('aria-label', 'Interactive 3D view of the Universal Robots UR10e')
  element.appendChild(renderer.domElement)

  const pmrem = new T.PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  const environment = pmrem.fromScene(room, 0.04)
  scene.environment = environment.texture
  scene.environmentIntensity = 0.53
  room.dispose()
  pmrem.dispose()

  const camera = new T.PerspectiveCamera(38, 1, 0.014, 42)
  const orbit = new OrbitControls(camera, renderer.domElement)
  orbit.enableDamping = true
  orbit.dampingFactor = 0.14
  orbit.minDistance = 0.055
  orbit.maxDistance = 13
  orbit.maxPolarAngle = Math.PI * 0.515
  orbit.mouseButtons.MIDDLE = T.MOUSE.PAN
  let dirty = true
  let interacting = false
  orbit.addEventListener('start', () => { interacting = true })
  orbit.addEventListener('end', () => { interacting = false })
  orbit.addEventListener('change', () => {
    dirty = true
    if (interacting) onOrbit()
  })

  const lights = [
    new T.HemisphereLight('#dceeff', '#707b91', 1.4),
    new T.DirectionalLight('#fff3e5', 2.2),
    new T.DirectionalLight('#b2d5ff', 1.8),
  ]
  lights[1].position.set(-2.3, 4, 3.1)
  lights[1].castShadow = true
  lights[1].shadow.mapSize.set(2048, 2048)
  Object.assign(lights[1].shadow.camera, { left: -2.4, right: 2.4, top: 2.4, bottom: -2.4, near: 0.1, far: 11 })
  lights[1].shadow.normalBias = 0.004
  lights[1].shadow.bias = -0.00013
  lights[2].position.set(2, 3, -2.5)
  scene.add(...lights)

  const floor = new T.Mesh(new T.PlaneGeometry(60, 60), new T.MeshStandardMaterial({ color: '#17212e', roughness: 1 }))
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -0.006
  floor.receiveShadow = true
  scene.add(floor)

  const grid = new T.GridHelper(16, 160, '#788eaf', '#7288a6')
  grid.position.y = -0.004
  grid.material.transparent = true
  grid.material.opacity = 0.19
  grid.material.toneMapped = false
  scene.add(grid)
  const cadGrid = new T.GridHelper(1, 100, '#8a9cc0', '#788bb0')
  cadGrid.rotation.x = Math.PI / 2
  cadGrid.position.z = -0.001
  cadGrid.material.transparent = true
  cadGrid.material.opacity = 0.21
  cadGrid.visible = false
  scene.add(cadGrid)

  const adapter = new T.Mesh(
    new T.BufferGeometry(),
    new T.MeshStandardMaterial({ color: '#87aebd', metalness: 0.40, roughness: 0.32, side: T.DoubleSide }),
  )
  adapter.name = 'Parametric flange adapter'
  adapter.visible = false
  scene.add(adapter)
  // An imported mesh shown see-through over the traced solid, for comparison.
  const reference = new T.Mesh(
    new T.BufferGeometry(),
    // Drawn slightly towards the camera so faces lying on the solid's faces do not flicker.
    new T.MeshStandardMaterial({ color: '#f0a34a', transparent: true, opacity: 0.34, depthWrite: false, roughness: 0.6, side: T.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  )
  reference.name = 'Reference mesh'
  reference.renderOrder = 2
  reference.visible = false
  let referenceWanted = false
  scene.add(reference)
  // Solid on its own; see-through once there is a traced solid to compare it with.
  function referenceLook() {
    const ghost = Boolean(adapter.geometry.attributes.position?.count)
    const material = reference.material
    if (material.transparent === ghost) return
    material.transparent = ghost
    material.opacity = ghost ? 0.34 : 1
    material.depthWrite = !ghost
    material.needsUpdate = true
  }
  let gridEnabled = true
  let fittingAdapter = true
  let measuring = false
  const sectionPlane = new T.Plane()
  const points = []
  const measureGroup = new T.Group()
  const markMaterial = new T.MeshBasicMaterial({ color: '#ffc85e', depthTest: false })
  const markGeometry = new T.SphereGeometry(1, 14, 10)
  const marks = [new T.Mesh(markGeometry, markMaterial), new T.Mesh(markGeometry, markMaterial)]
  const segment = new T.Line(new T.BufferGeometry(), new T.LineBasicMaterial({ color: '#ffc85e', depthTest: false }))
  segment.geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(6), 3))
  segment.frustumCulled = false
  for (const mark of marks) mark.renderOrder = 20
  segment.renderOrder = 20
  measureGroup.add(...marks, segment)
  measureGroup.visible = false
  scene.add(measureGroup)

  function clearMeasurement() {
    points.length = 0
    measureGroup.visible = false
    onMeasure({ count: 0, distance: 0 })
    dirty = true
  }

  function markPoint(point) {
    if (points.length === 2) points.length = 0
    points.push(point.clone())
    measureGroup.visible = true
    marks.forEach((mark, index) => {
      mark.visible = index < points.length
      if (mark.visible) mark.position.copy(points[index])
      mark.scale.setScalar(workspace === 'cad' ? 0.0016 : 0.006)
    })
    segment.visible = points.length === 2
    if (segment.visible) {
      const position = segment.geometry.attributes.position
      points.forEach(({ x, y, z }, index) => position.setXYZ(index, x, y, z))
      position.needsUpdate = true
    }
    onMeasure({ count: points.length, distance: points.length === 2 ? points[0].distanceTo(points[1]) * 1000 : 0 })
    dirty = true
  }

  function sceneGrid() {
    grid.visible = gridEnabled && workspace !== 'cad'
    cadGrid.visible = gridEnabled && workspace === 'cad'
    floor.visible = workspace !== 'cad'
  }

  scene.add(plant)
  const wireframes = new Map()
  plant.traverse((node) => {
    if (!node.isMesh) return
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    for (const material of materials) wireframes.set(material, material.wireframe)
  })
  const defaults = Object.fromEntries(Object.entries(objects).map(([id, object]) => [
    id, { position: object.position.clone(), rotation: object.rotation.clone(), scale: object.scale.clone() },
  ]))

  const gizmo = new TransformControls(camera, renderer.domElement)
  gizmo.setSize(0.75)
  let drag
  gizmo.addEventListener('dragging-changed', (event) => {
    orbit.enabled = !event.value
    if (event.value && objects[selected]) drag = { id: selected, before: readTransform(selected) }
    else if (drag) {
      onTransform({ ...drag, after: readTransform(drag.id) })
      drag = null
    }
  })
  gizmo.addEventListener('change', () => { dirty = true })
  gizmo.addEventListener('objectChange', () => {
    if (explosion) robot.separate(explosion)
    onChange()
  })
  scene.add(gizmo.getHelper())

  let selected = 'upperarm'
  let mode = 'select'
  const outline = new T.Group()
  scene.add(outline)
  const outlineMaterial = new T.LineBasicMaterial({ color: '#b1c7ff', transparent: true, opacity: 0.8 })
  const edges = new Map()
  let outlinedMeshes = []

  function effectivelyVisible(node) {
    for (let current = node; current; current = current.parent) {
      if (!current.visible) return false
    }
    return true
  }

  function updateOutline() {
    for (const { source, line } of outlinedMeshes) {
      line.visible = effectivelyVisible(source)
      line.matrix.copy(source.matrixWorld)
      line.matrixWorldNeedsUpdate = true
    }
  }

  function updateSelection(id, tool = mode) {
    dirty = true
    selected = id
    mode = tool
    gizmo.detach()
    outline.clear()
    outlinedMeshes = []
    if (workspace === 'service' && !measuring) {
      const piece = drive.nodes[servicePart]
      drive.highlight(piece && effectivelyVisible(piece) ? servicePart : null)
      if (piece && effectivelyVisible(piece)) outlineMeshes(piece)
      return
    }
    drive.highlight(null)
    if (measuring || workspace === 'pick' || workspace === 'cad') return
    const object = objects[id]
    if (!object || !effectivelyVisible(linkVisuals[id] ?? object)) return
    if (tool !== 'select' && workspace === 'inspect') {
      gizmo.setMode(tool)
      gizmo.attach(object)
    }
    if (id === 'robot') return
    outlineMeshes(linkVisuals[id] ?? object)
  }

  function outlineMeshes(visual) {
    visual.traverse((node) => {
      if (!node.isMesh || node.userData.hitArea) return
      if (!edges.has(node.geometry)) edges.set(node.geometry, new T.EdgesGeometry(node.geometry, 55))
      const line = new T.LineSegments(edges.get(node.geometry), outlineMaterial)
      line.matrixAutoUpdate = false
      outlinedMeshes.push({ source: node, line })
      outline.add(line)
    })
  }

  function view(name) {
    const direction = new T.Vector3(...poses[name]).normalize()
    if (workspace === 'cad') {
      if (adapter.geometry.attributes.position?.count) frameObject(adapter, direction, 3.4)
      else if (reference.visible) frameObject(reference, direction, 3.4)
      return
    }
    if (workspace === 'service') {
      if (name === 'perspective') {
        direction.set(0.8, -0.7, -0.7).applyQuaternion(drive.root.getWorldQuaternion(new T.Quaternion()))
        direction.y = Math.abs(direction.y) + 0.25
        direction.normalize()
      }
      frameObject(drive.root, direction, 4.05)
      return
    }
    const isPick = workspace === 'pick'
    if (isPick && name === 'perspective') direction.set(5.4, 3.6, 5.2).normalize()
    orbit.target.set(isPick ? 0.46 : 0.44 + 0.27 * explosion, isPick ? 0.29 : 0.48 + 0.19 * explosion, isPick ? -0.13 : -0.04)
    const distance = (isPick ? 2.15 : 1.91 + 0.60 * explosion) * Math.max(1, 1.14 / camera.aspect)
    camera.position.copy(orbit.target).addScaledVector(direction, distance)
    orbit.update()
  }

  function frameObject(object, direction, factor = 3.4) {
    if (!object || !effectivelyVisible(object)) return
    scene.updateMatrixWorld()
    const bounds = new T.Box3()
    object.traverse((node) => {
      if (!node.isMesh || node.userData.hitArea || !effectivelyVisible(node)) return
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox()
      bounds.union(node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld))
    })
    if (bounds.isEmpty()) return
    const sphere = bounds.getBoundingSphere(new T.Sphere())
    orbit.target.copy(sphere.center)
    camera.position.copy(sphere.center).addScaledVector(direction, Math.max(workspace === 'cad' ? 0.03 : 0.13, sphere.radius * factor / Math.min(camera.aspect, 1)))
    orbit.update()
  }

  function focus() {
    const target = workspace === 'cad' ? adapter : workspace === 'service'
      ? (drive.nodes[servicePart] ?? drive.root)
      : (linkVisuals[selected] ?? objects[selected])
    const direction = camera.position.clone().sub(orbit.target).normalize()
    frameObject(target, direction)
  }

  const toolMatrix = new T.Matrix4()
  const baseInverse = new T.Matrix4()
  const toolOffset = new T.Matrix4().makeTranslation(0, 0, pinchOffset)
  const readPosition = new T.Vector3()
  const readRotation = new T.Quaternion()
  const readScale = new T.Vector3()
  const readEuler = new T.Euler(0, 0, 0, 'ZYX')

  function toolReadout() {
    robot.tool.updateWorldMatrix(true, false)
    baseInverse.copy(robot.basis.matrixWorld).invert()
    toolMatrix.multiplyMatrices(baseInverse, robot.tool.matrixWorld)
    if (workspace === 'pick') toolMatrix.multiply(toolOffset)
    toolMatrix.decompose(readPosition, readRotation, readScale)
    readEuler.setFromQuaternion(readRotation)
    return {
      position: readPosition.toArray().map((value) => value * 1000),
      rotation: [readEuler.x, readEuler.y, readEuler.z].map(T.MathUtils.radToDeg),
    }
  }

  function resize() {
    const { clientWidth, clientHeight } = element
    if (!clientWidth || !clientHeight) return
    camera.aspect = clientWidth / clientHeight
    camera.updateProjectionMatrix()
    renderer.setSize(clientWidth, clientHeight)
    dirty = true
  }

  const observer = new ResizeObserver(resize)
  observer.observe(element)
  resize()
  view('perspective')
  updateSelection(selected)

  const raycaster = new T.Raycaster()
  let pointerDown
  function begin(event) {
    if (event.button !== 0) return
    pointerDown = { x: event.clientX, y: event.clientY, gizmo: gizmo.dragging }
  }
  function pick(event) {
    const start = pointerDown
    pointerDown = null
    if (!start || start.gizmo || event.button !== 0 || Math.hypot(start.x - event.clientX, start.y - event.clientY) > 5) return
    const rect = renderer.domElement.getBoundingClientRect()
    const pointer = new T.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2)
    raycaster.setFromCamera(pointer, camera)
    const intersections = (object) => raycaster.intersectObject(object).find(({ object: hit, point }) =>
      effectivelyVisible(hit) && (!measuring || !hit.userData.hitArea) && (!renderer.clippingPlanes.length || sectionPlane.distanceToPoint(point) >= -0.000001))
    if (measuring) {
      const hit = intersections(workspace === 'cad' ? adapter : workspace === 'service' ? drive.root : plant)
      if (hit) markPoint(hit.point)
      return
    }
    if (workspace === 'pick' || workspace === 'cad') return
    if (workspace === 'service') {
      let object = intersections(drive.root)?.object
      while (object && !object.userData.drive) object = object.parent
      if (object) onSelectDrive(object.userData.drive)
      return
    }
    const hit = intersections(plant)
    let object = hit?.object
    while (object && !object.userData.part) object = object.parent
    onSelect(object?.userData.part ?? null)
  }
  renderer.domElement.addEventListener('pointerdown', begin)
  renderer.domElement.addEventListener('pointerup', pick)

  renderer.setAnimationLoop(() => {
    orbit.update()
    if (!dirty) return
    dirty = false
    scene.updateMatrixWorld()
    updateOutline()
    renderer.render(scene, camera)
  })

  function readTransform(id) {
    const object = objects[id]
    if (!object) return null
    return Object.fromEntries(['position', 'rotation', 'scale'].map((type) => [
      type, axes.map((axis) => type === 'rotation' ? T.MathUtils.radToDeg(object[type][axis]) : object[type][axis]),
    ]))
  }

  function setTransform(id, state) {
    const object = objects[id]
    object.position.set(...state.position)
    object.rotation.set(...state.rotation.map(T.MathUtils.degToRad), object.rotation.order)
    object.scale.set(...state.scale)
    dirty = true
    if (explosion) robot.separate(explosion)
    onChange()
  }

  return {
    select: updateSelection,
    view,
    focus,
    toolReadout,
    clearMeasurement,
    // geometry is in millimetres, or null to remove the reference mesh.
    setReference(geometry, visible) {
      if (geometry !== undefined && geometry !== reference.geometry) {
        reference.geometry.dispose()
        reference.geometry = geometry ? geometry.clone().scale(0.001, 0.001, 0.001) : new T.BufferGeometry()
        reference.geometry.computeBoundingSphere()
        fittingAdapter = true
      }
      referenceWanted = Boolean(geometry ?? reference.geometry.attributes.position) && visible
      referenceLook()
      reference.visible = referenceWanted && workspace === 'cad'
      if (reference.visible && fittingAdapter && !adapter.geometry.attributes.position?.count) {
        view('perspective')
        fittingAdapter = false
      }
      dirty = true
    },
    refitAdapter() {
      fittingAdapter = true
    },
    setAdapter({ positions, normals, indices }) {
      const geometry = new T.BufferGeometry()
      geometry.setAttribute('position', new T.BufferAttribute(positions, 3))
      geometry.setAttribute('normal', new T.BufferAttribute(normals, 3))
      geometry.setIndex(new T.BufferAttribute(indices, 1))
      geometry.computeBoundingBox()
      geometry.computeBoundingSphere()
      adapter.geometry.dispose()
      adapter.geometry = geometry
      referenceLook()
      if (workspace === 'cad' && fittingAdapter) view('perspective')
      fittingAdapter = false
      dirty = true
    },
    setMeasure(enabled) {
      measuring = enabled
      renderer.domElement.style.cursor = enabled ? 'crosshair' : ''
      if (!enabled) clearMeasurement()
      updateSelection(selected)
    },
    setSection({ enabled, axis, offset }) {
      sectionPlane.normal.set(0, 0, 0)
      sectionPlane.normal[axis] = 1
      sectionPlane.constant = -offset / 1000
      renderer.clippingPlanes = enabled ? [sectionPlane] : []
      dirty = true
    },
    setSnap(enabled) {
      gizmo.setTranslationSnap(enabled ? 0.005 : null)
      gizmo.setRotationSnap(enabled ? T.MathUtils.degToRad(5) : null)
      gizmo.setScaleSnap(enabled ? 0.1 : null)
    },
    captureScene() {
      return {
        transforms: Object.fromEntries(Object.keys(objects).map((id) => [id, readTransform(id)])),
        camera: { position: camera.position.toArray(), target: orbit.target.toArray() },
      }
    },
    restoreScene(snapshot) {
      for (const [id, state] of Object.entries(snapshot.transforms)) setTransform(id, state)
      camera.position.fromArray(snapshot.camera.position)
      orbit.target.fromArray(snapshot.camera.target)
      orbit.update()
      fittingAdapter = false
      dirty = true
    },
    restoreTransform: setTransform,
    setWorkspace(next) {
      workspace = next
      dirty = true
      const servicing = next === 'service'
      plant.visible = next !== 'cad'
      adapter.visible = next === 'cad'
      reference.visible = referenceWanted && next === 'cad'
      fittingAdapter = true
      sceneGrid()
      if (measuring) clearMeasurement()
      drive.root.visible = servicing
      pickCell.setVisible(next === 'pick')
      toolAxes.visible = showToolAxes && (next === 'teach' || next === 'pick')
      toolAxes.position.z = next === 'pick' ? pinchOffset : 0
      for (const [mesh, original] of externalMeshes) {
        mesh.material = servicing ? ghost : original
        mesh.castShadow = !servicing
      }
      updateSelection(selected)
      if (!servicing) view('perspective')
      else lastServiceJoint = -1
    },
    configureService(joint, separation, hidden, active) {
      if (workspace !== 'service') return
      dirty = true
      servicePart = active
      drive.attach(pivots[joint], joint, separation)
      for (const [id, node] of Object.entries(drive.nodes)) node.visible = !hidden.includes(id)
      updateSelection(selected)
      if (joint !== lastServiceJoint) {
        view('perspective')
        lastServiceJoint = joint
      }
    },
    setToolAxes(visible) {
      showToolAxes = visible
      toolAxes.visible = visible && (workspace === 'teach' || workspace === 'pick')
      dirty = true
    },
    setPose(angles, frame) {
      dirty = true
      robot.setAngles(angles)
      if (workspace === 'pick') pickCell.update(frame)
      if (explosion) robot.separate(explosion)
    },
    setExplosion(amount, reframe = false) {
      dirty = true
      explosion = amount
      robot.separate(explosion)
      if (reframe) view('perspective')
    },
    setVisibility(visible) {
      for (const [id, object] of Object.entries(objects)) {
        (linkVisuals[id] ?? object).visible = visible.has(id) && (id !== 'robot' || workspace !== 'cad')
      }
      updateSelection(selected)
    },
    setWireframe(enabled) {
      dirty = true
      for (const [material, initial] of wireframes) material.wireframe = enabled || initial
    },
    setGrid(visible) {
      dirty = true
      gridEnabled = visible
      sceneGrid()
    },
    read: readTransform,
    write(id, type, axis, value) {
      const before = readTransform(id)
      const after = { ...before, [type]: [...before[type]] }
      after[type][axes.indexOf(axis)] = value
      setTransform(id, after)
      onTransform({ id, before, after })
    },
    reset(id) {
      const before = readTransform(id)
      const state = defaults[id]
      const after = {
        position: state.position.toArray(),
        rotation: axes.map((axis) => T.MathUtils.radToDeg(state.rotation[axis])),
        scale: state.scale.toArray(),
      }
      setTransform(id, after)
      onTransform({ id, before, after })
    },
    async export({ service, pick, clipName, duration, sample }) {
      const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js')
      const snapshot = service ? drive.assembledClone() : plant.clone()
      const exporter = new GLTFExporter()
      if (service) {
        snapshot.scale.setScalar(1)
        const file = await exporter.parseAsync(snapshot, { binary: true, onlyVisible: false })
        download(file, 'concept-joint-drive.glb')
        return
      }
      const excluded = [drive.root.name, toolAxes.name]
      if (!pick) excluded.push(pickCell.stations.name, pickCell.gripper.name)
      for (const name of excluded) {
        snapshot.getObjectByName(name)?.removeFromParent()
      }
      snapshot.userData.notice = pick ? modelNotice + '\n' + gripperNotice : modelNotice
      for (const { node, components } of visuals) {
        snapshot.getObjectByName(node.name).position.set(0, 0, 0)
        for (const { node: part } of components) snapshot.getObjectByName(part.name).position.set(0, 0, 0)
      }
      const animations = duration > 0 ? [makeMotionClip(pivots, clipName, duration, sample)] : []
      if (pick) {
        animations[0].tracks.push(...pickCell.motionTracks(duration, sample))
        animations[0].resetDuration()
      }
      const buffer = await exporter.parseAsync(snapshot, { binary: true, onlyVisible: false, animations })
      download(buffer, pick ? 'ur10e-pick-and-place.glb' : 'universal-robots-ur10e.glb')
    },
    dispose() {
      renderer.setAnimationLoop(null)
      observer.disconnect()
      orbit.dispose()
      gizmo.dispose()
      drive.dispose()
      const materials = new Set([ghost])
      for (const value of externalMeshes.values()) for (const material of [value].flat()) materials.add(material)
      const geometries = new Set(edges.values())
      scene.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry)
        if (Array.isArray(object.material)) for (const material of object.material) materials.add(material)
        else if (object.material) materials.add(object.material)
      })
      for (const geometry of geometries) geometry.dispose()
      for (const material of materials) {
        material.map?.dispose()
        material.dispose()
      }
      outlineMaterial.dispose()
      environment.dispose()
      for (const light of lights) light.shadow?.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}

function download(buffer, name) {
  const url = URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
