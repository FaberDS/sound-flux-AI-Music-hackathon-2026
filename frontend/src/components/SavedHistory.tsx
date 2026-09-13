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
        Conversation history{' '}
        <span>
          {turns.length} {turns.length === 1 ? 'message' : 'messages'}
        </span>
      </summary>
      <div className="history-tools">
        <p>Conversations are saved on this device.</p>
        <button onClick={onRefresh} aria-label="Refresh conversation history">
          <RefreshCw size={20} />
          <span>Refresh</span>
        </button>
      </div>
      {loading && (
        <p className="saved-note" role="status">
          Loading conversations …
        </p>
      )}
      {error && (
        <p className="saved-note" role="status">
          {error} Try refreshing your conversation history.
        </p>
      )}
      {!loading && !error && turns.length === 0 && (
        <p className="saved-note">
          No conversations saved yet. Tell Sound Flux about your favorite
          music.
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
              <strong>You</strong>
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
        Manage saved data
      </button>
    </details>
  )
}
