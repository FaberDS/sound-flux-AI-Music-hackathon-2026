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
        'Please replace the saved detail with a new value. You can delete all details below.',
      )
      return
    }
    try {
      const updated = await saved.save(changes)
      setDraft(profileValues(updated ?? null))
      setNotice('Details saved.')
    } catch {
      setError(
        'Saving was not completed. Check the connection and try again. Changes already saved will remain.',
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
          ? 'All saved data deleted.'
          : 'Conversation history deleted. Personal details remain saved.',
      )
      setConfirmation(null)
    } catch {
      setError(
        'The data could not be deleted. Check the connection and try again.',
      )
    }
  }

  return (
    <>
      <p className="dialog-intro">
        Add or update personal details to help Sound Flux choose music.
        Every field is optional.
      </p>
      {saved.loading && (
        <p className="saved-note" role="status">
          Loading saved details …
        </p>
      )}
      {saved.errors.profile && (
        <div className="saved-load-error">
          <p>{saved.errors.profile}</p>
          <button onClick={() => void saved.refresh()} disabled={saved.busy}>
            <RefreshCw size={15} />
            Load again
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
                    <Check size={15} aria-label={`${label} saved`} />
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
                Saving …
              </>
            ) : (
              <>
                <Check size={18} />
                Save details
              </>
            )}
          </button>
        </fieldset>
        <p className="dialog-note">
          <ShieldCheck size={19} />
          Details and conversations are stored locally on this device and used in
          later conversations.
        </p>
      </form>
      <div className="saved-data-actions">
        <h3>Saved data</h3>
        <p>
          You can delete just the conversation history or all data, including
          personal details.
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
            Delete history
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
            Delete all saved data
          </button>
        </div>
        {confirmation && (
          <div
            className="delete-confirmation"
            role="group"
            aria-label="Confirm deletion"
          >
            <p>
              {confirmation === 'all'
                ? 'Permanently delete all conversations and personal details from this device?'
                : 'Permanently delete all saved conversations from this device? Personal details will remain.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                className="confirm-delete"
                onClick={() => void erase()}
                disabled={saved.busy}
              >
                {saved.busy
                  ? 'Deleting …'
                  : confirmation === 'all'
                    ? 'Permanently delete all data'
                    : 'Permanently delete history'}
              </button>
              <button
                onClick={() => setConfirmation(null)}
                disabled={saved.busy}
              >
                Cancel
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
        End session
      </button>
      <p className="session-note">
        Stops playback and clears the current answer. Saved data remains.
      </p>
    </>
  )
}
