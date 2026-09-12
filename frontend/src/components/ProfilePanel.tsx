import { useState, type FormEvent } from 'react'
import {
  Check,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import {
  profileFields,
  profileValues,
  type DeleteScope,
  type ProfileKey,
} from '../lib/savedData'
import type { useSavedData } from '../hooks/useSavedData'

interface Props {
  saved: ReturnType<typeof useSavedData>
  beforeDelete: () => Promise<void>
  onDeleted: () => void
  onEndSession: () => void
}

export function ProfilePanel({
  saved,
  beforeDelete,
  onDeleted,
  onEndSession,
}: Props) {
  const [draft, setDraft] = useState(() => profileValues(saved.profile))
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmation, setConfirmation] = useState<DeleteScope | null>(null)
  const values = profileValues(saved.profile)

  async function save(event: FormEvent) {
    event.preventDefault()
    setError('')
    setNotice('')
    const changes = profileFields
      .filter(({ key }) => draft[key].trim() !== values[key])
      .map(({ key }) => [key, draft[key].trim()] as [ProfileKey, string])
    if (changes.some(([, value]) => !value)) {
      setError(
        'Bitte ersetze die gespeicherte Angabe durch einen neuen Wert. Alle Angaben kannst du unten löschen.',
      )
      return
    }
    try {
      const updated = await saved.save(changes)
      setDraft(profileValues(updated ?? null))
      setNotice('Angaben gespeichert.')
    } catch {
      setError(
        'Speichern nicht abgeschlossen. Prüfe die Verbindung und versuche es erneut. Bereits gespeicherte Änderungen bleiben erhalten.',
      )
    }
  }

  async function erase() {
    if (!confirmation) return
    setError('')
    setNotice('')
    try {
      await saved.erase(confirmation, beforeDelete)
      onDeleted()
      if (confirmation === 'all') setDraft(profileValues(null))
      setNotice(
        confirmation === 'all'
          ? 'Alle gespeicherten Daten gelöscht.'
          : 'Gesprächsverlauf gelöscht. Die Angaben zur Person bleiben erhalten.',
      )
      setConfirmation(null)
    } catch {
      setError(
        'Die Daten konnten nicht gelöscht werden. Prüfe die Verbindung und versuche es erneut.',
      )
    }
  }

  return (
    <>
      <p className="dialog-intro">
        Hier siehst du, was Sound Flux über die Person weiß. Du kannst Angaben
        ergänzen oder korrigieren. Alle Felder sind freiwillig.
      </p>
      {saved.loading && (
        <p className="saved-note" role="status">
          Gespeicherte Angaben werden geladen …
        </p>
      )}
      {saved.errors.profile && (
        <div className="saved-load-error">
          <p>{saved.errors.profile}</p>
          <button onClick={() => void saved.refresh()} disabled={saved.busy}>
            <RefreshCw size={15} />
            Erneut laden
          </button>
        </div>
      )}
      <form onSubmit={save} className="profile-form">
        <fieldset
          disabled={!saved.profile || saved.busy || Boolean(confirmation)}
          className="profile-fields"
        >
          {profileFields.map(
            ({ key, label, question, placeholder, maxLength }) => (
              <label key={key}>
                <span className="profile-field-heading">
                  {question}
                  {values[key] && (
                    <Check size={15} aria-label={`${label} gespeichert`} />
                  )}
                </span>
                {key === 'music_preferences' ? (
                  <textarea
                    value={draft[key]}
                    onChange={(event) =>
                      setDraft({ ...draft, [key]: event.target.value })
                    }
                    maxLength={maxLength}
                    placeholder={placeholder}
                    rows={3}
                    required={Boolean(values[key])}
                  />
                ) : (
                  <input
                    value={draft[key]}
                    onChange={(event) =>
                      setDraft({ ...draft, [key]: event.target.value })
                    }
                    maxLength={maxLength}
                    placeholder={placeholder}
                    autoComplete="off"
                    inputMode={key === 'birth_year' ? 'numeric' : 'text'}
                    pattern={key === 'birth_year' ? '[0-9]{4}' : undefined}
                    required={Boolean(values[key])}
                  />
                )}
              </label>
            ),
          )}
          <button className="dialog-primary" type="submit">
            {saved.busy ? (
              <>
                <LoaderCircle size={18} className="animate-spin" />
                Wird gespeichert …
              </>
            ) : (
              <>
                <Check size={18} />
                Angaben speichern
              </>
            )}
          </button>
        </fieldset>
        <p className="dialog-note">
          <ShieldCheck size={19} />
          Die Angaben und Gespräche werden lokal auf diesem Mac gespeichert und
          bei späteren Gesprächen wieder verwendet.
        </p>
      </form>
      <div className="saved-data-actions">
        <h3>Gespeicherte Daten</h3>
        <p>
          Du kannst nur den Gesprächsverlauf oder alle Daten einschließlich der
          Angaben zur Person löschen.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              setConfirmation('history')
              setError('')
              setNotice('')
            }}
            disabled={saved.busy || Boolean(confirmation)}
          >
            <Trash2 size={15} />
            Verlauf löschen
          </button>
          <button
            onClick={() => {
              setConfirmation('all')
              setError('')
              setNotice('')
            }}
            disabled={saved.busy || Boolean(confirmation)}
          >
            <Trash2 size={15} />
            Alle gespeicherten Daten löschen
          </button>
        </div>
        {confirmation && (
          <div
            className="delete-confirmation"
            role="group"
            aria-label="Löschen bestätigen"
          >
            <p>
              {confirmation === 'all'
                ? 'Alle Gespräche und Angaben zur Person auf diesem Mac endgültig löschen?'
                : 'Alle gespeicherten Gespräche auf diesem Mac endgültig löschen? Die Angaben zur Person bleiben erhalten.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                className="confirm-delete"
                onClick={() => void erase()}
                disabled={saved.busy}
              >
                {saved.busy
                  ? 'Wird gelöscht …'
                  : confirmation === 'all'
                    ? 'Alle Daten endgültig löschen'
                    : 'Verlauf endgültig löschen'}
              </button>
              <button
                onClick={() => setConfirmation(null)}
                disabled={saved.busy}
              >
                Abbrechen
              </button>
            </div>
          </div>
        )}
      </div>
      {error && (
        <p className="error-message mt-4" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="saved-notice" role="status">
          <Check size={17} />
          {notice}
        </p>
      )}
      <button
        className="reset-session"
        onClick={onEndSession}
        disabled={saved.busy}
      >
        <RotateCcw size={16} />
        Sitzung beenden
      </button>
      <p className="session-note">
        Beendet die Wiedergabe und leert die aktuelle Antwort. Gespeicherte
        Daten bleiben erhalten.
      </p>
    </>
  )
}
