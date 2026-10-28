import type { Campaign, Objective } from './campaign.ts';
import type { MissionOverview } from './missionOverview.ts';
export type MissionDraft = { campaign: Campaign; version: number; publishedRevision: string | null; updated: number; deleted?: boolean };
// A campaign the teacher can start, with enough to choose between them: its chapters in order and what is special about it.
export type CampaignChoice = { id: string; title: string; chapters: string[]; mystery: boolean; partnerQuests: boolean; witnesses: boolean; revision?: string };
export type MissionSummary = { id: string; title: string; version: number; publishedRevision: string | null; updated: number; overview?: MissionOverview };
// A mission as it travels between the teacher's laptop and the online server: the draft as stored (content is its
// JSON), and the published version new games start from. `updated` 0 means nobody has edited it since it arrived.
export type MissionCopy = {
    id: string; content: string; version: number; publishedRevision: string | null; updated: number; created: number; deleted?: boolean;
    revision: { content: string; published: number } | null;
};
// What the online server made of a laptop's copy: kept as the mission ("saved"), or, when the mission had changed
// online too, kept beside it as a new mission marked "(laptop)" ("kept-both").
export type MissionPushResult = { outcome: 'saved' | 'kept-both'; version: number; publishedRevision: string | null; copy?: { id: string; content: string; deleted?: boolean } };
// How the laptop's missions stand with the online server. "home": this is the online server. "signin": the laptop has
// no valid link (sign in on it again). "outdated": the online server does not keep missions yet (deploy it).
export type MissionSync = {
    state: 'home' | 'synced' | 'offline' | 'signin' | 'outdated';
    waiting: number; // missions and side quests changed here and not uploaded yet
    keptBoth: { id: string; copy: string; title: string }[];
    questsKeptBoth?: { id: string; copy: string; title: string }[]; // side quests, likewise; left out when there are none
};
export type LiveMissionTarget = {
    game: { id: string; name: string }; campaign: { id: string; title: string; revision: string };
    chapter: { id: string; title: string; index: number }; version: number; epoch: string; open: boolean; ended: boolean;
    objectiveIds: string[]; additions: { id: string; text: string; withdrawn: boolean; closed?: boolean; started: boolean }[];
};
export type LiveMissionPreview = {
    id: string; game: { id: string; name: string }; chapter: { id: string; title: string }; expires: number;
    quests: { id: string; text: string; activity: string | null; audience: string; eligibleNow: number; definition: Objective }[];
};
export type LiveMissionInspection = { id: string; definition: Objective; sourceId: string; sourceVersion: number; created: number; withdrawn: boolean };
