import { useCallback, useState } from 'react'
import { checkConnection, preseedOnboarding } from './lib/api'
import { historyTime } from './lib/savedData'
import { useSavedData } from './hooks/useSavedData'
import { useCompanion } from './hooks/useCompanion'

export default function DebugPage() {
  const saved = useSavedData()
  const refreshSaved = saved.refresh
  const [api, setApi] = useState<'unknown' | 'online' | 'offline'>('unknown')
  const [seeding, setSeeding] = useState(false)
  const companion = useCompanion(
    saved.history,
    true,
    0.45,
    refreshSaved,
    saved.profile?.onboarding ?? null,
    '',
  )

  const refresh = useCallback(async () => {
    try {
      await checkConnection(new AbortController().signal)
      setApi('online')
    } catch {
      setApi('offline')
    }
    await refreshSaved()
  }, [refreshSaved])

  async function preseed() {
    setSeeding(true)
    try {
      await preseedOnboarding(new AbortController().signal)
      setApi('online')
      await refreshSaved()
    } catch {
      setApi('offline')
    } finally {
      setSeeding(false)
    }
  }

  return (
    <main className="debug-page">
      <header>
        <div>
          <p>Sound Flux</p>
          <h1>Debug</h1>
        </div>
        <a href="/">Companion öffnen</a>
      </header>
      <section>
        <div className={`debug-status ${api}`}>
          API: {api === 'online' ? 'online' : api === 'offline' ? 'offline' : 'not checked'}
        </div>
        <button onClick={() => void refresh()}>
          Aktualisieren
        </button>
        <button onClick={() => void preseed()} disabled={seeding}>
          {seeding ? 'Wird gefüllt …' : 'Onboarding mit Beispieldaten füllen'}
        </button>
      </section>
      <section>
        <h2>Live-Mikrofon</h2>
        <button
          onClick={() =>
            companion.continuous
              ? void companion.stop()
              : void companion.startConversation()
          }
        >
          {companion.continuous ? 'Gespräch beenden' : 'Start listening'}
        </button>
        <p>Status: {companion.phase}</p>
        {companion.transcript && <p>Du: {companion.transcript}</p>}
        {companion.answer && <p>Begleiter: {companion.answer}</p>}
        {companion.error && <p>{companion.error}</p>}
      </section>
      <section>
        <h2>Profil-Schlüssel</h2>
        {saved.errors.profile ? (
          <p>{saved.errors.profile}</p>
        ) : (
          <table>
            <thead><tr><th>Schlüssel</th><th>Kategorie</th><th>Wert</th></tr></thead>
            <tbody>
              {(saved.profile?.properties ?? []).map((property) => (
                <tr key={property.key}>
                  <td><code>{property.key}</code></td>
                  <td>{property.category}</td>
                  <td>{property.value}</td>
                </tr>
              ))}
              {!saved.loading && !saved.profile?.properties.length && (
                <tr><td colSpan={3}>Noch keine Profilwerte.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </section>
      <section>
        <h2>Chat-Verlauf</h2>
        {saved.errors.history ? (
          <p>{saved.errors.history}</p>
        ) : (
          <table>
            <thead><tr><th>Zeit</th><th>Du</th><th>Modell</th><th>Begleiter</th><th>Dauer</th></tr></thead>
            <tbody>
              {saved.history.map((turn) => (
                <tr key={turn.turn_id}>
                  <td>{historyTime(turn.created_at)}</td>
                  <td>{turn.user}</td>
                  <td>{turn.model || '–'}</td>
                  <td>{turn.assistant}</td>
                  <td>{turn.duration_ms} ms</td>
                </tr>
              ))}
              {!saved.loading && !saved.history.length && (
                <tr><td colSpan={5}>Noch keine gespeicherten Gespräche.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}
