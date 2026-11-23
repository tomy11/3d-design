import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Boxes, ChevronDown, ChevronRight, CircleHelp, Download, Eye, EyeOff,
  Focus, Maximize2, Minimize2, PanelRight, PanelBottom, FolderOpen, Magnet, Redo2, Ruler, Save, Scissors, Undo2, Grid2X2, Layers3, Expand, Maximize, MousePointer2, Move, Pause, Play, RotateCcw,
  RotateCw, ScanLine, SkipBack, SkipForward, SlidersHorizontal, Wrench, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { hierarchy, joints, keyframes, licenseUrl, meshCount, sourceUrl } from './robot'
import { fps, persistTaughtProgram, pickProgram, readTaughtProgram, sampleProgram, teachEnd } from './program'
import { PickPanel, ServiceFooter, ServicePanels, TeachPanels, ToolFrame } from './ModePanels'
import { gripperLicense, gripperSource } from './pick-cell'
import { CadPanel, ViewPanel } from './CadPanel'
import { TracePanel } from './TracePanel'
import { imageFromDataUrl, loadTraceImage, traceToSpec } from './trace'
import { createView, emptyTrace, serializeTrace, withView } from './trace-state'
import { loadMesh, placeMesh, renderSilhouettes } from './mesh-reference'
import { Matrix4, Vector3 } from 'three'
import { adapterDefaults } from './adapter-spec'
import { runCad } from './adapter-client'
import { decodeProject, desktop, openNativeProject, readBrowserProject, saveProject, saveStep } from './project-file'
import { createViewport } from './viewport'

const tools = [
  { id: 'select', icon: MousePointer2, label: 'Select', key: 'V' },
  { id: 'translate', icon: Move, label: 'Move', key: 'G' },
  { id: 'rotate', icon: RotateCw, label: 'Rotate', key: 'R' },
  { id: 'scale', icon: Maximize, label: 'Scale', key: 'S' },
]
const sidebarMin = 280
const sidebarMax = 480
const clampSidebar = (width) => Math.max(sidebarMin, Math.min(sidebarMax, width))

const toolKeys = Object.fromEntries(tools.map((tool) => [tool.key.toLowerCase(), tool.id]))
const viewLabels = { perspective: 'Perspective', orbit: 'Perspective', top: 'Top', front: 'Front', right: 'Right' }
const modes = [
  { id: 'inspect', label: 'Inspect', icon: Layers3 },
  { id: 'teach', label: 'Teach Mode', compact: 'Teach', icon: ScanLine },
  { id: 'pick', label: 'Pick & Place', icon: Box },
  { id: 'service', label: 'Service Mode', compact: 'Service', icon: Wrench },
  { id: 'cad', label: 'CAD', icon: SlidersHorizontal },
]

function indexTree(nodes, parents = []) {
  const entries = nodes.flatMap((node) => [
    [node.id, { ...node, parents }],
    ...indexTree(node.children ?? [], [...parents, node.id]),
  ])
  return entries
}

const parts = Object.fromEntries(indexTree(hierarchy))

function visibleParts(hidden, isolated) {
  return new Set(Object.values(parts).filter(({ id, parents }) => {
    if (isolated) return id === isolated || parents.includes(isolated) || parts[isolated].parents.includes(id)
    return !hidden.includes(id) && parents.every((parent) => !hidden.includes(parent))
  }).map(({ id }) => id))
}

function IconButton({ label, children, className, ...props }) {
  return <Button size="icon" variant="ghost" aria-label={label} title={label} className={className} {...props}>{children}</Button>
}

function SceneTree({ nodes, level = 0, selected, expanded, hidden, visible, onSelect, onExpand, onVisibility }) {
  return (
    <ul className="scene-list">
      {nodes.map((node) => {
        const open = expanded.includes(node.id)
        const concealed = hidden.includes(node.id)
        const shown = visible.has(node.id)
        const PartIcon = node.children ? (node.id === 'robot' ? Boxes : Layers3) : Box
        return (
          <li key={node.id}>
            <div className={`tree-row ${selected === node.id ? 'selected' : ''} ${shown ? '' : 'concealed'}`} style={{ '--depth': level }}>
              {node.children
                ? <IconButton label={`${open ? 'Collapse' : 'Expand'} ${node.name}`} className="tree-toggle" aria-expanded={open} onClick={() => onExpand(node.id)}>{open ? <ChevronDown /> : <ChevronRight />}</IconButton>
                : <span className="tree-spacer" />}
              <button className="tree-label" onClick={() => onSelect(node.id)} aria-pressed={selected === node.id}>
                <PartIcon size={14} /><span>{node.name}</span>{node.joint && <span className="joint-tag">{node.joint}</span>}
              </button>
              <IconButton label={`${concealed ? 'Show' : 'Hide'} ${node.name}`} className="tree-eye" onClick={() => onVisibility(node.id)}>
                {concealed ? <EyeOff /> : <Eye />}
              </IconButton>
            </div>
            {node.children && open && <SceneTree nodes={node.children} level={level + 1} {...{ selected, expanded, hidden, visible, onSelect, onExpand, onVisibility }} />}
          </li>
        )
      })}
    </ul>
  )
}

function NumberField({ value, axis, name, onCommit }) {
  const [draft, setDraft] = useState(null)
  const canceled = useRef(false)
  const display = value.toFixed(2)
  return (
    <label className="number-field">
      <span className={`axis axis-${axis}`}>{axis.toUpperCase()}</span>
      <input aria-label={`${name} ${axis.toUpperCase()}`} inputMode="decimal" value={draft ?? display}
        onFocus={(event) => { canceled.current = false; event.target.select() }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const parsed = Number(draft)
          if (!canceled.current && draft?.trim() && Number.isFinite(parsed)) onCommit(parsed)
          setDraft(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.target.blur()
          if (event.key === 'Escape') {
            canceled.current = true
            event.target.blur()
          }
        }}
      />
    </label>
  )
}

function Inspector({ selected, transform, viewport, pose, setJoint, isolated, setIsolated, onSelect }) {
  const part = parts[selected]
  const jointId = part?.joint ?? (part?.sourceName ? parts[part.parents.at(-1)].joint : null)
  const jointIndex = joints.findIndex(({ joint }) => joint === jointId)
  const joint = joints[jointIndex]
  const angle = pose[jointIndex]
  const isIsolated = isolated === selected
  return (
    <section className="panel inspector">
      <div className="panel-heading"><SlidersHorizontal size={16} /><h2>Properties</h2></div>
      {selected && transform ? (
        <div className="properties" key={selected}>
          <div className="object-heading">
            <span className="object-icon"><Box size={17} /></span>
            <div><h3>{part.name}</h3><p>{part.sourceName ?? (part.joint ? part.joint + ' · Revolute joint' : 'Object3D')}</p></div>
            {selected !== 'robot' && <IconButton className="isolate-button" label={isIsolated ? 'Show entire robot' : 'Isolate selected part'} aria-pressed={isIsolated} onClick={() => setIsolated(isIsolated ? null : selected)}><Focus size={16} /></IconButton>}
          </div>
          {joint && <div className="joint-control">
            <div className="joint-control-heading"><label htmlFor="joint-angle">{joint.joint} joint angle</label><output htmlFor="joint-angle">{angle.toFixed(1)}°</output></div>
            <input id="joint-angle" type="range" min={-joint.limit} max={joint.limit} step="0.5" value={angle} onChange={(event) => setJoint(jointIndex, Number(event.target.value))} />
            <div className="joint-range"><span>{-joint.limit}°</span><span>{joint.limit}°</span></div>
          </div>}
          <details className="transform-details">
          <summary>Free transform</summary>
          <div className="section-line">
            <h4>Local coordinates</h4>
            <IconButton label="Reset selected transform" onClick={() => viewport.current?.reset(selected)}><RotateCcw size={14} /></IconButton>
          </div>
          {[['position', 'Location', 'm'], ['rotation', 'Rotation', '°'], ['scale', 'Scale', null]].map(([type, label, unit]) => (
            <div className="transform-group" key={type}>
              <div className="field-label">{label}{unit && <span>{unit}</span>}</div>
              <div className="number-grid">
                {['x', 'y', 'z'].map((axis, index) =>
                  <NumberField key={axis} axis={axis} name={label} value={transform[type][index]} onCommit={(value) => viewport.current?.write(selected, type, axis, value)} />
                )}
              </div>
            </div>
          ))}
          </details>
          {part.children && selected !== 'robot' && <div className="component-shortcuts">
            <h4>CAD components</h4>
            <div>{part.children.map((child) => <Button key={child.id} size="sm" variant="outline" onClick={() => onSelect(child.id)} aria-label={'Inspect ' + child.name}>{child.name}</Button>)}</div>
          </div>}
        </div>
      ) : <p className="empty-properties">Select a part in the viewport or scene hierarchy to edit its transform.</p>}
    </section>
  )
}

function Timeline({ frame, playing, setFrame, setPlaying, lastFrame, markers, trackName, canPlay }) {
  const track = useRef(null)
  function seek(event) {
    const rect = track.current.getBoundingClientRect()
    setFrame(Math.max(0, Math.min(lastFrame, Math.round((event.clientX - rect.left) / rect.width * lastFrame))))
  }
  return (
    <section className="panel timeline">
      <div className="timeline-heading">
        <div className="panel-heading"><ScanLine size={16} /><h2>Timeline</h2></div>
        <div className="playback">
          <IconButton label="First frame" onClick={() => { setPlaying(false); setFrame(0) }}><SkipBack size={14} /></IconButton>
          <IconButton label={playing ? 'Pause joint motion' : 'Play joint motion'} className="mini-play" disabled={!canPlay} onClick={() => setPlaying(!playing)}>{playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</IconButton>
          <IconButton label="Last frame" onClick={() => { setPlaying(false); setFrame(lastFrame) }}><SkipForward size={14} /></IconButton>
        </div>
        <div className="frame-count"><strong>{String(frame).padStart(3, '0')}</strong> / {lastFrame}<span>{fps} FPS</span></div>
      </div>
      <div className="timeline-content">
        <span className="track-label">{trackName}</span>
        <div className={`ruler ${markers.length > 6 ? 'dense-ruler' : ''}`} ref={track}>
          <div className="ruler-scrub" role="slider" tabIndex={0} aria-label="Animation frame" aria-valuemin={0} aria-valuemax={lastFrame} aria-valuenow={frame} aria-valuetext={`Frame ${frame}`}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              setPlaying(false)
              seek(event)
            }}
            onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) seek(event) }}
            onKeyDown={(event) => {
              const changes = { ArrowLeft: frame - 1, ArrowRight: frame + 1, Home: 0, End: lastFrame }
              if (!(event.key in changes)) return
              event.preventDefault()
              setPlaying(false)
              setFrame(Math.max(0, Math.min(lastFrame, changes[event.key])))
            }}
          />
          {markers.map((item) => (
            <div key={item.frame} className="keyframe" style={{ left: `${item.frame / lastFrame * 100}%` }}>
              <span>{item.frame}</span>
              <button aria-label={`${item.name}, frame ${item.frame}`} title={item.name} onClick={() => { setPlaying(false); setFrame(item.frame) }}><i /></button>
            </div>
          ))}
          <div className="playhead" style={{ left: `${frame / lastFrame * 100}%` }} />
        </div>
      </div>
    </section>
  )
}

export default function App() {
  const mount = useRef(null)
  const splitterDrag = useRef(null)
  const [sidebarWidth, setSidebarWidth] = useState(330)
  const [dock, setDock] = useState(true)
  const [timeline, setTimeline] = useState(true)
  const [focused, setFocused] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const viewport = useRef(null)
  const dialog = useRef(null)
  const fileInput = useRef(null)
  const history = useRef({ undo: [], redo: [] })
  const [, setHistoryVersion] = useState(0)
  const [projectBusy, setProjectBusy] = useState(false)
  const [sceneRestore, setSceneRestore] = useState(null)
  const [dimensions, setDimensions] = useState(adapterDefaults)
  const [cadBuilding, setCadBuilding] = useState(false)
  const [cadError, setCadError] = useState('')
  const [cadSource, setCadSource] = useState('adapter')
  const [traceSpec, setTraceSpec] = useState(null)
  const [trace, setTrace] = useState(emptyTrace)
  const traceImages = useRef({})
  // Reference mesh: the loaded file, its 90° turns, and the size shown in millimetres.
  const meshBase = useRef(null)
  const meshTurn = useRef(new Matrix4())
  const meshPlaced = useRef(null)
  const [mesh, setMesh] = useState(null)
  const traceResult = useMemo(() => traceToSpec(trace), [trace])
  const traceUpToDate = Boolean(traceSpec && traceResult.spec) && JSON.stringify(traceSpec) === JSON.stringify(traceResult.spec)
  const [stepExporting, setStepExporting] = useState(false)
  const [snap, setSnap] = useState(false)
  const [measure, setMeasure] = useState(false)
  const [measurement, setMeasurement] = useState({ count: 0, distance: 0 })
  const [section, setSection] = useState({ enabled: false, axis: 'x', offset: 0 })
  const [selected, setSelected] = useState('upperarm')
  const [expanded, setExpanded] = useState(['robot'])
  const [hidden, setHidden] = useState([])
  const [isolated, setIsolated] = useState(null)
  const [workspace, setWorkspace] = useState('inspect')
  const [taught, setTaught] = useState(readTaughtProgram)
  const [toolValues, setToolValues] = useState(null)
  const [showAxes, setShowAxes] = useState(true)
  const [servicePose, setServicePose] = useState(keyframes[0].angles)
  const [serviceJoint, setServiceJoint] = useState(1)
  const [servicePart, setServicePart] = useState(null)
  const [serviceHidden, setServiceHidden] = useState([])
  const [separation, setSeparation] = useState(0.62)
  const [explosion, setExplosion] = useState(0)
  const [overrides, setOverrides] = useState({})
  const [ready, setReady] = useState(false)
  const visible = useMemo(() => visibleParts(hidden, isolated), [hidden, isolated])
  const [tool, setTool] = useState('select')
  const [view, setView] = useState('perspective')
  const [wireframe, setWireframe] = useState(false)
  const [grid, setGrid] = useState(true)
  const [, setTransformVersion] = useState(0)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState(false)
  const frameRef = useRef(0)
  const cameraMoved = useRef(false)
  const program = workspace === 'teach' ? taught : workspace === 'pick' ? pickProgram : keyframes
  const lastFrame = workspace === 'teach' ? teachEnd : program.at(-1).frame
  const canPlay = ready && workspace !== 'service' && workspace !== 'cad' && (workspace !== 'teach' || taught.length > 1)
  const pose = useMemo(() => {
    if (workspace === 'service') return servicePose
    return sampleProgram(program, frame).map((angle, index) => overrides[index] ?? angle)
  }, [workspace, servicePose, program, frame, overrides])

  function recordChange(change) {
    if (JSON.stringify(change.before) === JSON.stringify(change.after)) return
    const stack = history.current.undo
    stack.push(change)
    if (stack.length > 100) stack.shift()
    history.current.redo.length = 0
    setHistoryVersion((version) => version + 1)
  }

  function moveHistory(direction) {
    const from = history.current[direction]
    const change = from.pop()
    if (!change) return
    const undo = direction === 'undo'
    const value = undo ? change.before : change.after
    if (change.type === 'adapter') setDimensions(value)
    if (change.type === 'trace') setTrace(value)
    if (change.type === 'transform') viewport.current?.restoreTransform(change.id, value)
    if (change.type === 'visibility') setHidden(value)
    if (change.type === 'taught') {
      setPlaying(false)
      setTaught(value)
      persistTaughtProgram(value)
    }
    history.current[undo ? 'redo' : 'undo'].push(change)
    setHistoryVersion((version) => version + 1)
    setNotice((undo ? 'Undid ' : 'Redid ') + change.label + '.')
  }

  function applyDimensions(next) {
    recordChange({ type: 'adapter', label: 'adapter dimensions', before: dimensions, after: next })
    setDimensions(next)
  }

  // before is passed when a drag already changed the state live and only needs recording.
  function changeTrace(next, label, before = trace) {
    recordChange({ type: 'trace', label, before, after: next })
    setTrace(next)
  }

  function placeReference(longest, visible) {
    const placed = placeMesh(meshBase.current, meshTurn.current, longest)
    meshPlaced.current?.dispose()
    meshPlaced.current = placed.geometry
    viewport.current?.setReference(placed.geometry, visible)
    setMesh({ name: meshBase.current.name, triangles: meshBase.current.triangles, longest, size: placed.size, visible })
  }

  async function importMesh(file) {
    try {
      const loaded = await loadMesh(file)
      meshBase.current?.geometry.dispose()
      meshBase.current = loaded
      meshTurn.current = new Matrix4()
      loaded.geometry.computeBoundingBox()
      const size = loaded.geometry.boundingBox.getSize(new Vector3())
      // Keep the file's own size when it is plausible, otherwise start at 100 mm.
      const longest = Math.max(size.x, size.y, size.z) * loaded.mmPerUnit
      placeReference(longest >= 1 && longest <= 5000 ? Math.round(longest * 100) / 100 : 100, true)
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
    placeReference(mesh.longest, mesh.visible)
  }

  function removeMesh() {
    meshBase.current?.geometry.dispose()
    meshPlaced.current?.dispose()
    meshBase.current = meshPlaced.current = null
    viewport.current?.setReference(null, false)
    setMesh(null)
  }

  // Front, right and top silhouettes of the reference mesh become traced views at true scale.
  async function viewsFromMesh() {
    try {
      const shots = await renderSilhouettes(meshPlaced.current)
      let next = trace
      for (const [name, { blob, width }] of Object.entries(shots)) {
        const image = await loadTraceImage(blob, mesh.name + ' ' + name + '.png')
        const id = 'img-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
        traceImages.current[id] = image
        const view = createView(image, id)
        next = withView(next, name, () => ({ ...view, scale: { ...view.scale, mode: 'width', width: Math.round(width * 1000) / 1000 } }))
      }
      changeTrace({ ...next, view: 'front', shape: { ...next.shape, mode: 'extrude' } }, 'views from mesh')
      setNotice('Front, right and top views made from the reference mesh.')
    } catch (failure) {
      setNotice('Could not make views. ' + (failure?.message ?? String(failure)))
    }
  }

  async function importTraceImage(name, file) {
    try {
      const image = await loadTraceImage(file)
      const id = 'img-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
      traceImages.current[id] = image
      changeTrace({ ...withView(trace, name, () => createView(image, id)), view: name }, 'traced image')
    } catch (failure) {
      setNotice('Could not import image. ' + (failure?.message ?? String(failure)))
    }
  }

  async function exportAdapter() {
    setStepExporting(true)
    try {
      const tracing = cadSource === 'trace'
      const document = tracing ? await runCad('step', traceSpec, 'trace') : await runCad('step', dimensions)
      if (await saveStep(document, tracing ? 'traced-part.step' : 'flange-adapter.step')) {
        setNotice(tracing ? 'Traced part exported as STEP.' : 'Flange adapter exported as STEP.')
      }
    } catch (failure) {
      setNotice(failure?.message ?? String(failure))
    } finally {
      setStepExporting(false)
    }
  }

  async function applyProject(source) {
    const snapshot = decodeProject(source, { modes: modes.map(({ id }) => id), parts: Object.keys(parts), joints })
    const loaded = {}
    if (snapshot.traced) {
      for (const [id, { name, url }] of Object.entries(snapshot.traced.images)) loaded[id] = await imageFromDataUrl(url, name)
    }
    traceImages.current = loaded
    const nextTrace = snapshot.traced?.trace ?? emptyTrace
    setTrace(nextTrace)
    setTraceSpec(traceToSpec(nextTrace).spec ?? null)
    setCadSource(snapshot.cadSource)
    setPlaying(false)
    setWorkspace(snapshot.workspace)
    setView('orbit')
    setTool('select')
    setMeasure(false)
    setFrame(snapshot.frame)
    setTaught(snapshot.taught)
    setOverrides(Object.fromEntries(snapshot.pose.map((angle, index) => [index, angle])))
    setServicePose(snapshot.pose)
    setDimensions(snapshot.adapter)
    setExpanded(snapshot.expanded)
    setSelected(snapshot.selected)
    setHidden(snapshot.hidden)
    setIsolated(snapshot.isolated)
    setGrid(snapshot.grid)
    setWireframe(snapshot.wireframe)
    setSnap(snapshot.snap)
    setSection(snapshot.section)
    setShowAxes(snapshot.showAxes)
    setExplosion(snapshot.explosion)
    setServiceJoint(snapshot.service.joint)
    setServicePart(snapshot.service.part)
    setServiceHidden(snapshot.service.hidden)
    setSeparation(snapshot.service.separation)
    cameraMoved.current = true
    history.current = { undo: [], redo: [] }
    setSceneRestore({ transforms: snapshot.transforms, camera: snapshot.camera })
    setNotice('Project opened.')
  }

  async function openProject(file) {
    if (projectBusy || !ready) return
    if (!desktop && !file) {
      fileInput.current.click()
      return
    }
    setProjectBusy(true)
    try {
      const source = file ? await readBrowserProject(file) : await openNativeProject()
      if (source !== null) await applyProject(source)
    } catch (failure) {
      setNotice('Could not open project. ' + (failure?.message ?? String(failure)))
    } finally {
      setProjectBusy(false)
    }
  }

  async function writeProject() {
    if (projectBusy || !ready) return
    setProjectBusy(true)
    try {
      const outcome = await saveProject({
        workspace, frame, pose, taught, adapter: dimensions, selected, hidden, isolated, expanded,
        grid, wireframe, snap, section, showAxes, explosion,
        service: { joint: serviceJoint, part: servicePart, hidden: serviceHidden, separation },
        cadSource, trace: serializeTrace(trace, traceImages.current),
        ...viewport.current.captureScene(),
      })
      if (outcome) setNotice('Project saved.')
    } catch (failure) {
      setNotice('Could not save project. ' + (failure?.message ?? String(failure)))
    } finally {
      setProjectBusy(false)
    }
  }

  function showInspector() {
    setFocused(false)
    setDock(true)
  }

  function resizeDock(event) {
    const start = splitterDrag.current
    if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    setSidebarWidth(clampSidebar(start.width + start.x - event.clientX))
  }

  useEffect(() => {
    if (desktop) {
      let active = true
      async function syncNative() {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window')
          const value = await getCurrentWindow().isFullscreen()
          if (active) setFullscreen(value)
        } catch {
          // The viewport focus control remains available in older desktop builds.
        }
      }
      syncNative()
      window.addEventListener('resize', syncNative)
      return () => { active = false; window.removeEventListener('resize', syncNative) }
    }
    function syncBrowser() {
      setFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', syncBrowser)
    return () => document.removeEventListener('fullscreenchange', syncBrowser)
  }, [])

  async function toggleFullscreen() {
    try {
      if (desktop) {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        const window = getCurrentWindow()
        const next = !(await window.isFullscreen())
        await window.setFullscreen(next)
        setFullscreen(next)
      } else if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else if (document.fullscreenEnabled && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen()
      } else {
        setFocused((current) => !current)
      }
    } catch {
      setFocused((current) => !current)
    }
  }

  function switchWorkspace(next) {
    if (next === workspace) return
    if (next !== 'inspect') showInspector()
    if (next === 'service') setServicePose(pose)
    setMeasure(false)
    setPlaying(false)
    setFrame(0)
    setOverrides({})
    setTool('select')
    setView('perspective')
    setWorkspace(next)
    cameraMoved.current = false
  }

  function savePose() {
    setPlaying(false)
    const entry = { frame, angles: [...pose] }
    const next = [...taught.filter((key) => key.frame !== frame), entry].sort((a, b) => a.frame - b.frame)
    recordChange({ type: 'taught', label: 'taught pose', before: taught, after: next })
    setTaught(next)
    setOverrides({})
    setNotice(persistTaughtProgram(next) ? `Pose saved at frame ${frame}.` : 'Pose saved for this session. Browser storage is unavailable.')
  }

  function deletePose(at) {
    if (taught.length <= 2) setPlaying(false)
    const next = taught.filter((key) => key.frame !== at)
    recordChange({ type: 'taught', label: 'pose deletion', before: taught, after: next })
    setTaught(next)
    if (!persistTaughtProgram(next)) setNotice('Browser storage is unavailable.')
  }

  function seek(next) {
    setOverrides({})
    setFrame(next)
  }

  function setJoint(index, angle) {
    setPlaying(false)
    setOverrides((previous) => ({ ...previous, [index]: angle }))
  }

  function togglePlayback() {
    if (!canPlay) return
    if (!playing) setOverrides({})
    setPlaying(!playing)
  }

  function changeExplosion(amount, reframe = false) {
    setExplosion(amount)
    viewport.current?.setExplosion(amount, reframe)
    if (reframe) setView('perspective')
  }

  function choose(id) {
    setSelected(id)
    if (id) setExpanded((open) => [...new Set([...open, ...parts[id].parents])])
  }

  useEffect(() => {
    const controller = new AbortController()
    createViewport(mount.current, {
      signal: controller.signal,
      onSelect: choose,
      onSelectDrive: setServicePart,
      onMeasure: setMeasurement,
      onTransform: (change) => recordChange({ ...change, type: 'transform', label: 'object transform' }),
      onChange: () => setTransformVersion((version) => version + 1),
      onOrbit: () => { cameraMoved.current = true; setView('orbit') },
    }).then((api) => {
      if (controller.signal.aborted) {
        api.dispose()
        return
      }
      viewport.current = api
      setReady(true)
    }).catch((failure) => {
      if (controller.signal.aborted) return
      console.error(failure)
      setError(true)
    })
    return () => {
      controller.abort()
      viewport.current?.dispose()
      viewport.current = null
    }
  }, [])

  useEffect(() => {
    const api = viewport.current
    if (!api) return
    api.setExplosion(0)
    api.setWorkspace(workspace)
  }, [ready, workspace])

  useEffect(() => { viewport.current?.select(selected, tool) }, [ready, selected, tool])
  useEffect(() => {
    viewport.current?.setVisibility(workspace === 'pick' || workspace === 'service' || workspace === 'cad' ? visibleParts([], null) : visible)
  }, [ready, visible, workspace])
  useEffect(() => { viewport.current?.setWireframe(wireframe && workspace === 'inspect') }, [ready, wireframe, workspace])
  useEffect(() => { viewport.current?.setGrid(grid) }, [ready, grid])
  useEffect(() => { viewport.current?.setToolAxes(showAxes) }, [ready, showAxes])
  useEffect(() => {
    if (workspace === 'inspect') viewport.current?.setExplosion(explosion, false)
  }, [ready, workspace, explosion])
  useEffect(() => {
    const api = viewport.current
    if (api) {
      api.setPose(pose, frame)
      if (workspace === 'teach' || workspace === 'pick') setToolValues(api.toolReadout())
    }
    frameRef.current = frame
  }, [ready, frame, pose, workspace])
  useEffect(() => {
    viewport.current?.configureService(serviceJoint, separation, serviceHidden, servicePart)
  }, [ready, workspace, serviceJoint, separation, serviceHidden, servicePart])

  useEffect(() => { viewport.current?.setSnap(snap) }, [ready, snap])
  useEffect(() => { viewport.current?.setMeasure(measure) }, [ready, measure])
  useEffect(() => { viewport.current?.setSection(section) }, [ready, section])
  useEffect(() => { viewport.current?.setReference(undefined, Boolean(mesh?.visible) && cadSource === 'trace') }, [ready, mesh, cadSource])
  useEffect(() => {
    if (ready && sceneRestore) viewport.current?.restoreScene(sceneRestore)
  }, [ready, sceneRestore])
  useEffect(() => {
    if (!ready || workspace !== 'cad') return
    let current = true
    setCadError('')
    const tracing = cadSource === 'trace'
    if (tracing && !traceSpec) {
      viewport.current?.setAdapter({ positions: new Float32Array(), normals: new Float32Array(), indices: new Uint32Array() })
      setCadBuilding(false)
      return
    }
    setCadBuilding(true)
    viewport.current?.refitAdapter()
    ;(tracing ? runCad('mesh', traceSpec, 'trace') : runCad('mesh', dimensions)).then((mesh) => {
      if (current) viewport.current?.setAdapter(mesh)
    }).catch((failure) => {
      if (current) setCadError('Open CASCADE could not rebuild the solid. ' + (failure?.message ?? String(failure)))
    }).finally(() => {
      if (current) setCadBuilding(false)
    })
    return () => { current = false }
  }, [ready, workspace, dimensions, cadSource, traceSpec])

  useEffect(() => {
    if (!playing) return
    const start = performance.now() - (frameRef.current % (lastFrame + 1)) / fps * 1000
    let request
    function tick(now) {
      setFrame(Math.max(0, Math.floor((now - start) / 1000 * fps)) % (lastFrame + 1))
      request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [playing, lastFrame])

  useEffect(() => {
    function shortcut(event) {
      if (dialog.current?.open || event.altKey || event.target.closest('input, select, textarea, [role="slider"]')) return
      const key = event.key.toLowerCase()
      if (event.metaKey || event.ctrlKey) {
        if (key === 'z' || key === 'y') {
          event.preventDefault()
          moveHistory(key === 'y' || event.shiftKey ? 'redo' : 'undo')
        }
        if (key === 'o') { event.preventDefault(); openProject() }
        if (key === 's') { event.preventDefault(); writeProject() }
        return
      }
      if (workspace === 'inspect' && key in toolKeys) setTool(toolKeys[key])
      if (key === 'f') { cameraMoved.current = true; viewport.current?.focus(); setView('orbit') }
      if (key === 'escape') {
        if (focused) setFocused(false)
        else choose(null)
      }
      if (key === ' ' && event.shiftKey) {
        event.preventDefault()
        setFocused((active) => !active)
        return
      }
      if (key === ' ' && !event.target.closest('button')) {
        event.preventDefault()
        togglePlayback()
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  })

  useEffect(() => {
    if (!notice) return
    const timeout = setTimeout(() => setNotice(''), 3200)
    return () => clearTimeout(timeout)
  }, [notice])

  function changeView(name) {
    cameraMoved.current = name !== 'perspective'
    viewport.current?.view(name)
    setView(name)
  }

  async function exportScene() {
    if (!viewport.current || exporting) return
    setExporting(true)
    setNotice('')
    try {
      await viewport.current.export({
        service: workspace === 'service',
        pick: workspace === 'pick',
        clipName: workspace === 'teach' ? 'Taught UR10e motion' : workspace === 'pick' ? 'UR10e pick and place' : 'UR10e motion preview',
        duration: workspace === 'teach' && taught.length < 2 ? 0 : lastFrame,
        sample: (at) => sampleProgram(program, at),
      })
      setNotice(workspace === 'service' ? 'Concept joint drive exported as GLB.' : 'UR10e exported as GLB.')
    } catch (failure) {
      console.error(failure)
      setNotice('The GLB export failed. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  function toggle(set, id) {
    set((list) => list.includes(id) ? list.filter((item) => item !== id) : [...list, id])
  }

  const transform = ready ? viewport.current?.read(selected) : null
  const showViewportPanel = measure || section.enabled
  const inspectorVisible = dock && !focused
  const hasTimeline = workspace !== 'cad' && workspace !== 'service'
  const lowerDockVisible = !focused && (hasTimeline ? timeline : workspace === 'service')
  const isCad = workspace === 'cad'
  const currentPart = selected ? parts[selected]?.name : null
  const stateLabel = error ? 'Viewport unavailable' : !ready ? 'Loading model' : cadBuilding && isCad ? 'Building solid' : playing ? 'Playing' : 'Ready'

  return (
    <div className={`app ${focused ? 'viewport-focused' : ''}`}>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="identity"><span className="brand-icon"><Boxes size={22} strokeWidth={1.8} /></span><span>Assembly<span className="brand-accent">.</span>Lab</span></div>
          <div className="header-divider" />
          <div className="document-title">
            <span className="document-type">{isCad ? 'PART DESIGN' : 'ROBOT WORKCELL'}</span>
            <h1>{isCad ? (cadSource === 'trace' ? 'Traced Part Workbench' : 'Flange Adapter Workbench') : 'UR10e Collaborative Robot'}</h1>
          </div>
          <div className="header-actions">
            <input ref={fileInput} type="file" hidden accept=".assemblylab,application/json" onChange={(event) => {
              const file = event.target.files[0]
              event.target.value = ''
              if (file) openProject(file)
            }} />
            <IconButton label="Open project" disabled={!ready || projectBusy} onClick={() => openProject()}><FolderOpen size={17} /></IconButton>
            <IconButton label="Save project" disabled={!ready || projectBusy} onClick={writeProject}><Save size={17} /></IconButton>
            <span className="header-divider action-divider" />
            <IconButton label="Controls" onClick={() => dialog.current.showModal()}><CircleHelp size={17} /></IconButton>
            <IconButton label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} aria-pressed={fullscreen} onClick={toggleFullscreen}>
              {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </IconButton>
            <Button variant="outline" aria-label={workspace === 'cad' ? 'Export STEP' : 'Export GLB'} onClick={workspace === 'cad' ? exportAdapter : exportScene} disabled={!ready || exporting || (workspace === 'cad' && (cadBuilding || stepExporting || Boolean(cadError) || (cadSource === 'trace' && !traceSpec)))} className="export-button"><Download size={16} /><span>{exporting || stepExporting ? 'Exporting…' : workspace === 'cad' ? 'Export STEP' : 'Export GLB'}</span></Button>
          </div>
        </div>
      </header>

      <main className="workspace">
        <div className="workspace-bar">
          <nav className="mode-nav" aria-label="Workbench modes">
            {modes.map(({ id, label, compact, icon: Icon }) =>
              <Button key={id} variant="ghost" aria-label={label} aria-pressed={workspace === id} onClick={() => switchWorkspace(id)}>
                <Icon size={15} /><span className={compact && compact !== label ? 'mode-label-wide' : undefined}>{label}</span>
                {compact && compact !== label && <span className="mode-label-compact" aria-hidden="true">{compact}</span>}
              </Button>
            )}
          </nav>
          <div className="workspace-actions">
            {hasTimeline && <Button className="primary-play" onClick={togglePlayback} disabled={!canPlay}
              aria-label={playing ? 'Pause motion' : 'Play motion'}>
              {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
              <span>{playing ? 'Pause' : 'Play motion'}</span>
            </Button>}
            {hasTimeline && <IconButton label={timeline && !focused ? 'Hide timeline' : 'Show timeline'} aria-pressed={timeline && !focused}
              onClick={() => { setTimeline(focused ? true : !timeline); setFocused(false) }}><PanelBottom size={17} /></IconButton>}
            <IconButton label={inspectorVisible ? 'Hide inspector' : 'Show inspector'} aria-pressed={inspectorVisible}
              onClick={() => { setDock(!inspectorVisible); setFocused(false) }}><PanelRight size={17} /></IconButton>
          </div>
        </div>
        <div className={`workbench ${inspectorVisible ? 'has-sidebar' : ''}`} style={{ '--sidebar-width': `${sidebarWidth}px` }}>
          <div className="workbench-main">
            <section className={`viewport panel ${workspace === 'cad' ? 'cad-viewport' : ''}`} aria-label="3D viewport">
              <div className="viewport-header">
                <div className="viewport-title"><Box size={15} /><h2>3D Viewport</h2></div>
                <div className="viewport-actions">
                  <IconButton label="Undo" onClick={() => moveHistory('undo')} disabled={!history.current.undo.length}><Undo2 size={16} /></IconButton>
                  <IconButton label="Redo" onClick={() => moveHistory('redo')} disabled={!history.current.redo.length}><Redo2 size={16} /></IconButton>
                  <span className="vertical-rule" />
                  <IconButton label="Snap transforms" aria-pressed={snap} onClick={() => setSnap(!snap)} title="Snap move 5 mm, rotate 5°, scale 0.1"><Magnet size={16} /></IconButton>
                  <IconButton label="Measure distance" aria-pressed={measure} onClick={() => { if (!measure) showInspector(); setMeasure(!measure) }}><Ruler size={16} /></IconButton>
                  <IconButton label="Section view" aria-pressed={section.enabled} onClick={() => { if (!section.enabled) showInspector(); setSection({ ...section, enabled: !section.enabled }) }}><Scissors size={16} /></IconButton>
                  {workspace === 'inspect' && <Button className="explode-button" aria-label="Explode" size="sm" variant="ghost" aria-pressed={explosion > 0} disabled={!ready} onClick={() => changeExplosion(explosion > 0 ? 0 : 1, !cameraMoved.current)}><Expand size={15} /><span>Explode</span></Button>}
                  <span className="vertical-rule" />
                  <IconButton label={grid ? 'Hide grid' : 'Show grid'} aria-pressed={grid} onClick={() => setGrid(!grid)}><Grid2X2 size={16} /></IconButton>
                  {workspace === 'inspect' && <IconButton label={wireframe ? 'Switch to solid view' : 'Switch to wireframe'} aria-pressed={wireframe} onClick={() => setWireframe(!wireframe)}><Layers3 size={17} /></IconButton>}
                  <span className="vertical-rule" />
                  <IconButton label="Reset view" onClick={() => changeView('perspective')}><RotateCcw size={16} /></IconButton>
                  <IconButton label={focused ? 'Restore layout (Shift+Space)' : 'Maximize viewport (Shift+Space)'} aria-pressed={focused}
                    onClick={() => setFocused(!focused)}>{focused ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</IconButton>
                </div>
              </div>
              <div className="render-area">
                <div className="canvas-mount" ref={mount} />
                {workspace === 'cad' && cadBuilding && <span role="status" className="cad-loading">Building solid…</span>}
                {!ready && <div className="render-error" role="status">{error ? 'The UR10e model could not load. Reload the page in a browser with WebGL 2 enabled.' : 'Loading UR10e CAD…'}</div>}
                {workspace === 'inspect' && explosion > 0 && <label className="explosion-slider">Separation <input type="range" aria-label="Part separation" min="0.05" max="1" step="0.01" value={explosion} onChange={(event) => changeExplosion(Number(event.target.value))} /></label>}
                {(workspace === 'inspect' || workspace === 'teach') && isolated && <button className="isolation-chip" onClick={() => setIsolated(null)}><Focus size={13} /> {parts[isolated].name} isolated <X size={13} /></button>}
                <div className="viewport-overlay">
                  <span className="view-label">{viewLabels[view]} <i /> {section.enabled ? 'Section' : workspace === 'service' ? 'Cutaway' : workspace === 'inspect' && wireframe ? 'Wireframe' : 'Solid'}</span>
                  {workspace === 'inspect' && <div className="tool-dock" aria-label="Transform tools">
                    {tools.map(({ id, icon: Icon, label, key }) =>
                      <IconButton key={id} label={`${label} (${key})`} aria-pressed={tool === id} onClick={() => setTool(id)}><Icon size={17} /></IconButton>
                    )}
                    <span className="dock-rule" />
                    <IconButton label="Focus selected (F)" disabled={!ready || !selected} onClick={() => { cameraMoved.current = true; viewport.current?.focus(); setView('orbit') }}><Focus size={17} /></IconButton>
                  </div>}
                </div>
                <div className="orientation" aria-label="Camera views">
                  <svg viewBox="0 0 84 76" aria-hidden="true"><path d="M40 40V15 M40 40L69 49 M40 40L17 61" /><circle cx="40" cy="40" r="3" /></svg>
                  <button className="orient-y" title="Top view" aria-label="Top view" onClick={() => changeView('top')}>Y</button>
                  <button className="orient-x" title="Right view" aria-label="Right view" onClick={() => changeView('right')}>X</button>
                  <button className="orient-z" title="Front view" aria-label="Front view" onClick={() => changeView('front')}>Z</button>
                </div>
                <div className="viewport-hints mouse-hints"><span>Drag <b>Orbit</b></span><i /><span>Scroll <b>Zoom</b></span><i /><span>Right drag <b>Pan</b></span></div>
                <div className="viewport-hints touch-hints"><span>Drag <b>Orbit</b></span><i /><span>Pinch <b>Zoom</b></span><i /><span>2 fingers <b>Pan</b></span></div>
              </div>
            </section>

            {!lowerDockVisible ? null : workspace === 'service' ? <ServiceFooter joint={serviceJoint} /> : <Timeline frame={frame} playing={playing} setFrame={seek}
              setPlaying={(value) => value ? togglePlayback() : setPlaying(false)} lastFrame={lastFrame} canPlay={canPlay}
              trackName={workspace === 'teach' ? 'Taught poses' : workspace === 'pick' ? 'Pick & place' : 'Joint motion'}
              markers={workspace === 'teach' ? taught.map((key) => ({ ...key, name: 'Saved pose' })) : program}
            />}
          </div>

          {inspectorVisible && <div className="dock-splitter" role="separator" aria-orientation="vertical" aria-label="Resize inspector"
            aria-valuemin={sidebarMin} aria-valuemax={sidebarMax} aria-valuenow={sidebarWidth} tabIndex={0}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              splitterDrag.current = { x: event.clientX, width: sidebarWidth }
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={resizeDock}
            onLostPointerCapture={() => { splitterDrag.current = null }}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              setSidebarWidth((width) => clampSidebar(event.key === 'Home' ? sidebarMin : event.key === 'End' ? sidebarMax : width + (event.key === 'ArrowLeft' ? 16 : -16)))
            }}
          />}
          <aside className="sidebar" aria-label="Workbench inspector" hidden={!inspectorVisible}>
            {showViewportPanel && <ViewPanel measure={measure} result={measurement} clearMeasurement={() => viewport.current?.clearMeasurement()} section={section} setSection={setSection} />}
            {workspace === 'cad' && <div className="cad-source section-axes" aria-label="Part source">
              {[['adapter', 'Flange adapter'], ['trace', 'Trace image']].map(([id, label]) =>
                <Button key={id} size="sm" variant="outline" aria-pressed={cadSource === id} onClick={() => setCadSource(id)}>{label}</Button>)}
            </div>}
            {workspace === 'cad' && cadSource === 'adapter' && <CadPanel dimensions={dimensions} onApply={applyDimensions} onExport={exportAdapter}
              building={cadBuilding || !ready} exporting={stepExporting} error={cadError} />}
            {/* Stays mounted so the imported image and point edits survive switching modes. */}
            <div hidden={workspace !== 'cad' || cadSource !== 'trace'}>
              <TracePanel trace={trace} images={traceImages.current} result={traceResult} onChange={changeTrace} onLive={setTrace} onImport={importTraceImage}
                mesh={mesh} onImportMesh={importMesh} onMeshSize={(longest) => placeReference(longest, mesh.visible)} onMeshTurn={turnMesh}
                onMeshVisible={(visible) => { setMesh({ ...mesh, visible }); viewport.current?.setReference(undefined, visible) }} onMeshRemove={removeMesh} onViewsFromMesh={viewsFromMesh}
                onBuild={() => setTraceSpec(traceResult.spec)} onExport={exportAdapter} building={cadBuilding || !ready} exporting={stepExporting}
                error={cadSource === 'trace' ? cadError : ''} upToDate={traceUpToDate && !cadBuilding && !cadError} />
            </div>
            {(workspace === 'teach' || workspace === 'pick') && <ToolFrame values={toolValues} axes={showAxes} setAxes={setShowAxes} pick={workspace === 'pick'} />}
            {workspace === 'teach' && <TeachPanels {...{ pose, setJoint, frame, ready }} keys={taught} onSeek={(at) => { setPlaying(false); seek(at) }} onSave={savePose} onDelete={deletePose} />}
            {workspace === 'pick' && <PickPanel frame={frame} seek={(at) => { setPlaying(false); seek(at) }} />}
            {workspace === 'service' && <ServicePanels joint={serviceJoint} setJoint={setServiceJoint} separation={separation} setSeparation={setSeparation}
              selected={servicePart} changeSelected={setServicePart} hidden={serviceHidden} toggleHidden={(id) => toggle(setServiceHidden, id)} />}
            {workspace === 'inspect' && <>
            <section className="panel hierarchy">
              <div className="panel-heading"><Layers3 size={17} /><h2>Scene Hierarchy</h2><span className="object-count">{meshCount} parts</span></div>
              <div className="tree-scroll">
                <SceneTree nodes={hierarchy} {...{ selected, expanded, hidden, visible }} onSelect={choose}
                  onExpand={(id) => toggle(setExpanded, id)} onVisibility={(id) => {
                    const next = hidden.includes(id) ? hidden.filter((key) => key !== id) : [...hidden, id]
                    recordChange({ type: 'visibility', label: 'part visibility', before: hidden, after: next })
                    setIsolated(null)
                    setHidden(next)
                  }} />
              </div>
            </section>
            <Inspector {...{ selected, transform, viewport, pose, setJoint, isolated, setIsolated }} onSelect={choose} />
            </>}
          </aside>
        </div>

        <footer className="workspace-footer">
          <div className="status-group">
            <span><i className={`footer-dot ${error ? 'error' : !ready || (cadBuilding && isCad) ? 'pending' : ''}`} />{stateLabel}</span>
            <span className="status-context">{isCad ? 'Parametric solid' : workspace === 'service' ? 'Concept drive' : currentPart && workspace === 'inspect' ? currentPart + ' selected' : 'UR10e · 6 axes'}</span>
          </div>
          <div className="status-group">
            <span className="status-platform">{desktop ? 'Desktop' : 'Web'}</span>
            <span>mm</span>
            <a href={sourceUrl} target="_blank" rel="noreferrer">CAD source</a>
          </div>
        </footer>
      </main>

      <dialog ref={dialog} className="help-dialog" onClick={(event) => { if (event.target === dialog.current) dialog.current.close() }}>
        <div className="dialog-content">
          <div className="dialog-heading"><h2>Workbench controls</h2><IconButton label="Close controls" onClick={() => dialog.current.close()}><X size={18} /></IconButton></div>
          <dl>
            <div><dt>Orbit / Pan / Zoom</dt><dd>Drag / Right drag / Scroll</dd></div>
            <div><dt>Select</dt><dd>Click a part or press <kbd>V</kbd></dd></div>
            <div><dt>Move / Rotate / Scale</dt><dd><kbd>G</kbd> <kbd>R</kbd> <kbd>S</kbd></dd></div>
            <div><dt>Frame selected object</dt><dd><kbd>F</kbd></dd></div>
            <div><dt>Play or pause motion</dt><dd><kbd>Space</kbd></dd></div>
            <div><dt>Maximize the viewport</dt><dd><kbd>Shift</kbd> <kbd>Space</kbd></dd></div>
            <div><dt>Undo / Redo</dt><dd><kbd>Ctrl/⌘ Z</kbd> <kbd>Ctrl/⌘ ⇧ Z</kbd></dd></div>
            <div><dt>Open / Save project</dt><dd><kbd>Ctrl/⌘ O</kbd> <kbd>Ctrl/⌘ S</kbd></dd></div>
          </dl>
          <p className="model-credit">CAD kernel <a href="https://github.com/sgenoud/replicad/tree/5e4ad9bb5a35bb9ae0571e91c25fa1897ba0570c" target="_blank" rel="noreferrer">Replicad and Open CASCADE build source</a>. <a href={import.meta.env.BASE_URL + 'licenses/replicad-MIT.txt'} target="_blank" rel="noreferrer">MIT notice</a> · <a href={import.meta.env.BASE_URL + 'licenses/opencascade-LGPL-2.1.txt'} target="_blank" rel="noreferrer">LGPL notice</a>.</p>
          <p className="model-credit">UR10e external meshes and nominal joint frames from <a href={sourceUrl} target="_blank" rel="noreferrer">Universal Robots’ ROS 2 description</a>. <a href={licenseUrl} target="_blank" rel="noreferrer">BSD 3-Clause notice</a>.</p>
          <p className="model-credit">Hand-E visual meshes from <a href={gripperSource} target="_blank" rel="noreferrer">Robotiq’s ROS 2 description</a>. <a href={gripperLicense} target="_blank" rel="noreferrer">BSD 3-Clause notice</a>.</p>
        </div>
      </dialog>
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  )
}
