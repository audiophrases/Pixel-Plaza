// Test data only: a frozen copy of the first missions ("Season 1") and the side quest library, taken when they left the
// app's code. The game's missions and library live on the online server, edited in Mission Studio; changing these
// files changes only the tests. The tests load them into each test server through /api/content.
import missions from './season-1.json' with { type: 'json' };
import library from './side-quests.json' with { type: 'json' };

export { missions, library };
const mission = id => missions.find(campaign => campaign.id === id);
export const castanyada = mission('castanyada');
export const castanyadaSideQuests = mission('castanyada-side-quests');
export const castanyadaComplete = mission('castanyada-complete');
export const castanyadaInvestigations = mission('castanyada-investigations');
export const plazaFreePlay = mission('plaza-free-play');
export const sideQuests = library.quests;
export const storyChapters = library.chapters;
export const sideQuestById = id => sideQuests.find(quest => quest.id === id);
