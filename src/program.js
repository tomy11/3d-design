import { MathUtils } from 'three'
import { joints, keyframes } from './robot'

export const fps = 30
export const teachEnd = 120
const storageKey = 'assembly-lab.ur10e.teach.v1'

export function sampleProgram(keys, frame) {
  if (!keys.length) return keyframes[0].angles
  if (frame <= keys[0].frame) return keys[0].angles
  const next = keys.findIndex((key) => key.frame > frame)
  if (next < 0) return keys.at(-1).angles
  const a = keys[next - 1]
  const b = keys[next]
  const t = (frame - a.frame) / (b.frame - a.frame)
  return a.angles.map((angle, index) => MathUtils.lerp(angle, b.angles[index], t * t * (3 - 2 * t)))
}

export function readTaughtProgram() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    if (!Array.isArray(stored)) return []
    return [...new Map(stored.filter((key) =>
      Number.isInteger(key?.frame) && key.frame >= 0 && key.frame <= teachEnd &&
      Array.isArray(key.angles) && key.angles.length === joints.length &&
      key.angles.every((angle, index) => Number.isFinite(angle) && Math.abs(angle) <= joints[index].limit)
    ).map((key) => [key.frame, { frame: key.frame, angles: key.angles }])).values()].sort((a, b) => a.frame - b.frame)
  } catch {
    return []
  }
}

export function persistTaughtProgram(keys) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(keys))
    return true
  } catch {
    return false
  }
}

// Planar solution for the arm's fixed, downward-facing pick-and-place poses.
function downwardPose(base, height) {
  const upper = 0.6127
  const forearm = 0.57155
  const x = 0.83 + 0.11985
  const y = height - 0.1807 + 0.11655 + 0.1325
  const elbow = Math.acos((x * x + y * y - upper * upper - forearm * forearm) / (2 * upper * forearm))
  const shoulder = Math.atan2(-y, x) - Math.atan2(forearm * Math.sin(elbow), upper + forearm * Math.cos(elbow))
  const lift = MathUtils.radToDeg(shoulder)
  const bend = MathUtils.radToDeg(elbow)
  return [base, lift, bend, 90 - lift - bend, 90, 0]
}

const pickHover = downwardPose(-30, 0.265)
const pickLow = downwardPose(-30, 0.097)
const placeHover = downwardPose(35, 0.265)
const placeLow = downwardPose(35, 0.097)

export const pickProgram = [
  { frame: 0, name: 'Ready', angles: pickHover },
  { frame: 30, name: 'Descend', angles: pickLow },
  { frame: 47, name: 'Grip', angles: pickLow },
  { frame: 78, name: 'Lift', angles: pickHover },
  { frame: 119, name: 'Transfer', angles: placeHover },
  { frame: 149, name: 'Lower', angles: placeLow },
  { frame: 166, name: 'Release', angles: placeLow },
  { frame: 198, name: 'Retract', angles: placeHover },
  { frame: 240, name: 'Ready', angles: pickHover },
]

export function gripAt(frame) {
  return 0.01 * MathUtils.clamp(Math.min((frame - 30) / 17, (166 - frame) / 17), 0, 1)
}
