import { useRef, useState } from 'react'
import { Box, Boxes, ChevronDown, ChevronRight, Eye, EyeOff, Focus, Layers3, Pause, Play, RotateCcw, ScanLine, SkipBack, SkipForward, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { hierarchy, joints } from './robot'
import { fps } from './program'

// The robot's scene hierarchy, the Inspect properties panel and the animation timeline.

function indexTree(nodes, parents = []) {
  const entries = nodes.flatMap((node) => [
    [node.id, { ...node, parents }],
    ...indexTree(node.children ?? [], [...parents, node.id]),
  ])
  return entries
}

export const parts = Object.fromEntries(indexTree(hierarchy))

export function visibleParts(hidden, isolated) {
  return new Set(Object.values(parts).filter(({ id, parents }) => {
    if (isolated) return id === isolated || parents.includes(isolated) || parts[isolated].parents.includes(id)
    return !hidden.includes(id) && parents.every((parent) => !hidden.includes(parent))
  }).map(({ id }) => id))
}

export function IconButton({ label, children, className, ...props }) {
  return <Button size="icon" variant="ghost" aria-label={label} title={label} className={className} {...props}>{children}</Button>
}

export function SceneTree({ nodes, level = 0, selected, expanded, hidden, visible, onSelect, onExpand, onVisibility }) {
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

export function Inspector({ selected, transform, viewport, pose, setJoint, isolated, setIsolated, onSelect }) {
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

export function Timeline({ frame, playing, setFrame, setPlaying, lastFrame, markers, trackName, canPlay }) {
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
