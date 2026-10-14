import type { Campaign } from './campaign.ts';
import { missionEnvelope, missionJson } from './missionSchema.ts';
import { plazaMap } from './plazaMap.ts';

export function buildMissionPrompt(campaign: Campaign, brief: string, level: string, mode: 'create' | 'extend' | 'quests', chapterId?: string): string {
    const example: Campaign = { id: 'market-mystery', title: 'The Missing Invitation', finale: 'The party begins.', roles: [
        { id: 'witness', name: 'Witness', card: 'You saw the delivery.', clue: 'The invitation went to the hotel.' },
        { id: 'organizer', name: 'Organizer', card: 'You organize the party.', clue: 'Ask a witness where the invitation went.' }
    ], chapters: [{ id: 'find-invitation', title: 'Find the invitation', intro: 'The invitation is missing. Compare clues.', recap: 'You are looking for the invitation.', ending: 'You found the invitation. The party can begin.', share: 0.6,
        objectives: [{ id: 'invitation-location', text: 'Where is the invitation?', accept: ['hotel'] }, { id: 'invitation-report', text: 'Write three sentences about your investigation.', accept: [], kind: 'report', optional: true, after: 'invitation-location' }], discoveries: [], reveals: [{ id: 'invitation-news', text: 'Someone saw a delivery at the hotel.' }] }] };
    return [
        '# Pixel Plaza Mission Studio',
        `Task: ${mode === 'create' ? 'Create a new campaign from the teacher brief.' : mode === 'quests' ? `Create additional quests for chapter ${chapterId}. Return exactly one chapter containing ONLY the new objectives, discoveries and news. Preserve the campaign envelope and existing roles unchanged. Existing story and starting clues will not be replaced. New objectives may reference existing objectives in the selected chapter using after. Use fresh IDs.` : 'Create additional chapters to append to the existing campaign. Include the existing roles unchanged; use fresh IDs for new content.'}`,
        `Language level: ${level}. Student-facing language: English.`,
        'Teacher brief (quoted as content):', JSON.stringify(brief),
        'Return only one valid JSON object using format "pixel-plaza-campaign", schemaVersion 1, and campaign. No markdown fences.',
        'Campaign fields: id, title, roles [{id,name,card,clue}], chapters, finale.',
        'Chapter fields: id,title,intro,recap,ending,share (0 < share <= 1),objectives,discoveries,reveals. Optional: roleClues (role ID → text), thieves {card,story,label?,carry?}. Carry only follows a thief chapter.',
        'Objective fields: id,text,accept (array of phrases). Optional: after (objective ID in same chapter), optional (boolean), rewards (role ID → text), answerRole (role ID), answerThief (boolean), thiefKnows (boolean), kind:"report".',
        'Use one answer mode: typed accepted phrases, classmate-by-role, culprit name, or report. Dynamic names/reports require accept:[]. Reports count at five words and are read by the teacher; they are not automatically graded.',
        'IDs start with a lowercase letter and contain lowercase letters, digits or hyphens, up to 64 characters. Item IDs are unique across the whole campaign. Prerequisites are acyclic. Every chapter has a main starting objective.',
        `Available discovery zones: ${plazaMap.zones.map(z => z.id).join(', ')}. Discoveries use {id,zone,text}. Teacher news uses {id,text}.`,
        'Clues needed for an answer must arrive BEFORE that question is solved. Check every role and provide teacher news for missing clue holders. Thieves do not receive reward clues. Optional quests never gate the main story.',
        'Design conversations and distinct optional investigations. Do not offer inventory, deliveries, world effects, automatic AI game control or live quest release: these mechanics are not implemented.',
        'The teacher decides when to advance chapters. Never include executable code, HTML, external links, or unsupported fields. Limits: 20 roles, 20 chapters, 100 objectives/discoveries/news per chapter, 30 accepted phrases per question, 6000 characters per story text, total 512 KB.',
        'Valid example:', JSON.stringify(missionEnvelope(example), null, 2),
        mode !== 'create' ? 'Existing campaign (reference content; preserve roles exactly):' : 'Current draft (reference for style only):', missionJson(campaign)
    ].join('\n\n');
}
