import { expect, test } from '@playwright/test'
import { mouthBeat } from '../src/components/mouth-beatbox'

test('mouth beat triggers once until the mouth closes', () => {
  expect(mouthBeat(0.4, false)).toEqual({ isOpen: true, beat: true })
  expect(mouthBeat(0.7, true)).toEqual({ isOpen: true, beat: false })
  expect(mouthBeat(0.1, true)).toEqual({ isOpen: false, beat: false })
})
