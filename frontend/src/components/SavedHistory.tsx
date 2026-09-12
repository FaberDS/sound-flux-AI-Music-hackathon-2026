import { RefreshCw, Settings2 } from 'lucide-react'
import { historyTime, type SavedTurn } from '../lib/savedData'

export function SavedHistory({
  turns,
  loading,
  error,
  onRefresh,
  onManage,
}: {
  turns: SavedTurn[]
  loading: boolean
  error: string
  onRefresh: () => void
  onManage: () => void
}) {
  return (
    <details className="conversation-history">
      <summary>
        Gesprächsverlauf{' '}
        <span>
          {turns.length} {turns.length === 1 ? 'Nachricht' : 'Nachrichten'}
        </span>
      </summary>
      <div className="history-tools">
        <p>Die Gespräche sind auf diesem Mac gespeichert.</p>
        <button onClick={onRefresh} aria-label="Gesprächsverlauf aktualisieren">
          <RefreshCw size={16} />
        </button>
      </div>
      {loading && (
        <p className="saved-note" role="status">
          Gespräche werden geladen …
        </p>
      )}
      {error && (
        <p className="saved-note" role="status">
          {error} Du kannst den Verlauf erneut laden.
        </p>
      )}
      {!loading && !error && turns.length === 0 && (
        <p className="saved-note">
          Noch keine Gespräche gespeichert. Erzähle Sound Flux von deiner
          Lieblingsmusik.
        </p>
      )}
      <div className="history-content">
        {turns.map((turn) => (
          <article key={turn.turn_id} className="history-turn">
            <time
              dateTime={
                turn.created_at.includes('T')
                  ? turn.created_at
                  : `${turn.created_at.replace(' ', 'T')}Z`
              }
            >
              {historyTime(turn.created_at)}
            </time>
            <p>
              <strong>Du</strong>
              {turn.user}
            </p>
            <p>
              <strong>Sound Flux</strong>
              {turn.assistant}
            </p>
          </article>
        ))}
      </div>
      <button className="manage-history" onClick={onManage}>
        <Settings2 size={16} />
        Gespeicherte Daten verwalten
      </button>
    </details>
  )
}
