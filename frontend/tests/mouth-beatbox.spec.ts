import { expect, test } from '@playwright/test'
import {
  headControl,
  mouthBeat,
  poseFromLandmarks,
} from '../src/components/mouth-beatbox'

test('mouth beat triggers once until the mouth closes', () => {
  expect(mouthBeat(0.4, false)).toEqual({ isOpen: true, beat: true })
  expect(mouthBeat(0.7, true)).toEqual({ isOpen: true, beat: false })
  expect(mouthBeat(0.1, true)).toEqual({ isOpen: false, beat: false })
})

test('head movements cycle instruments and adjust intensity once per gesture', () => {
  const baseline = { nod: 0.7, turn: 0 }
  const previous = headControl({ nod: 0.7, turn: -0.06 }, baseline, null)
  expect(previous.control).toBe('previous')
  expect(headControl({ nod: 0.7, turn: -0.06 }, baseline, previous.active).control).toBeNull()
  expect(headControl({ nod: 0.7, turn: 0.06 }, baseline, previous.active)).toEqual({
    control: 'next',
    active: 'next',
  })
  expect(headControl({ nod: 0.79, turn: 0 }, baseline, null).control).toBe('softer')
  const louder = headControl({ nod: 0.61, turn: 0 }, baseline, null)
  expect(louder).toEqual({ control: 'louder', active: 'louder' })
  expect(headControl({ nod: 0.6, turn: 0 }, baseline, louder.active).control).toBeNull()
  expect(headControl({ nod: 0.7, turn: 0 }, baseline, louder.active).active).toBeNull()
})

test('head pose separates turning from nodding', () => {
  const points: { x: number; y: number }[] = []
  points[33] = { x: 0.4, y: 0.4 }
  points[263] = { x: 0.6, y: 0.5 }
  points[1] = { x: 0.45, y: 0.55 }
  const pose = poseFromLandmarks(points)
  expect(pose?.turn).toBeCloseTo(0)
  expect(pose?.nod).toBeCloseTo(0.5)

  points[33] = { x: 0.4, y: 0.4 }
  points[263] = { x: 0.6, y: 0.4 }
  points[1] = { x: 0.53, y: 0.5 }
  const turn = poseFromLandmarks(points)
  expect(turn?.nod).toBeCloseTo(0.5)
  expect(turn?.turn).toBeCloseTo(0.15)
})
