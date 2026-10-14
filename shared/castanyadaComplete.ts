import type { Campaign, Chapter, Objective } from './campaign.ts';

const social = (id: string, text: string, activity: 'interview' | 'exchange', after?: string): Objective => ({
    id, text, accept: [], kind: 'report', optional: true, activity,
    board: { afterMain: true, minPlayers: 2, differentRole: true }, ...(after ? { after } : {}),
});

// Publish as its own template: existing campaign revisions retain their original story.
export function buildCastanyadaComplete(base: Campaign): Campaign {
    const campaign = structuredClone(base);
    campaign.id = 'castanyada-complete';
    campaign.title = 'The Haunted Castanyada: Five Chapters';
    campaign.finale = 'The town celebrates together. You recovered the chestnuts, checked the stories, made a safe festival plan and welcomed the new neighbors. Your investigations helped everyone belong. Happy Castanyada!';

    const [one, two, three] = campaign.chapters;
    three.title = 'The Hotel Cellar';
    three.intro = 'It is late afternoon. You know who took the chestnuts. Find them before the party starts at 6:00!';
    three.ending = 'The chestnuts are safe! The thief wanted a surprise party and says sorry. But the festival plan is missing. Can the town prepare a safe celebration in time?';

    one.objectives.find(o => o.id === 'keys')!.rewards = {
        baker: 'Delivery audit: I ordered paper lanterns, not another box of food. Fair shares: the cafe needs 20 of the 40 chestnuts to roast for guests.',
        shopkeeper: 'Delivery audit: a second parcel had a moon label, not the blue box label. Fair shares: ten children will arrive and each wants one chestnut.',
        driver: 'Delivery audit: I left the moon parcel at the hotel desk at 10:00. Fair shares: I can carry one tray of ten chestnuts at a time.',
        receptionist: 'Delivery audit: the moon parcel contains folded paper and candles. Fair shares: ten new neighbors have been invited to the hotel.',
        planner: 'Delivery audit: the moon parcel is for festival decorations. Fair shares: there are 40 chestnuts in total; every guest should get a fair share.',
    };
    one.objectives.push(
        social('moon-delivery-audit', 'The town needs to know whether a second delivery is connected to the missing chestnuts. Read your Delivery audit note. Interview your assigned partner in English: What arrived? Where did it go? When? Ask one follow-up question. Compare your evidence and write a short delivery record with both findings and anything still uncertain. Useful phrases: "What did you see?" "How do you know?" "So, do we agree that...?"', 'interview'),
        social('fair-chestnut-shares', 'Help the festival committee plan a fair distribution. Read your Fair shares note and ask your partner about their needs. Suggest two ways to share the 40 chestnuts, explain a problem with each, and agree on a plan that uses no more than 40. Write the allocations, one reason and your partner\'s contribution. Useful phrases: "We need... because..." "What if we...?" "Could we agree on...?"', 'exchange', 'moon-delivery-audit'),
    );

    two.objectives.find(o => o.id === 'thief')!.rewards = {
        baker: 'Alibi review: the cafe clock was five minutes slow. Rumor repair: somebody told visitors that everyone in town steals things; that is unfair.',
        shopkeeper: 'Alibi review: my receipt is stamped 9:05 by the shop clock, which was correct. Rumor repair: an open door alone does not prove who entered.',
        driver: 'Alibi review: the truck clock agreed with the shop clock. Rumor repair: I saw someone running, but I did not see what was in their bag.',
        receptionist: 'Alibi review: the hotel bell rings automatically at 9:25, even if nobody is at the desk. Rumor repair: a ringing bell does not prove a receptionist was there.',
        planner: 'Alibi review: my rehearsal list records the band in the square at 9:20. Rumor repair: name a fact, explain your evidence, and avoid blaming people for things you cannot prove.',
    };
    two.objectives.push(
        social('clock-alibi-review', 'The investigation is solved, but the teacher needs a reliable witness record. Read your Alibi review note. Ask your partner which clock or record they used and whether a sound proves a person was present. Explain one apparent contradiction using both notes. Submit the original claim, the evidence and your correction; mark anything you cannot yet verify. Useful phrases: "Which clock did you use?" "That could mean..." "The evidence shows..."', 'interview'),
        social('repair-town-rumor', 'Visitors have heard a damaging rumor. Read your Rumor repair note. Discuss with your partner which claims are facts and which are guesses. Agree on a calm public update that explains one checked fact, corrects one unsupported claim and invites a question. Submit your agreed message and explain what your partner changed. Useful phrases: "We can confirm..." "We cannot be sure about..." "Let\'s change that sentence because..."', 'exchange', 'clock-alibi-review'),
    );

    three.objectives.find(o => o.id === 'why')!.rewards = {
        baker: 'Cellar safety: hot roasting pans must stay away from paper decorations. Restoring trust: the food must be checked before guests eat it.',
        shopkeeper: 'Cellar safety: the moon parcel contains paper lanterns; real flames could burn them. Restoring trust: I want the borrowed key returned.',
        driver: 'Cellar safety: a heavy chestnut sack needs two people to carry it safely. Restoring trust: nobody should carry heavy boxes alone to keep a surprise secret.',
        receptionist: 'Cellar safety: the corridor and both hotel exits must stay clear. Restoring trust: the hotel must know where every delivery is stored.',
        planner: 'Cellar safety: battery lights can replace candles in the lanterns. Restoring trust: a good surprise needs permission and a safe plan.',
    };
    three.objectives.push(
        social('cellar-safety-inspection', 'Before the celebration, investigate two safety risks. Read your Cellar safety note. Interview your partner about their risk, ask what could happen and suggest a safer alternative. Write a two-item inspection with the evidence, a solution and who should handle it. Useful phrases: "What could go wrong?" "Would it be safer to...?" "Who can take responsibility?"', 'interview'),
        social('surprise-trust-agreement', 'The chestnuts were taken for a surprise. How can the town rebuild trust? Read your Restoring trust note. Compare the needs of your two roles, propose conditions for continuing the party and negotiate an agreement. Submit two commitments, one thing you changed after listening and how the agreement makes the surprise safer. Useful phrases: "I understand, but we need..." "I could accept that if..." "We agree to..."', 'exchange', 'cellar-safety-inspection'),
    );

    const four: Chapter = {
        id: 'missing-festival-plan', title: 'The Missing Festival Plan', share: 0.6,
        intro: 'The chestnuts are recovered, but the festival plan has vanished. One poster says "park" and another says "hotel". Find the latest plan, check the rehearsal time and agree on a safe place before the party starts at 6:00.',
        recap: 'Last time: the chestnuts were in the hotel cellar. Now the town needs a reliable festival plan.',
        ending: 'The latest plan puts rehearsal at 5:30 in the hotel hall. Your safety proposal is ready for the committee. But a strange invitation has arrived, and a ghostly sound comes from the park...',
        roleClues: {
            baker: 'The planner borrowed my red folder. A hotel guest returned it to the reception desk.',
            shopkeeper: 'The park poster is an old draft. The red folder contains the signed, latest plan.',
            driver: 'I delivered a red folder to the hotel, not the park.',
            receptionist: 'There is a red folder under the guest book on my hotel desk.',
            planner: 'My latest plan is in a red folder. Ask who received it after I left the cafe.',
        },
        objectives: [
            { id: 'plan-location', text: 'Where is the latest festival plan? Name the building.', accept: ['hotel'], rewards: {
                baker: 'The new plan says the food must be ready at 5:15, before rehearsal.',
                shopkeeper: 'The old poster says rehearsal at 5:00. It is crossed out.',
                driver: 'The new plan says I must deliver the decorations fifteen minutes before the 5:30 rehearsal.',
                receptionist: 'The signed plan says: rehearsal at half past five; party at six.',
                planner: 'The rehearsal starts at 5:30. The party still starts at 6:00.',
            } },
            { id: 'plan-rehearsal', text: 'What time does rehearsal start in the latest plan?', after: 'plan-location', accept: ['5 30', 'five thirty', 'half past five', '17 30'], rewards: {
                baker: 'The food can be served in the hotel hall. The cafe is too small for all the guests.',
                shopkeeper: 'The shop has only one narrow exit. It is not a safe festival room.',
                driver: 'Strong wind is forecast for the park. The hall at the hotel is sheltered.',
                receptionist: 'The hotel hall has two clear exits and enough room for the guests.',
                planner: 'The latest venue must be sheltered and have two clear exits. The park plan is cancelled.',
            } },
            { id: 'plan-venue', text: 'Which building meets the latest safety requirements for the celebration?', after: 'plan-rehearsal', accept: ['hotel'], rewards: {
                baker: 'Planning requirement: put the hot food table away from paper lanterns.',
                shopkeeper: 'Planning requirement: use battery lights; no flames inside paper lanterns.',
                driver: 'Planning requirement: leave a clear route from the delivery door to the food table.',
                receptionist: 'Planning requirement: keep both hotel exits clear.',
                planner: 'Planning requirement: include a welcome space for ten new neighbors and start the party at 6:00.',
            } },
            { id: 'plan-proposal', text: 'Write a proposal for the festival committee. State the venue and rehearsal time, explain two safety arrangements, and name a decision you would discuss with another role. Use your planning requirement and the available clues.', after: 'plan-venue', kind: 'report', accept: [], rewards: {
                baker: 'Poster review: my food list says hotel hall, rehearsal 5:30, party 6:00. Space negotiation: I need a food table away from lanterns.',
                shopkeeper: 'Poster review: I printed an old park poster before the safety change. Space negotiation: visitors need a visible information table.',
                driver: 'Poster review: the delivery note confirms hotel hall at 5:15. Space negotiation: the delivery route cannot cross a queue.',
                receptionist: 'Poster review: the hotel booking confirms rehearsal at 5:30. Space negotiation: neither exit can have a table or a queue in front of it.',
                planner: 'Poster review: my signed plan cancels the park rehearsal and keeps the 6:00 party. Space negotiation: the welcome space must be easy to find for ten new neighbors.',
            } },
            social('festival-poster-review', 'Two posters disagree. Read your Poster review note and interview your partner about the date, source and times in their record. Agree which information belongs on a corrected invitation. Submit the venue, rehearsal time, party time and two sources, explaining why the older poster is misleading. Useful phrases: "Which version is that?" "Does your record confirm...?" "We should correct..."', 'interview'),
            social('festival-space-negotiation', 'Help the committee fit everyone into the hotel hall. Read your Space negotiation note. Explain your needs to your partner, compare two layouts and agree on one compromise that keeps both exits clear. Submit the layout in words, the needs it meets and the compromise each of you made. Useful phrases: "We need space for..." "Could we move...?" "That works if..."', 'exchange', 'festival-poster-review'),
        ],
        discoveries: [
            { id: 'plan-old-poster', zone: 'park', text: 'An old poster says: PARK, REHEARSAL 5:00. Across it someone wrote: OLD DRAFT — CHECK THE RED FOLDER.' },
            { id: 'plan-folder', zone: 'hotel', text: 'Under the guest book: a signed red folder. Latest plan: hotel hall; rehearsal 5:30; party 6:00. Keep both exits clear.' },
        ],
        reveals: [
            { id: 'plan-folder-news', text: 'News: the hotel receptionist found the red folder under the guest book.' },
            { id: 'plan-time-news', text: 'News: the signed plan confirms rehearsal at half past five and the party at six.' },
            { id: 'plan-safety-news', text: 'News: wind makes the park unsuitable. The hotel hall has shelter and two exits.' },
        ],
    };

    const five: Chapter = {
        id: 'haunted-festival', title: 'The Haunted Celebration', share: 0.6,
        intro: 'The hotel hall is ready. Before the celebration, a lantern disappears and a ghostly sound comes from the park. A strange invitation says there are special guests. Investigate the sound, recover the lantern and find out who the surprise is for.',
        recap: 'Last time: you checked the latest festival plan and proposed a safe celebration in the hotel hall.',
        ending: 'The lantern is recovered. The "ghost" was wind through a torn paper lantern, and the surprise is a welcome for the new neighbors. Your explanation and welcome proposal are ready. The town can celebrate together!',
        roleClues: {
            baker: 'The missing lantern was beside the food boxes. The driver moved the boxes past the park.',
            shopkeeper: 'A visitor saw a paper lantern caught on a branch beside the park pond.',
            driver: 'A gust blew the lantern from my cart near the park pond. I could not reach the branch.',
            receptionist: 'No lantern arrived at the hotel. Someone heard the strange sound by the park pond.',
            planner: 'The lantern has a moon on it, just like the parcel from the first delivery investigation. Look near the water.',
        },
        objectives: [
            { id: 'lantern-location', text: 'Where is the missing lantern? Name the place in town.', accept: ['park', 'pond'], rewards: {
                baker: 'The sound stops whenever the air is still.',
                shopkeeper: 'Paper whistles when moving air passes through a small tear.',
                driver: 'A strong gust made the sound louder. There was nobody behind the tree.',
                receptionist: 'A neighbor recorded the noise: it began and ended with each gust of wind.',
                planner: 'The lantern has a tear. Wind through that tear makes the ghostly sound.',
            } },
            { id: 'lantern-sound', text: 'What causes the ghostly sound? Name the natural cause.', after: 'lantern-location', accept: ['wind', 'moving air'], rewards: {
                baker: 'The first line of the invitation says: "A warm welcome..."',
                shopkeeper: 'The next line says: "...to our new neighbors."',
                driver: 'Ten people have recently moved into town. This is their first Castanyada here.',
                receptionist: 'Ten new neighbors are staying at the hotel. They received the moon invitations.',
                planner: 'The surprise is a welcome celebration for the new neighbors, not another theft.',
            } },
            { id: 'festival-special-guests', text: 'Who is the welcome surprise for?', after: 'lantern-sound', accept: ['new neighbors', 'new neighbours', 'new residents', 'new people'], rewards: {
                baker: 'Welcome requirement: explain which food is hot and offer a safe place to eat.',
                shopkeeper: 'Welcome requirement: explain the festival without assuming guests already know its customs.',
                driver: 'Welcome requirement: give clear directions from the entrance to the food and welcome tables.',
                receptionist: 'Welcome requirement: tell guests where the two exits are.',
                planner: 'Welcome requirement: invite guests to choose whether to join an activity; do not make them perform.',
            } },
            { id: 'festival-welcome-proposal', text: 'Write your final message for the committee. Explain the ghostly sound using evidence, identify the special guests and suggest an inclusive welcome action. Say why your action would help a newcomer.', after: 'festival-special-guests', kind: 'report', accept: [], rewards: {
                baker: 'Invitation inquiry: a guest worries that the chestnuts cost money; they are free at this celebration. Welcome negotiation: hot food needs a clear warning and a place to sit.',
                shopkeeper: 'Invitation inquiry: a guest thinks costumes are compulsory; costumes are optional. Welcome negotiation: some visitors need a short explanation of Castanyada.',
                driver: 'Invitation inquiry: a guest does not know the route from the entrance; the welcome table is beside the hotel desk. Welcome negotiation: signs should use short words and clear directions.',
                receptionist: 'Invitation inquiry: a guest worries about not knowing anyone; investigators can introduce themselves at the welcome table. Welcome negotiation: offer company without forcing anyone to join.',
                planner: 'Invitation inquiry: a guest thinks everyone must sing; every activity is optional. Welcome negotiation: let guests choose food, conversation or a quiet seat.',
            } },
            social('strange-invitation-inquiry', 'Make sure the invitation helps its guests. Read your Invitation inquiry note. Ask your partner what their guest misunderstood, why and what would reassure them. Submit two guest questions and clear answers based on both notes. Useful phrases: "What are they worried about?" "Do they have to...?" "We can reassure them that..."', 'interview'),
            social('neighbors-welcome-agreement', 'Create a welcome recommendation for the class. Read your Welcome negotiation note. Compare your needs with your partner, propose two welcome activities and agree on one that guests can choose freely. Submit your recommendation, a sample English welcome message, and the change you made after hearing your partner. Useful phrases: "Would you like to...?" "You can choose..." "Let\'s make sure..."', 'exchange', 'strange-invitation-inquiry'),
        ],
        discoveries: [
            { id: 'festival-torn-lantern', zone: 'park', text: 'A moon lantern is caught beside the pond. Air whistles through a tear in the paper. When the wind stops, the sound stops.' },
            { id: 'festival-moon-invitation', zone: 'hotel', text: 'At the hotel desk: "A warm welcome to our new neighbors! Hotel hall, 6:00. Free chestnuts, optional costumes and activities. Ask at the welcome table if you have a question."' },
        ],
        reveals: [
            { id: 'festival-lantern-news', text: 'News: the missing moon lantern is caught on a tree by the park pond.' },
            { id: 'festival-sound-news', text: 'News: wind whistles through the torn paper. The noise stops when the wind stops.' },
            { id: 'festival-guests-news', text: 'News: the surprise welcomes ten new neighbors to their first Castanyada in town.' },
        ],
    };
    campaign.chapters.push(four, five);
    return campaign;
}
