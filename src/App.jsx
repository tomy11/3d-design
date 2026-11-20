import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Boxes, ChevronDown, ChevronRight, CircleHelp, Download, Eye, EyeOff,
  Focus, Grid2X2, Layers3, Expand, Maximize, MousePointer2, Move, Pause, Play, RotateCcw,
  RotateCw, ScanLine, SkipBack, SkipForward, SlidersHorizontal, Wrench, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { hierarchy, joints, keyframes, licenseUrl, meshCount, sourceUrl } from './robot'
import { fps, persistTaughtProgram, pickProgram, readTaughtProgram, sampleProgram, teachEnd } from './program'
import { PickPanel, ServiceFooter, ServicePanels, TeachPanels, ToolFrame } from './ModePanels'
import { gripperLicense, gripperSource } from './pick-cell'
import { createViewport } from './viewport'

const tools = [
  { id: 'select', icon: MousePointer2, label: 'Select', key: 'V' },
  { id: 'translate', icon: Move, label: 'Move', key: 'G' },
  { id: 'rotate', icon: RotateCw, label: 'Rotate', key: 'R' },
  { id: 'scale', icon: Maximize, label: 'Scale', key: 'S' },
]
const toolKeys = Object.fromEntries(tools.map((tool) => [tool.key.toLowerCase(), tool.id]))
const viewLabels = { perspective: 'Perspective', orbit: 'Perspective', top: 'Top', front: 'Front', right: 'Right' }
const modes = [
  { id: 'inspect', label: 'Inspect', icon: Layers3 },
  { id: 'teach', label: 'Teach Mode', icon: ScanLine },
  { id: 'pick', label: 'Pick & Place', icon: Box },
  { id: 'service', label: 'Service Mode', icon: Wrench },
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
  const viewport = useRef(null)
  const dialog = useRef(null)
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
  const canPlay = ready && workspace !== 'service' && (workspace !== 'teach' || taught.length > 1)
  const pose = useMemo(() => {
    if (workspace === 'service') return servicePose
    return sampleProgram(program, frame).map((angle, index) => overrides[index] ?? angle)
  }, [workspace, servicePose, program, frame, overrides])

  function switchWorkspace(next) {
    if (next === workspace) return
    if (next === 'service') setServicePose(pose)
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
    setTaught(next)
    setOverrides({})
    setNotice(persistTaughtProgram(next) ? `Pose saved at frame ${frame}.` : 'Pose saved for this session. Browser storage is unavailable.')
  }

  function deletePose(at) {
    if (taught.length <= 2) setPlaying(false)
    const next = taught.filter((key) => key.frame !== at)
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
    viewport.current?.setVisibility(workspace === 'pick' || workspace === 'service' ? visibleParts([], null) : visible)
  }, [ready, visible, workspace])
  useEffect(() => { viewport.current?.setWireframe(wireframe && workspace !== 'service') }, [ready, wireframe, workspace])
  useEffect(() => { viewport.current?.setGrid(grid) }, [ready, grid])
  useEffect(() => { viewport.current?.setToolAxes(showAxes) }, [ready, showAxes])
  useEffect(() => {
    if (workspace === 'inspect' && explosion > 0) viewport.current?.setExplosion(explosion, !cameraMoved.current)
  }, [ready, workspace])
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
      if (dialog.current?.open || event.altKey || event.metaKey || event.ctrlKey || event.target.closest('input, select, [role="slider"]')) return
      const key = event.key.toLowerCase()
      if (workspace === 'inspect' && key in toolKeys) setTool(toolKeys[key])
      if (key === 'f') { cameraMoved.current = true; viewport.current?.focus(); setView('orbit') }
      if (key === 'escape') choose(null)
      if (key === ' ' && !event.target.closest('button')) {
        event.preventDefault()
        togglePlayback()
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [canPlay, playing, workspace])

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

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="identity"><span className="brand-icon"><Boxes size={22} strokeWidth={1.8} /></span><span>Assembly<span className="brand-accent">.</span>Lab</span></div>
          <div className="header-divider" />
          <span className="header-context">3D WORKBENCH</span>
          <div className="header-actions">
            <Button variant="ghost" aria-label="Controls" onClick={() => dialog.current.showModal()} className="help-button"><CircleHelp size={17} /><span>Controls</span></Button>
            <Button variant="outline" onClick={exportScene} disabled={!ready || exporting} className="export-button"><Download size={16} /><span>{exporting ? 'Exporting…' : 'Export GLB'}</span></Button>
          </div>
        </div>
      </header>

      <main className="workspace">
        <div className="scene-intro">
          <div>
            <div className="eyebrow"><span /> UNIVERSAL ROBOTS / E-SERIES</div>
            <h1>UR10e Collaborative Robot</h1>
            <p className="spec-line"><span>6 rotary axes</span><i /><span>1,300 mm reach</span><i /><span>{meshCount} CAD parts</span></p>
          </div>
          {workspace !== 'service' && <Button className="primary-play" onClick={togglePlayback} disabled={!canPlay}>
            {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
            {playing ? 'Pause motion' : 'Play motion'}
          </Button>}
        </div>

        <nav className="mode-nav" aria-label="Workbench modes">
          {modes.map(({ id, label, icon: Icon }) => <Button key={id} variant="ghost" aria-pressed={workspace === id} onClick={() => switchWorkspace(id)}><Icon size={16} />{label}</Button>)}
        </nav>

        <div className="workbench">
          <div className="workbench-main">
            <section className="viewport panel" aria-label="3D viewport">
              <div className="viewport-header">
                <div className="viewport-title"><Box size={16} /><h2>3D Viewport</h2></div>
                <div className="viewport-actions">
                  {workspace === 'inspect' && <Button className="explode-button" size="sm" variant="ghost" aria-pressed={explosion > 0} disabled={!ready} onClick={() => changeExplosion(explosion > 0 ? 0 : 1, !cameraMoved.current)}><Expand size={15} /> Explode</Button>}
                  <span className="vertical-rule" />
                  <IconButton label={grid ? 'Hide grid' : 'Show grid'} aria-pressed={grid} onClick={() => setGrid(!grid)}><Grid2X2 size={16} /></IconButton>
                  {workspace === 'inspect' && <IconButton label={wireframe ? 'Switch to solid view' : 'Switch to wireframe'} aria-pressed={wireframe} onClick={() => setWireframe(!wireframe)}><Layers3 size={17} /></IconButton>}
                  <span className="vertical-rule" />
                  <IconButton label="Reset view" onClick={() => changeView('perspective')}><RotateCcw size={16} /></IconButton>
                </div>
              </div>
              <div className="render-area">
                <div className="canvas-mount" ref={mount} />
                {!ready && <div className="render-error" role="status">{error ? 'The UR10e model could not load. Reload the page in a browser with WebGL 2 enabled.' : 'Loading UR10e CAD…'}</div>}
                {workspace === 'inspect' && explosion > 0 && <label className="explosion-slider">Separation <input type="range" aria-label="Part separation" min="0.05" max="1" step="0.01" value={explosion} onChange={(event) => changeExplosion(Number(event.target.value))} /></label>}
                {(workspace === 'inspect' || workspace === 'teach') && isolated && <button className="isolation-chip" onClick={() => setIsolated(null)}><Focus size={13} /> {parts[isolated].name} isolated <X size={13} /></button>}
                <div className="viewport-overlay">
                  <span className="view-label">{viewLabels[view]} <i /> {workspace === 'service' ? 'Cutaway' : workspace === 'inspect' && wireframe ? 'Wireframe' : 'Solid'}</span>
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
                <div className="view-stage"><i /> {error ? 'VIEW UNAVAILABLE' : playing ? 'MOTION RUNNING' : !ready ? 'LOADING CAD' : workspace === 'service' ? 'CONCEPT DRIVE' : 'MODEL READY'}</div>
              </div>
            </section>

            {workspace === 'service' ? <ServiceFooter joint={serviceJoint} /> : <Timeline frame={frame} playing={playing} setFrame={seek}
              setPlaying={(value) => value ? togglePlayback() : setPlaying(false)} lastFrame={lastFrame} canPlay={canPlay}
              trackName={workspace === 'teach' ? 'Taught poses' : workspace === 'pick' ? 'Pick & place' : 'Joint motion'}
              markers={workspace === 'teach' ? taught.map((key) => ({ ...key, name: 'Saved pose' })) : program}
            />}
          </div>

          <aside className="sidebar">
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
                  onExpand={(id) => toggle(setExpanded, id)} onVisibility={(id) => { setIsolated(null); toggle(setHidden, id) }} />
              </div>
            </section>
            <Inspector {...{ selected, transform, viewport, pose, setJoint, isolated, setIsolated }} onSelect={choose} />
            </>}
          </aside>
        </div>

        <footer className="workspace-footer">
          <span><span className="footer-dot" /> {error ? 'Model unavailable' : 'Three.js workbench'}</span>
          <a href={sourceUrl} target="_blank" rel="noreferrer">Manufacturer CAD source</a>
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
          </dl>
          <p className="model-credit">UR10e external meshes and nominal joint frames from <a href={sourceUrl} target="_blank" rel="noreferrer">Universal Robots’ ROS 2 description</a>. <a href={licenseUrl} target="_blank" rel="noreferrer">BSD 3-Clause notice</a>.</p>
          <p className="model-credit">Hand-E visual meshes from <a href={gripperSource} target="_blank" rel="noreferrer">Robotiq’s ROS 2 description</a>. <a href={gripperLicense} target="_blank" rel="noreferrer">BSD 3-Clause notice</a>.</p>
        </div>
      </dialog>
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  )
}
