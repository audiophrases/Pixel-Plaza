import type { WarmupKind } from './warmupKinds.ts';
import type { WarmupDefinition } from './warmupConfig.ts';

export type PlayStats = { plays: number; lastPlayed: number | null; recovered: boolean };
export type PlayFilter = 'all' | 'never' | 'played';
export type ActivityPlay = { type: 'quest' | 'warmup'; id: string; title: string; playedAt: number | null; recovered: boolean };
export type ActivityHistoryView = {
    game: { id: string; name: string } | null;
    games: { id: string; name: string }[];
    quests: Record<string, PlayStats>;
    warmups: Partial<Record<WarmupKind, PlayStats>>;
    tasks: Partial<Record<WarmupKind, Record<string, PlayStats>>>;
    recent: ActivityPlay[];
};
export const matchesPlayFilter = (stats: PlayStats | undefined, filter: PlayFilter): boolean =>
    filter === 'all' || (filter === 'never' ? !stats?.plays : !!stats?.plays);
export const playLabel = (stats?: PlayStats): string => !stats?.plays ? 'Never played'
    : `${stats.plays}${stats.recovered ? '+' : ''} ${stats.plays === 1 && !stats.recovered ? 'play' : 'plays'}`;
// Pair order and superficial spacing do not make a previously played task new.
export const pairTaskId = (pair: readonly string[]) => JSON.stringify(pair.map(word => word.trim().toLowerCase().replace(/\s+/g, ' ')).sort());
export function assignedWarmupTasks(definition: WarmupDefinition, players: { fact: string; targets: string[] }[]): { id: string; title: string }[] {
    const facts = new Set(players.map(player => player.fact));
    if (definition.kind === 'identity') return definition.identities.filter(identity => facts.has(identity.id)).map(identity => ({ id: identity.id, title: identity.name }));
    if (definition.kind === 'facts') {
        for (const player of players) for (const target of player.targets) facts.add(target);
        return definition.facts.filter(fact => facts.has(fact.id)).map(fact => ({ id: fact.id, title: `Find someone who ${fact.find}` }));
    }
    return definition.pairs.filter(pair => pair.some(word => facts.has(word))).map(pair => ({ id: pairTaskId(pair), title: pair.join(' ↔ ') }));
}
