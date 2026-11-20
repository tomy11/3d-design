import { Axis3D, Box, Download, Eye, EyeOff, Layers3, Plus, ScanLine, SlidersHorizontal, Trash2, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { joints } from './robot'
import { driveLayers } from './drive'
import { gripperSource } from './pick-cell'


function PanelTitle({ icon: Icon, children, aside }) {
  return <div className="panel-heading mode-panel-title"><Icon size={16} /><h2>{children}</h2>{aside && <span className="object-count">{aside}</span>}</div>
}

export function ToolFrame({ values, axes, setAxes, pick = false }) {
  return (
    <section className="panel mode-panel">
      <PanelTitle icon={Axis3D}>{pick ? 'Gripper TCP' : 'Tool frame · tool0'}</PanelTitle>
      <div className="mode-panel-body">
        <div className="tool-grid">
          {[[values?.position, 'mm', ['X', 'Y', 'Z']], [values?.rotation, '°', ['Rx', 'Ry', 'Rz']]].map(([numbers, unit, labels]) =>
            labels.map((label, index) => <div className="tool-metric" key={label}>
              <span>{label} <small>{unit}</small></span><strong>{numbers ? numbers[index].toFixed(1) : '—'}</strong>
            </div>),
          )}
        </div>
        <div className="tool-note"><span>Robot base coordinates</span>
          <Button size="sm" variant="ghost" className="axes-button" aria-pressed={axes} onClick={() => setAxes(!axes)}><Axis3D size={14} /> Axes</Button>
        </div>
      </div>
    </section>
  )
}

export function TeachPanels({ pose, setJoint, frame, keys, onSave, onDelete, onSeek, ready }) {
  const frameIsSaved = keys.some((key) => key.frame === frame)
  return (
    <>
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

export function PickPanel({ frame, seek }) {
  const active = phases.findLastIndex((phase) => frame >= phase.frame)
  return (
    <section className="panel mode-panel">
      <PanelTitle icon={Box}>Pick &amp; place sequence</PanelTitle>
      <div className="mode-panel-body">
        <ol className="phase-list">
          {phases.map(({ frame, text }, index) =>
            <li key={frame}><button aria-current={active === index ? 'step' : undefined} onClick={() => seek(frame)}><i />{text}<small>{(frame / 30).toFixed(1)} s</small></button></li>,
          )}
        </ol>
        <p className="mode-copy">Robotiq Hand-E, 50 mm stroke. <a href={gripperSource} target="_blank" rel="noreferrer">Manufacturer CAD source</a></p>
      </div>
    </section>
  )
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
        <PanelTitle icon={Layers3}>Internal components</PanelTitle>
        <div className="mode-panel-body">
          <ul className="drive-list">
            {driveLayers.map(({ id, name, color, detail }) => (
              <li key={id} className={selected === id ? 'active' : ''}>
                <button className="drive-select" aria-pressed={selected === id} onClick={() => changeSelected(selected === id ? null : id)}>
                  <span style={{ background: color }} /><span><strong>{name}</strong><small>{detail}</small></span>
                </button>
                <Button size="icon" variant="ghost" aria-label={(hidden.includes(id) ? 'Show ' : 'Hide ') + name} onClick={() => toggleHidden(id)}>
                  {hidden.includes(id) ? <EyeOff size={15} /> : <Eye size={15} />}
                </Button>
              </li>
            ))}
          </ul>
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
      <p>Use the parts list to show or hide each subassembly. Press <kbd>F</kbd> to frame the selected component.</p>
    </section>
  )
}
