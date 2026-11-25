import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Axis3D, Box, CheckCircle2, ChevronDown, ChevronRight, Minus, Move3D, Download, Eye, EyeOff, Layers3, Plus, ScanLine, SlidersHorizontal, Trash2, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { joints } from './robot'
import { driveIndex, drivePieceCount, driveTree } from './drive'
import { gripperSource } from './pick-cell'


function PanelTitle({ icon: Icon, children, aside }) {
  return <div className="panel-heading mode-panel-title"><Icon size={16} /><h2>{children}</h2>{aside && <span className="object-count">{aside}</span>}</div>
}

// A TCP value that can be typed over: Enter moves the arm there, Escape cancels.
function TcpField({ label, unit, value, onCommit }) {
  const [draft, setDraft] = useState(null)
  return (
    <label className="tool-metric editable"><span>{label} <small>{unit}</small></span>
      <input inputMode="decimal" aria-label={'Target ' + label + ' ' + unit} value={draft ?? (value?.toFixed(1) ?? '')}
        onFocus={(event) => event.target.select()} onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const number = Number(draft)
          if (draft !== null && draft.trim() && Number.isFinite(number) && Math.abs(number - value) > 1e-6) onCommit(number)
          setDraft(null)
        }}
        onKeyDown={(event) => { if (event.key === 'Enter') event.target.blur(); if (event.key === 'Escape') { setDraft(null); event.target.blur() } }} />
    </label>
  )
}

export function ToolFrame({ values, axes, setAxes, pick = false, onTarget = null }) {
  return (
    <section className="panel mode-panel">
      <PanelTitle icon={Axis3D}>{pick ? 'Gripper TCP' : 'Tool frame · tool0'}</PanelTitle>
      <div className="mode-panel-body">
        <div className="tool-grid">
          {[[values?.position, 'mm', ['X', 'Y', 'Z'], 'position'], [values?.rotation, '°', ['Rx', 'Ry', 'Rz'], 'rotation']].map(([numbers, unit, labels, kind]) =>
            labels.map((label, index) => onTarget && values
              ? <TcpField key={label} label={label} unit={unit} value={numbers[index]}
                onCommit={(number) => onTarget({ ...values, [kind]: values[kind].map((item, at) => at === index ? number : item) })} />
              : <div className="tool-metric" key={label}>
                <span>{label} <small>{unit}</small></span><strong>{numbers ? numbers[index].toFixed(1) : '—'}</strong>
              </div>),
          )}
        </div>
        <div className="tool-note"><span>{onTarget ? 'Type a value to move the TCP there' : 'Robot base coordinates'}</span>
          <Button size="sm" variant="ghost" className="axes-button" aria-pressed={axes} onClick={() => setAxes(!axes)}><Axis3D size={14} /> Axes</Button>
        </div>
      </div>
    </section>
  )
}

const jogSteps = { position: [1, 10, 50], rotation: [1, 5, 15] }

// A button that acts once on press, then repeats while held. Keyboard presses act once.
// onRepeat gets an id that is the same for every repeat of one press.
let presses = 0
function RepeatButton({ onRepeat, ...props }) {
  const latest = useRef(onRepeat)
  latest.current = onRepeat
  const timer = useRef(null)
  const stop = () => { clearTimeout(timer.current); timer.current = null }
  useEffect(() => stop, [])
  function start(event) {
    if (event.button !== 0) return
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* the pointer may already be gone */ }
    const press = 'jog' + ++presses
    latest.current(press)
    const repeat = (delay) => { timer.current = setTimeout(() => { latest.current(press); repeat(90) }, delay) }
    repeat(380)
  }
  return <Button {...props} onPointerDown={start} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}
    onClick={(event) => { if (event.detail === 0) onRepeat('jog' + ++presses) }} />
}

// Steps the TCP along or about the base or tool axes; inverse kinematics finds the joints.
function TcpJog({ onJog, ready, control, setControl }) {
  const { frame, handle } = control
  const [step, setStep] = useState(1)
  return (
    <section className="panel mode-panel">
      <PanelTitle icon={Move3D}>Move TCP</PanelTitle>
      <div className="mode-panel-body tcp-jog">
        <div className="section-axes trace-mode" aria-label="Jog frame">
          {[['base', 'Base frame'], ['tool', 'Tool frame']].map(([id, label]) =>
            <Button key={id} type="button" size="sm" variant="outline" aria-pressed={frame === id} onClick={() => setControl({ ...control, frame: id })}>{label}</Button>)}
        </div>
        <div className="section-axes" aria-label="Drag handle in the viewport">
          {[['translate', 'Drag to move'], ['rotate', 'Drag to turn'], [null, 'No handle']].map(([id, label]) =>
            <Button key={label} type="button" size="sm" variant="outline" aria-pressed={handle === id} onClick={() => setControl({ ...control, handle: id })}>{label}</Button>)}
        </div>
        <div className="section-axes" aria-label="Jog step">
          {jogSteps.position.map((value, index) => <Button key={value} type="button" size="sm" variant="outline" aria-pressed={step === index} onClick={() => setStep(index)}>
            {value} mm · {jogSteps.rotation[index]}°</Button>)}
        </div>
        <div className="jog-grid">
          {['x', 'y', 'z', 'rx', 'ry', 'rz'].map((axis) => {
            const turning = axis.startsWith('r')
            const amount = jogSteps[turning ? 'rotation' : 'position'][step]
            const name = turning ? 'R' + axis[1] : axis.toUpperCase()
            return (
              <div key={axis} className="jog-row">
                <RepeatButton type="button" size="icon" variant="outline" disabled={!ready} aria-label={'Move ' + name + ' minus ' + amount + (turning ? '°' : ' mm')}
                  onRepeat={(gesture) => onJog({ axis, amount: -amount, gesture })}><Minus size={14} /></RepeatButton>
                <span className={'axis axis-' + axis.at(-1)}>{name}</span>
                <RepeatButton type="button" size="icon" variant="outline" disabled={!ready} aria-label={'Move ' + name + ' plus ' + amount + (turning ? '°' : ' mm')}
                  onRepeat={(gesture) => onJog({ axis, amount, gesture })}><Plus size={14} /></RepeatButton>
              </div>
            )
          })}
        </div>
        <p className="mode-copy">Hold a button to keep moving, or drag the handle on the TCP in the viewport. Inverse kinematics finds the joints; unreachable moves stop at the last reachable pose.</p>
      </div>
    </section>
  )
}

export function TeachPanels({ pose, setJoint, frame, keys, onSave, onDelete, onSeek, onJog, tcpControl, setTcpControl, ready }) {
  const frameIsSaved = keys.some((key) => key.frame === frame)
  return (
    <>
      <TcpJog onJog={onJog} ready={ready} control={tcpControl} setControl={setTcpControl} />
      <section className="panel mode-panel">
        <PanelTitle icon={SlidersHorizontal}>Joint controls</PanelTitle>
        <div className="mode-panel-body joint-console">
          {joints.map(({ joint, limit, name }, index) => (
            <div key={joint}>
              <label htmlFor={'teach-' + joint}><span>{joint} <small>{name}</small></span><output>{pose[index].toFixed(1)}°</output></label>
              <input id={'teach-' + joint} aria-label={joint + ' joint angle'} type="range" min={-limit} max={limit} step="0.5" value={pose[index]}
                onChange={(event) => setJoint(index, Number(event.target.value))} disabled={!ready} />
            </div>
          ))}
        </div>
      </section>
      <section className="panel mode-panel">
        <PanelTitle icon={ScanLine} aside={keys.length + (keys.length === 1 ? ' pose' : ' poses')}>Taught motion</PanelTitle>
        <div className="mode-panel-body">
          <Button className="w-full" onClick={onSave} disabled={!ready}><Plus size={16} /> {frameIsSaved ? 'Update pose' : 'Save pose'} · F{String(frame).padStart(3, '0')}</Button>
          {keys.length === 0
            ? <p className="mode-copy">Adjust the joints and save a pose. Move the playhead to a different frame and save another pose to play a motion.</p>
            : <ol className="pose-list">
              {keys.map((key) => (
                <li key={key.frame} className={key.frame === frame ? 'current' : ''}>
                  <button className="pose-seek" onClick={() => onSeek(key.frame)}><strong>F{String(key.frame).padStart(3, '0')}</strong><span>{key.angles.map((angle) => Number(angle.toFixed(1)) + '°').join(' · ')}</span></button>
                  <Button size="icon" variant="ghost" aria-label={'Delete pose at frame ' + key.frame} onClick={() => onDelete(key.frame)}><Trash2 size={14} /></Button>
                </li>
              ))}
            </ol>}
        </div>
      </section>
    </>
  )
}

const phases = [
  { frame: 0, text: 'Approach tray A' },
  { frame: 30, text: 'Close gripper' },
  { frame: 47, text: 'Lift and transfer' },
  { frame: 119, text: 'Lower into tray B' },
  { frame: 149, text: 'Release workpiece' },
  { frame: 166, text: 'Retract and return' },
]

const seconds = (frame) => (frame / 30).toFixed(1)

function ClearanceReport({ frame, seek, clearance }) {
  if (!clearance || clearance.checking) return <p className="mode-copy">Checking the program for collisions…</p>
  if (clearance.error) return <p className="cad-error" role="alert">Could not check clearance. {clearance.error}</p>
  const { collisions } = clearance
  if (!collisions.length) return <p className="clearance-ok"><CheckCircle2 size={14} /> No collisions with the trays, floor or arm over the whole program.</p>
  const hint = clearance.height > 0 && !clearance.retargeted ? ' Re-solving the joints for the longer tool may clear them.' : ''
  return (
    <>
      <p className="clearance-warning"><AlertTriangle size={14} /> {collisions.length} {collisions.length === 1 ? 'collision' : 'collisions'} in the program.{hint}</p>
      <ul className="phase-list clearance-list">
        {collisions.map((hit) => <li key={hit.what + hit.with + hit.from}>
          <button aria-current={frame >= hit.from && frame <= hit.to ? 'step' : undefined} onClick={() => seek(hit.from)}>
            <i />{hit.what} hits {hit.with}<small>{hit.from === hit.to ? seconds(hit.from) : seconds(hit.from) + '–' + seconds(hit.to)} s</small>
          </button>
        </li>)}
      </ul>
    </>
  )
}

export function PickPanel({ frame, seek, mount, onMount, retarget, onRetarget, clearance }) {
  const active = phases.findLastIndex((phase) => frame >= phase.frame)
  return (
    <section className="panel mode-panel">
      <PanelTitle icon={Box}>Pick &amp; place sequence</PanelTitle>
      <div className="mode-panel-body">
        <ol className="phase-list">
          {phases.map(({ frame, text }, index) =>
            <li key={frame}><button aria-current={active === index ? 'step' : undefined} onClick={() => seek(frame)}><i />{text}<small>{seconds(frame)} s</small></button></li>,
          )}
        </ol>
        <div className="tool-mount">
          <h4>Tool flange</h4>
          <label className="trace-check"><input type="checkbox" checked={mount} onChange={(event) => onMount(event.target.checked)} /> Mount the CAD part between flange and gripper</label>
          {mount && clearance?.missing && <p className="mode-copy">Build the traced part in CAD mode first.</p>}
          {mount && clearance?.height > 0 && <>
            <p className="mode-copy">The {clearance.part} adds {clearance.height.toFixed(1)} mm, so the gripper and TCP sit that much further out.
              {retarget ? '' : ' The taught joint angles are unchanged.'}</p>
            <label className="trace-check"><input type="checkbox" checked={retarget} onChange={(event) => onRetarget(event.target.checked)} /> Re-solve joints so the TCP still reaches the taught points</label>
            {clearance.retargeted && <p className="mode-copy">{clearance.unreached
              ? clearance.unreached + ' keyframe' + (clearance.unreached === 1 ? ' is' : 's are') + ' out of reach with this part; the closest poses are used.'
              : 'Every keyframe re-solved. Largest joint change ' + clearance.largestChange.toFixed(1) + '°.'}</p>}
          </>}
          <ClearanceReport frame={frame} seek={seek} clearance={clearance} />
        </div>
        <p className="mode-copy">Robotiq Hand-E, 50 mm stroke. <a href={gripperSource} target="_blank" rel="noreferrer">Manufacturer CAD source</a></p>
      </div>
    </section>
  )
}

const leafCount = (node) => node.children ? node.children.reduce((sum, child) => sum + leafCount(child), 0) : 1

function DriveTree({ selected, changeSelected, hidden, toggleHidden }) {
  const [expanded, setExpanded] = useState([])
  useEffect(() => {
    if (selected) setExpanded((open) => [...new Set([...open, ...driveIndex[selected].parents])])
  }, [selected])
  const scroller = useRef(null)
  useEffect(() => {
    scroller.current?.querySelector('.tree-row.selected')?.scrollIntoView({ block: 'nearest' })
  }, [selected, expanded])
  function rows(nodes, level) {
    return (
      <ul className="scene-list">
        {nodes.map((node) => {
          const open = expanded.includes(node.id)
          const concealed = hidden.includes(node.id)
          const shown = !concealed && driveIndex[node.id].parents.every((parent) => !hidden.includes(parent))
          return (
            <li key={node.id}>
              <div className={`tree-row ${selected === node.id ? 'selected' : ''} ${shown ? '' : 'concealed'}`} style={{ '--depth': level }}>
                {node.children
                  ? <Button size="icon" variant="ghost" className="tree-toggle" aria-label={(open ? 'Collapse ' : 'Expand ') + node.name} aria-expanded={open}
                    onClick={() => setExpanded((list) => open ? list.filter((id) => id !== node.id) : [...list, node.id])}>{open ? <ChevronDown /> : <ChevronRight />}</Button>
                  : <span className="tree-spacer" />}
                <button className="tree-label" aria-pressed={selected === node.id} onClick={() => changeSelected(selected === node.id ? null : node.id)}>
                  {node.color ? <i className="drive-swatch" style={{ background: node.color }} /> : node.children ? <Layers3 size={14} /> : <Box size={14} />}
                  <span>{node.name}</span>{node.children && <span className="joint-tag">{leafCount(node)}</span>}
                </button>
                <Button size="icon" variant="ghost" className="tree-eye" aria-label={(concealed ? 'Show ' : 'Hide ') + node.name} onClick={() => toggleHidden(node.id)}>
                  {concealed ? <EyeOff /> : <Eye />}
                </Button>
              </div>
              {node.children && open && rows(node.children, level + 1)}
            </li>
          )
        })}
      </ul>
    )
  }
  return <div className="tree-scroll drive-tree" ref={scroller}>{rows(driveTree, 0)}</div>
}

export function ServicePanels({ joint, setJoint, separation, setSeparation, selected, changeSelected, hidden, toggleHidden }) {
  return (
    <>
      <section className="panel mode-panel">
        <PanelTitle icon={Wrench}>Service inspection</PanelTitle>
        <div className="mode-panel-body">
          <p className="service-disclosure">Conceptual internal design. Dimensions and layout are illustrative.</p>
          <span className="vt-label">Joint to inspect</span>
          <div className="service-joints">
            {joints.map(({ joint: axis, name }, index) => <Button key={axis} size="sm" variant="outline" aria-label={axis + ' ' + name} aria-pressed={index === joint} onClick={() => setJoint(index)}>{axis}</Button>)}
          </div>
          <div className="service-range">
            <label htmlFor="drive-separation">Parts separation</label>
            <input id="drive-separation" type="range" min="0" max="1" step="0.01" value={separation} onChange={(event) => setSeparation(Number(event.target.value))} />
          </div>
        </div>
      </section>
      <section className="panel mode-panel">
        <PanelTitle icon={Layers3} aside={drivePieceCount + ' parts'}>Internal components</PanelTitle>
        <div className="mode-panel-body">
          <DriveTree selected={selected} changeSelected={changeSelected} hidden={hidden} toggleHidden={toggleHidden} />
          {selected && <p className="drive-path">{[...driveIndex[selected].parents, selected].map((id) => driveIndex[id].name).join(' › ')}</p>}
          <Button asChild className="w-full scad-download" variant="outline"><a href={import.meta.env.BASE_URL + 'models/concept-joint-drive.scad'} download><Download size={15} /> Download OpenSCAD</a></Button>
        </div>
      </section>
    </>
  )
}

export function ServiceFooter({ joint }) {
  return (
    <section className="panel service-footer">
      <PanelTitle icon={Wrench}>Joint {joints[joint].joint} / {joints[joint].name}</PanelTitle>
      <p>Drag <b>Parts separation</b> past halfway to spread every piece. Click a piece or pick it in the parts list, then press <kbd>F</kbd> to frame it.</p>
    </section>
  )
}
