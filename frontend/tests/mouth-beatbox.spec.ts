import { expect, test } from '@playwright/test'
import {
  handControl,
  headControl,
  mouthBeat,
  poseFromLandmarks,
} from '../src/components/mouth-beatbox'

test('mouth beat triggers once until the mouth closes', () => {
  expect(mouthBeat(0.4, false)).toEqual({ isOpen: true, beat: true })
  expect(mouthBeat(0.7, true)).toEqual({ isOpen: true, beat: false })
  expect(mouthBeat(0.1, true)).toEqual({ isOpen: false, beat: false })
})

test('head nod adjusts intensity once per movement', () => {
  const baseline = { nod: 0.7 }
  const louder = headControl({ nod: 0.61 }, baseline, null)
  expect(headControl({ nod: 0.79 }, baseline, null).control).toBe('softer')
  expect(louder.control).toBe('louder')
  expect(headControl({ nod: 0.6 }, baseline, louder.active).control).toBeNull()
  expect(headControl(baseline, baseline, louder.active).active).toBeNull()
})

test('turning the head does not change its nod control', () => {
  const points: { x: number; y: number }[] = []
  points[33] = { x: 0.4, y: 0.4 }
  points[263] = { x: 0.6, y: 0.5 }
  points[1] = { x: 0.45, y: 0.55 }
  const pose = poseFromLandmarks(points)
  expect(pose?.nod).toBeCloseTo(0.5)

  points[33] = { x: 0.4, y: 0.4 }
  points[263] = { x: 0.6, y: 0.4 }
  points[1] = { x: 0.53, y: 0.5 }
  const turn = poseFromLandmarks(points)
  expect(turn?.nod).toBeCloseTo(0.5)
  expect(headControl(turn!, pose!, null).control).toBeNull()
})

test('each hand lift changes instrument once', () => {
  const landmarks = (left: number, right: number, visibility = 1) => {
    const points: { y: number; visibility: number }[] = []
    for (const [index, y] of [[11, 0.5], [12, 0.5], [15, left], [16, right]])
      points[index] = { y, visibility }
    return points
  }
  const left = handControl(landmarks(0.4, 0.7), null)
  expect(left.control).toBe('previous')
  expect(handControl(landmarks(0.4, 0.7), left.active).control).toBeNull()
  expect(handControl(landmarks(0.7, 0.7), left.active).active).toBeNull()
  expect(handControl(landmarks(0.7, 0.4), null).control).toBe('next')
  expect(handControl(landmarks(0.4, 0.4), null).control).toBeNull()
  expect(handControl(landmarks(0.4, 0.7, 0.4), null).control).toBeNull()
})
