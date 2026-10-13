// How a student is shown in the plaza: their first name, plus the start of their surname
// when someone else in the same game has the same first name ("Roger L" and "Roger C").
// Plain functions, no imports, so the worker, the page and the tests all use the same ones.

const words = (full: string) => full.replace(/[^\p{L}\p{N} '-]/gu, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);

// The name as PinPlay gives it, reduced to letters, numbers, spaces, apostrophes and hyphens.
export const cleanName = (full: string) => words(full).join(' ').slice(0, 80);

export const firstName = (full: string) => words(full)[0] ?? 'Student';

// The word after the first name: the first surname in "Roger Lopez Marti", which is the one classmates use.
// (A first name of two words, such as "Joan Carles", would give "Carles" here.)
const surname = (full: string) => words(full)[1] ?? '';

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// Everyone's shown name, given everyone in the game. A first name nobody else shares stays alone.
// Students who share one get the first letter of their surname, and where two surnames start the
// same ("Roger Lopez" and "Roger Lluch") just enough letters to tell those apart.
export function shownNames(people: readonly { key: string; full: string }[]): Map<string, string> {
    const shown = new Map<string, string>();
    const groups = new Map<string, { key: string; full: string }[]>();
    for (const person of people) {
        const group = groups.get(firstName(person.full).toLowerCase()) ?? [];
        group.push(person);
        groups.set(firstName(person.full).toLowerCase(), group);
    }
    for (const group of groups.values()) {
        if (group.length === 1) { shown.set(group[0].key, firstName(group[0].full)); continue; }
        // Each student gets the fewest letters of their surname that no namesake's surname starts with too.
        const label = (person: { full: string }) => {
            const last = surname(person.full);
            if (!last) return firstName(person.full);
            const others = group.filter(other => other.full !== person.full).map(other => surname(other.full).toLowerCase());
            let letters = 1;
            while (letters < last.length && others.some(other => other.startsWith(last.slice(0, letters).toLowerCase()))) letters++;
            return `${firstName(person.full)} ${capital(last.slice(0, letters))}`;
        };
        for (const person of group) shown.set(person.key, label(person));
    }
    return shown;
}
