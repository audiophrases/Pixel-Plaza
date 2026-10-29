import type { PlayFilter, PlayStats } from '../../shared/activityHistory';
import { playLabel } from '../../shared/activityHistory';
import type { useActivityHistory } from '../useActivityHistory';
import './ActivityHistory.css';

export function PlayBadge({ stats, label = 'activity' }: { stats?: PlayStats; label?: string }) {
    const count = stats?.plays ?? 0;
    const text = playLabel(stats);
    const date = stats?.lastPlayed ? ` Last played ${new Date(stats.lastPlayed).toLocaleDateString()}.` : '';
    return <span className={`activity-play-badge${count ? ' played' : ''}`} aria-label={`${label}: ${text}`}
        title={`${count ? text : 'No recorded plays for this game'}.${date}${stats?.recovered ? ' Recovered from saved progress; earlier plays may not have been saved.' : ''}`}>{text}</span>;
}
export function PlayHistory({ state, filter, onFilter, subject = 'quests' }: {
    state: ReturnType<typeof useActivityHistory>; filter: PlayFilter; onFilter: (filter: PlayFilter) => void; subject?: 'quests' | 'warmup tasks';
}) {
    const { history, scope, setScope, error, reload } = state;
    return <section className="activity-history" aria-label="Play history">
        <div className="activity-history-controls">
            <label>History for<select aria-label="History for game/class" value={scope} onChange={event => setScope(event.target.value)}>
                <option value="current">Current game{scope === 'current' && history?.game ? ` · ${history.game.name}` : ''}</option>
                {state.games.map(game => <option key={game.id} value={game.id}>{game.name}</option>)}
            </select></label>
            <label>Show {subject}<select aria-label="Played history filter" value={filter} disabled={!history?.game} onChange={event => onFilter(event.target.value as PlayFilter)}>
                <option value="all">All</option><option value="never">Never played before</option><option value="played">Played before</option>
            </select></label>
            <button type="button" className="mission-button" onClick={reload}>Refresh history</button>
        </div>
        {error ? <p role="alert">{error}</p> : !history ? <p role="status">Loading play history…</p> : !history.game ? <p>Create or choose a saved game to track its plays.</p> : <details>
            <summary>Recent plays in {history.game.name} ({history.recent.length})</summary>
            <p className="mission-muted">Side quests count once per lesson when play starts. Warm-ups count once per started round.</p>
            <p className="mission-muted">Earlier activity not saved by older versions may be missing.</p>
            {history.recent.length ? <ol>{history.recent.map((play, index) => <li key={`${play.type}:${play.id}:${play.playedAt}:${index}`}>
                <span>{play.type === 'warmup' ? 'Warm-up' : 'Side quest'} · {play.title}</span>
                <small>{play.playedAt ? new Date(play.playedAt).toLocaleString() : 'Date unavailable'}{play.recovered ? ' · recovered record; earlier plays may be missing' : ''}</small>
            </li>)}</ol> : <p>No plays recorded for this game yet.</p>}
        </details>}
    </section>;
}
