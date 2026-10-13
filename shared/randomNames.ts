// Fun names for a game where students are not shown by their real names: "Happy Plato", "Brave Hypatia".
// The words come from PinPlay's random-names mode, cut down to ones a class would not tease anyone with:
// adjectives about kindness, courage and fun only (nothing about looks or faults), and names short
// enough to fit on a nameplate. Plain data and functions, so the worker and the tests use the same file.

export const NAME_ADJECTIVES = [
    'Happy', 'Joyful', 'Cheerful', 'Delighted', 'Excited', 'Calm', 'Relaxed', 'Peaceful', 'Focused', 'Driven', 'Patient', 'Brave', 'Fearless', 'Bold',
    'Daring', 'Valiant', 'Curious', 'Clever', 'Sharp', 'Witty', 'Wise', 'Brilliant', 'Creative', 'Playful', 'Friendly', 'Kind', 'Gentle', 'Honest',
    'Loyal', 'Noble', 'Humble', 'Confident', 'Proud', 'Radiant', 'Glorious', 'Heroic', 'Legendary', 'Epic', 'Magnetic', 'Charming', 'Elegant', 'Graceful',
    'Agile', 'Swift', 'Mighty', 'Resilient', 'Steady', 'Dynamic', 'Energetic', 'Electric', 'Fiery', 'Icy', 'Cool', 'Sunny', 'Dreamy', 'Cosmic', 'Golden',
    'Silver', 'Crimson', 'Azure', 'Emerald', 'Ivory', 'Amber', 'Vivid', 'Classic', 'Modern', 'Royal', 'Sincere', 'Thoughtful', 'Helpful', 'Polite',
    'Honorable', 'Passionate', 'Careful', 'Eager', 'Smiling', 'Hopeful', 'Optimistic', 'Funny', 'Goofy', 'Stylish', 'Wacky', 'Zany', 'Silly', 'Cheeky',
    'Giggly', 'Jokey', 'Sporty', 'Funky', 'Quirky', 'Lucky', 'Zen', 'Chill'
];

export const NAME_PEOPLE = [
    'Amir', 'Yasmine', 'Karim', 'Nadia', 'Samir', 'Leila', 'Rachid', 'Salma', 'Amina', 'Youssef', 'Hakim', 'Imane', 'Zineb', 'Omar', 'Anas', 'Soufiane',
    'Hamza', 'Khadija', 'Nabil', 'Meriem', 'Tarik', 'Ayoub', 'Ibtissam', 'Naima', 'Jordi', 'Nuria', 'Pol', 'Laia', 'Marc', 'Jana', 'Pau', 'Berta', 'Sergi',
    'Joan', 'Martina', 'Arnau', 'Aina', 'Ona', 'Mariona', 'Biel', 'Jan', 'Pere', 'Aleix', 'Roser', 'Oriol', 'Mireia', 'Carles', 'Marti', 'Montserrat',
    'Gemma', 'Neus', 'Adria', 'Xavi', 'Ferran', 'Gerard', 'Nil', 'Roc', 'Blai', 'Judit', 'Txell', 'Ariadna', 'Noelia', 'Naiara', 'Clara', 'Nora', 'Helena',
    'Ivet', 'Bruna', 'Queralt', 'Celia', 'Mar', 'Carlota', 'Paula', 'Irene', 'Anna', 'Joana', 'Marta', 'Nerea', 'Laura', 'Alba', 'PauGasol', 'MarcGasol',
    'RickyRubio', 'AlexAbrines', 'AlexCorretja', 'RafaNadal', 'JorgeMartin', 'Puyol', 'Busquets', 'Pique', 'Valdes', 'Iniesta', 'Pedro', 'CescFabregas',
    'SergiRoberto', 'Bojan', 'Muniesa', 'Bartra', 'Deulofeu', 'JoanGarcia', 'DaniOlmo', 'AleixGarcia', 'EricGarcia', 'Cubarsi', 'Luca', 'Giulia',
    'Francesca', 'Marco', 'Alessandro', 'Giovanni', 'Matteo', 'Chiara', 'Elisa', 'Sofia', 'Giorgia', 'Riccardo', 'Davide', 'Federico', 'Paolo', 'Gabriele',
    'Simone', 'Alessia', 'Franco', 'Messi', 'Ronaldo', 'Neymar', 'Mbappe', 'Modric', 'Salah', 'Benzema', 'Lewandowski', 'Pedri', 'Gavi', 'Lamine',
    'Aitana', 'Putellas', 'Bonmati', 'Haaland', 'Bellingham', 'Vinicius', 'Yamal', 'TerStegen', 'Araujo', 'Kounde', 'Balde', 'Raphinha', 'Fermin', 'Olmo',
    'DeJong', 'Ansu', 'Suarez', 'Rakitic', 'Rivaldo', 'Ronaldinho', 'Socrates', 'Plato', 'Aristotle', 'Hypatia', 'Averroes', 'Avicenna', 'Descartes',
    'Spinoza', 'Nietzsche', 'Kant', 'Voltaire', 'Rousseau', 'Confucius', 'Laozi', 'HannahArendt', 'Diogenes', 'Epicurus', 'Zeno', 'Heraclitus',
    'Parmenides', 'Anaxagoras', 'Anaximander', 'Thales', 'Plotinus', 'Boethius', 'Aquinas', 'Ockham', 'Machiavelli', 'Hobbes', 'Locke', 'Hume', 'Berkeley',
    'Leibniz', 'Schopenhauer', 'Kierkegaard', 'Heidegger', 'Sartre', 'Camus', 'Foucault', 'Derrida', 'Deleuze', 'MerleauPonty', 'Wittgenstein', 'Russell',
    'Popper', 'Rawls', 'Nozick', 'Nussbaum', 'Butler', 'Spivak', 'Arendt', 'Buber', 'Jaspers', 'Comte', 'Durkheim', 'Weber', 'Gramsci', 'Benjamin',
    'Adorno', 'Shakespeare', 'Cervantes', 'Dante', 'Homer', 'Virgil', 'Goethe', 'Tolstoy', 'Dostoevsky', 'Proust', 'Kafka', 'Borges', 'Neruda', 'Lorca',
    'Woolf', 'Austen', 'Hemingway', 'Orwell', 'Moliere', 'Balzac', 'UmbertoEco', 'Calvino', 'Pessoa', 'Saramago', 'Murasaki', 'Tagore', 'Byron', 'Keats',
    'Shelley', 'Whitman', 'Dickens', 'Joyce', 'Nabokov', 'Rimbaud', 'Baudelaire', 'Poe', 'Twain', 'Hugo', 'Mozart', 'Beethoven', 'Bach', 'Vivaldi',
    'Chopin', 'Tchaikovsky', 'Ravel', 'Debussy', 'Bizet', 'Verdi', 'Paganini', 'Liszt', 'Mahler', 'Puccini', 'Stravinsky', 'Handel', 'Haydn', 'SaintSaens',
    'Sibelius', 'Grieg', 'Hendrix', 'Clapton', 'Page', 'Gilmour', 'Iommi', 'Santana', 'VanHalen', 'Frusciante', 'Knopfler', 'BrianMay', 'Petrucci', 'Vai',
    'Satriani', 'Malmsteen', 'Hetfield', 'Lennon', 'McCartney', 'Bowie', 'Jagger', 'Plant', 'AxlRose', 'Bono', 'ThomYorke', 'ChrisCornell', 'EddieVedder',
    'Shakira', 'Rihanna', 'Adele', 'Beyonce', 'DuaLipa', 'Rosalia', 'Stromae', 'KarolG', 'EdSheeran', 'Sia', 'Jordan', 'Kobe', 'LeBron', 'Curry', 'Nadal',
    'Federer', 'Djokovic', 'Alcaraz', 'Bolt', 'Phelps', 'Biles', 'Serena', 'Ali', 'Hamilton', 'Verstappen', 'Senna', 'Rafaela', 'Ingebrigtsen', 'Kipchoge',
    'Marquez', 'Rossi', 'Contador', 'Pogacar', 'Evenepoel', 'Ledecky', 'Shiffrin', 'Ohtani', 'Brady', 'Mahomes', 'CaitlinClark', 'Donovan', 'Yulimar',
    'Duplantis', 'NoahLyles', 'SimoneBiles', 'Riner', 'Augustus', 'Hadrian', 'Cleopatra', 'Akbar', 'Saladin', 'Catherine', 'Elizabeth', 'Victoria',
    'Napoleon', 'Charlemagne', 'WuZetian', 'Hatshepsut', 'Cyrus', 'Pericles', 'Leonidas', 'Tutankhamun', 'Nefertiti', 'Isabella', 'Ferdinand', 'Justinian',
    'Constantine', 'Trajan', 'Aurelian', 'Kublai', 'Ashoka', 'Darius', 'Xerxes', 'JuliusCaesar', 'Octavian', 'Theodora', 'Boudica', 'Sejong', 'MansaMusa',
    'Meiji', 'Ivan', 'Suleiman', 'MariaTheresa', 'Sherlock', 'Athena', 'Hermione', 'Frodo', 'Aragorn', 'Legolas', 'Leia', 'Neo', 'Trinity', 'Katniss',
    'Arya', 'Geralt', 'Yennefer', 'Zelda', 'Mario', 'LaraCroft', 'Spock', 'Picard', 'Wednesday', 'Gandalf', 'DarthVader', 'HanSolo', 'TonyStark', 'Batman',
    'HarleyQuinn', 'Spiderman', 'Wolverine', 'MasterChief', 'Ezio', 'Tintin', 'Asterix', 'Obelix', 'Moana', 'Superman', 'WonderWoman', 'Flash', 'Aquaman',
    'GreenLantern', 'ScarletWitch', 'BlackPanther', 'Thor', 'Hulk', 'IronMan', 'BlackWidow', 'Hawkeye', 'AntMan', 'Storm', 'ProfessorX', 'Sonic', 'Tails',
    'Knuckles', 'Pikachu', 'Charizard', 'Mewtwo', 'Link', 'Ganondorf', 'Samus', 'Kirby', 'DonkeyKong', 'Yoshi', 'Bowser', 'Luigi', 'Peach', 'Cloud',
    'Sephiroth', 'Tifa', 'Aerith', 'Sora', 'Dumbledore', 'Snape', 'Voldemort', 'Hagrid', 'RonWeasley', 'LunaLovegood', 'DracoMalfoy', 'SiriusBlack',
    'RemusLupin', 'Bellatrix', 'Eleven', 'JonSnow', 'Daenerys', 'Tyrion', 'Sansa', 'BranStark', 'Cersei', 'TheHound', 'Will', 'Mike', 'Dustin', 'Lucas',
    'Max', 'Billy', 'Hopper', 'Steve', 'Robin', 'Nancy', 'Jonathan', 'Erica', 'Bob', 'Alexei', 'Murray', 'Argyle', 'Eddie', 'Vickie', 'Suzie', 'Grogu',
    'Ahsoka', 'Padme', 'Kenobi', 'Rey', 'Finn', 'PoeDameron', 'KyloRen', 'BoKatan', 'Data', 'SevenOfNine', 'Ripley', 'SarahConnor', 'Ellen',
    'IndianaJones', 'JackSparrow', 'OptimusPrime', 'Dmitri', 'Anastasia', 'Svetlana', 'Mikhail', 'Nikolai', 'Irina', 'Viktor', 'Tatiana', 'Yelena',
    'Sergei', 'Olga', 'Boris', 'Ekaterina', 'Marina', 'Roman', 'Natasha', 'Ilya', 'Yuri', 'Vera', 'Mila', 'Ludmila', 'Stanislav', 'Galina', 'Mateo',
    'Valentina', 'Santiago', 'Camila', 'Thiago', 'Lucia', 'Valeria', 'Diego', 'Emilia', 'Lautaro', 'Antonella', 'Agustin', 'Renata', 'Bruno', 'Gael',
    'Julieta', 'Bianca', 'Enzo', 'Milagros', 'Facundo', 'Thiaguito', 'Benicio', 'Aarav', 'Maya', 'Priya', 'Arjun', 'Noah', 'Liam', 'Emma', 'Olivia', 'Mia',
    'Elena', 'Leo', 'Chloe', 'Zoe', 'Aiko', 'Kenji', 'Fatima', 'Yara', 'Ines', 'Samira', 'Noura', 'Kai', 'Maria', 'Sara', 'Julia', 'Claudia', 'Andrea',
    'Patricia', 'Cristina', 'Silvia', 'Raquel', 'Beatriz', 'Teresa', 'Veronica', 'Eva', 'Miriam', 'Carla', 'Sonia', 'Daniela', 'Juliana', 'Mariana',
    'Gabriela', 'Isabela', 'Catalina', 'Florencia', 'Agustina', 'Pilar', 'Lourdes', 'Alicia', 'Ingrid', 'Natalia', 'Frida', 'Rosalind', 'Ada',
    'MarieCurie', 'Hannah', 'JudithButler', 'AngelaDavis', 'Emmeline', 'RosaParks', 'Malala', 'Rigoberta', 'Greta', 'Amelia', 'SallyRide', 'MaeJemison',
    'AlexMorgan', 'MeganRapinoe', 'LucyBronze', 'AdaHegerberg', 'MartaVieira', 'SamKerr', 'WendieRenard'
];

// Half the names offered are women's, as in PinPlay.
const WOMEN = new Set([
    'yasmine', 'nadia', 'leila', 'salma', 'amina', 'imane', 'zineb', 'khadija', 'meriem', 'ibtissam', 'naima', 'nuria', 'laia', 'jana', 'berta', 'martina',
    'aina', 'ona', 'mariona', 'roser', 'mireia', 'montserrat', 'gemma', 'neus', 'judit', 'txell', 'ariadna', 'clara', 'nora', 'helena', 'ivet', 'bruna',
    'queralt', 'celia', 'mar', 'carlota', 'paula', 'irene', 'anna', 'joana', 'marta', 'nerea', 'laura', 'alba', 'giulia', 'francesca', 'chiara', 'elisa',
    'sofia', 'giorgia', 'alessia', 'hypatia', 'hannaharendt', 'woolf', 'austen', 'murasaki', 'rihanna', 'adele', 'beyonce', 'dualipa', 'rosalia', 'karolg',
    'sia', 'shakira', 'cleopatra', 'catherine', 'elizabeth', 'victoria', 'wuzetian', 'hatshepsut', 'nefertiti', 'isabella', 'theodora', 'boudica',
    'mariatheresa', 'athena', 'hermione', 'leia', 'trinity', 'katniss', 'arya', 'yennefer', 'zelda', 'laracroft', 'wednesday', 'wonderwoman',
    'scarletwitch', 'blackwidow', 'harleyquinn', 'peach', 'tifa', 'aerith', 'lunalovegood', 'bellatrix', 'daenerys', 'sansa', 'cersei', 'ahsoka', 'padme',
    'rey', 'bokatan', 'ripley', 'sarahconnor', 'ellen', 'anastasia', 'svetlana', 'irina', 'tatiana', 'yelena', 'olga', 'ekaterina', 'marina', 'natasha',
    'vera', 'mila', 'ludmila', 'galina', 'valentina', 'camila', 'lucia', 'valeria', 'emilia', 'antonella', 'renata', 'julieta', 'bianca', 'milagros',
    'maya', 'priya', 'emma', 'olivia', 'mia', 'elena', 'chloe', 'zoe', 'aiko', 'fatima', 'yara', 'ines', 'samira', 'noura', 'maria', 'sara', 'julia',
    'claudia', 'andrea', 'patricia', 'cristina', 'silvia', 'raquel', 'beatriz', 'teresa', 'veronica', 'eva', 'miriam', 'noelia', 'carla', 'sonia',
    'daniela', 'juliana', 'mariana', 'gabriela', 'isabela', 'florencia', 'agustina', 'pilar', 'lourdes', 'alicia', 'ingrid', 'natalia', 'frida',
    'rosalind', 'ada', 'mariecurie', 'simone', 'judithbutler', 'angeladavis', 'emmeline', 'rosaparks', 'malala', 'rigoberta', 'greta', 'amelia',
    'sallyride', 'maejemison', 'alexmorgan', 'meganrapinoe', 'lucybronze', 'adahegerberg', 'martavieira', 'samkerr', 'wendierenard', 'max', 'joyce',
    'nancy', 'robin', 'erica', 'vickie', 'suzie', 'eleven'
]);

const pick = <T,>(items: readonly T[], random: () => number): T => items[Math.min(items.length - 1, Math.floor(random() * items.length))];

// A name nobody in `taken` (lower case) has. `random` returns a number in [0, 1).
export function randomName(taken: ReadonlySet<string>, random: () => number = Math.random): string {
    const women = NAME_PEOPLE.filter(person => WOMEN.has(person.toLowerCase()));
    const men = NAME_PEOPLE.filter(person => !WOMEN.has(person.toLowerCase()));
    for (let attempt = 0; attempt < 400; attempt++) {
        const name = `${pick(NAME_ADJECTIVES, random)} ${pick(random() < 0.5 && women.length ? women : men, random)}`;
        if (!taken.has(name.toLowerCase())) return name;
    }
    for (const adjective of NAME_ADJECTIVES) for (const person of NAME_PEOPLE) {
        const name = `${adjective} ${person}`;
        if (!taken.has(name.toLowerCase())) return name;
    }
    return `${NAME_ADJECTIVES[0]} ${NAME_PEOPLE[0]} ${taken.size + 1}`;
}
