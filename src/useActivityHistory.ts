import { useEffect, useState } from 'react';
import type { ActivityHistoryView } from '../shared/activityHistory';

export function useActivityHistory(token: string) {
    const [scope, setScope] = useState('current'), [refresh, setRefresh] = useState(0);
    const [snapshot, setSnapshot] = useState<{ scope: string; token: string; data: ActivityHistoryView } | null>(null);
    const [error, setError] = useState('');
    useEffect(() => {
        if (!token) return;
        let disposed = false, sequence = 0, controller: AbortController | undefined;
        const load = async () => {
            const attempt = ++sequence; controller?.abort(); controller = new AbortController();
            try {
                const response = await fetch(`/api/teacher/activity-history?gameId=${encodeURIComponent(scope)}`, {
                    headers: { 'x-teacher-session': token }, signal: controller.signal });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Could not load play history.');
                if (!disposed && attempt === sequence) { setSnapshot({ scope, token, data: result }); setError(''); }
            } catch (cause) {
                if (!disposed && attempt === sequence && (cause as Error).name !== 'AbortError') {
                    setError(cause instanceof Error ? cause.message : 'Could not load play history.');
                }
            }
        };
        void load();
        const onFocus = () => { if (!document.hidden) void load(); };
        window.addEventListener('focus', onFocus);
        const timer = window.setInterval(onFocus, 15_000);
        return () => { disposed = true; controller?.abort(); window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
    }, [token, scope, refresh]);
    const history = !error && snapshot?.scope === scope && snapshot.token === token ? snapshot.data : null;
    return { history, games: snapshot?.token === token ? snapshot.data.games : [], scope, setScope, error, reload: () => setRefresh(value => value + 1) };
}
