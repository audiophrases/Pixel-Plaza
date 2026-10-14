import type { Campaign } from './campaign.ts';
export type MissionDraft = { campaign: Campaign; version: number; publishedRevision: string | null; updated: number };
export type MissionSummary = { id: string; title: string; version: number; publishedRevision: string | null; updated: number };
