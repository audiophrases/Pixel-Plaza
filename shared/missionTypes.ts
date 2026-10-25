import type { Campaign, Objective } from './campaign.ts';
export type MissionDraft = { campaign: Campaign; version: number; publishedRevision: string | null; updated: number };
// A campaign the teacher can start, with enough to choose between them: its chapters in order and what is special about it.
export type CampaignChoice = { id: string; title: string; chapters: string[]; mystery: boolean; partnerQuests: boolean; witnesses: boolean; revision?: string };
export type MissionSummary = { id: string; title: string; version: number; publishedRevision: string | null; updated: number };
export type LiveMissionTarget = {
    game: { id: string; name: string }; campaign: { id: string; title: string; revision: string };
    chapter: { id: string; title: string; index: number }; version: number; epoch: string; open: boolean; ended: boolean;
    objectiveIds: string[]; additions: { id: string; text: string; withdrawn: boolean; started: boolean }[];
};
export type LiveMissionPreview = {
    id: string; game: { id: string; name: string }; chapter: { id: string; title: string }; expires: number;
    quests: { id: string; text: string; activity: string | null; audience: string; eligibleNow: number; definition: Objective }[];
};
export type LiveMissionInspection = { id: string; definition: Objective; sourceId: string; sourceVersion: number; created: number; withdrawn: boolean };
