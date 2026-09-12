import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deleteSavedData,
  getHistory,
  getProfile,
  putProfile,
  type DeleteScope,
  type ProfileKey,
  type ProfileState,
  type SavedTurn,
} from '../lib/savedData'

export function useSavedData() {
  const [profile, setProfile] = useState<ProfileState | null>(null)
  const [history, setHistory] = useState<SavedTurn[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState({ profile: '', history: '' })
  const read = useRef<AbortController | null>(null)
  const mutation = useRef<AbortController | null>(null)

  const refresh = useCallback(() => {
    if (mutation.current) return Promise.resolve()
    read.current?.abort()
    const controller = new AbortController()
    read.current = controller
    return Promise.allSettled([
      getProfile(controller.signal),
      getHistory(controller.signal),
    ]).then(([profileResult, historyResult]) => {
    if (controller.signal.aborted) return
    if (profileResult.status === 'fulfilled') setProfile(profileResult.value)
    if (historyResult.status === 'fulfilled') setHistory(historyResult.value)
    setErrors({
      profile:
        profileResult.status === 'rejected'
          ? 'Die gespeicherten Angaben konnten nicht geladen werden.'
          : '',
      history:
        historyResult.status === 'rejected'
          ? 'Der gespeicherte Verlauf konnte nicht geladen werden.'
          : '',
    })
    setLoading(false)
    })
  }, [])

  useEffect(() => {
    void refresh()
    return () => {
      read.current?.abort()
      mutation.current?.abort()
    }
  }, [refresh])

  function beginMutation() {
    if (mutation.current)
      throw new Error(
        'Bitte warte, bis die laufende Änderung abgeschlossen ist.',
      )
    read.current?.abort()
    const controller = new AbortController()
    mutation.current = controller
    setBusy(true)
    return controller
  }

  function finishMutation(controller: AbortController) {
    if (controller.signal.aborted) return
    mutation.current = null
    setBusy(false)
    void refresh()
  }

  async function save(changes: [ProfileKey, string][]) {
    const controller = beginMutation()
    try {
      let result = profile
      // The API saves one property per request. Refresh even after a partial failure.
      for (const [key, value] of changes) {
        const updated = await putProfile(key, value, controller.signal)
        result = updated
        if (!controller.signal.aborted) setProfile(updated)
      }
      return result
    } finally {
      finishMutation(controller)
    }
  }

  async function erase(scope: DeleteScope, beforeDelete: () => Promise<void>) {
    const controller = beginMutation()
    try {
      await beforeDelete()
      const updated = await deleteSavedData(scope, controller.signal)
      if (controller.signal.aborted) return
      setHistory([])
      if (updated) setProfile(updated)
      setErrors({ profile: '', history: '' })
    } finally {
      finishMutation(controller)
    }
  }

  return { profile, history, loading, busy, errors, refresh, save, erase }
}
