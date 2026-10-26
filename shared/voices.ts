// English character voices reused from audiophrases/pinplay app.js at
// 876da8b7938beabee868c7f8e1a5fd0bea7f1fe0. Keep the allowlist shared by UI and server.
export type EnglishVoice = Readonly<{ id: string; label: string; accent: string }>;

export const DEFAULT_VOICE: string = 'en-GB-SoniaNeural';

export const ENGLISH_VOICES: readonly EnglishVoice[] = [
    { id: 'en-US-AndrewMultilingualNeural', label: 'Andrew (multilingual)', accent: 'United States' },
    { id: 'en-US-AvaMultilingualNeural', label: 'Ava (multilingual)', accent: 'United States' },
    { id: 'en-US-EmmaMultilingualNeural', label: 'Emma (multilingual)', accent: 'United States' },
    { id: 'en-US-BrianMultilingualNeural', label: 'Brian (multilingual)', accent: 'United States' },
    { id: 'en-US-AndrewNeural', label: 'Andrew', accent: 'United States' },
    { id: 'en-US-AvaNeural', label: 'Ava', accent: 'United States' },
    { id: 'en-US-EmmaNeural', label: 'Emma', accent: 'United States' },
    { id: 'en-US-BrianNeural', label: 'Brian', accent: 'United States' },
    { id: 'en-GB-RyanNeural', label: 'Ryan', accent: 'United Kingdom' },
    { id: 'en-GB-SoniaNeural', label: 'Sonia', accent: 'United Kingdom' },
    { id: 'en-AU-WilliamNeural', label: 'William', accent: 'Australia' },
    { id: 'en-AU-NatashaNeural', label: 'Natasha', accent: 'Australia' },
    { id: 'en-CA-LiamNeural', label: 'Liam', accent: 'Canada' },
    { id: 'en-CA-ClaraNeural', label: 'Clara', accent: 'Canada' },
    { id: 'en-IN-PrabhatNeural', label: 'Prabhat', accent: 'India' },
    { id: 'en-IN-NeerjaNeural', label: 'Neerja', accent: 'India' },
    { id: 'en-IE-ConnorNeural', label: 'Connor', accent: 'Ireland' },
    { id: 'en-IE-EmilyNeural', label: 'Emily', accent: 'Ireland' },
    { id: 'en-SG-WayneNeural', label: 'Wayne', accent: 'Singapore' },
    { id: 'en-SG-LunaNeural', label: 'Luna', accent: 'Singapore' },
    { id: 'en-HK-SamNeural', label: 'Sam', accent: 'Hong Kong' },
    { id: 'en-HK-YanNeural', label: 'Yan', accent: 'Hong Kong' },
    { id: 'en-KE-ChilembaNeural', label: 'Chilemba', accent: 'Kenya' },
    { id: 'en-KE-AsiliaNeural', label: 'Asilia', accent: 'Kenya' },
    { id: 'en-NG-AbeoNeural', label: 'Abeo', accent: 'Nigeria' },
    { id: 'en-NG-EzinneNeural', label: 'Ezinne', accent: 'Nigeria' },
    { id: 'en-NZ-MitchellNeural', label: 'Mitchell', accent: 'New Zealand' },
    { id: 'en-NZ-MollyNeural', label: 'Molly', accent: 'New Zealand' },
    { id: 'en-PH-JamesNeural', label: 'James', accent: 'Philippines' },
    { id: 'en-PH-RosaNeural', label: 'Rosa', accent: 'Philippines' },
    { id: 'en-TZ-ElimuNeural', label: 'Elimu', accent: 'Tanzania' },
    { id: 'en-TZ-ImaniNeural', label: 'Imani', accent: 'Tanzania' },
    { id: 'en-ZA-LukeNeural', label: 'Luke', accent: 'South Africa' },
    { id: 'en-ZA-LeahNeural', label: 'Leah', accent: 'South Africa' },
];

const englishVoiceIds = new Set(ENGLISH_VOICES.map(voice => voice.id));

export function isEnglishVoice(value: unknown): value is string {
    return typeof value === 'string' && englishVoiceIds.has(value);
}

export function normalizeVoice(value: unknown): string {
    return isEnglishVoice(value) ? value : DEFAULT_VOICE;
}

// A voice for a student who has not chosen one: picked from who they are, so it is the same in every lesson,
// and spread over all the voices, so a class does not all sound alike.
export function voiceFor(studentKey: string): string {
    let hash = 0;
    for (const char of studentKey) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return ENGLISH_VOICES[hash % ENGLISH_VOICES.length].id;
}

// Any voice, for a new character on the character screen.
export const randomVoice = (): string => ENGLISH_VOICES[Math.floor(Math.random() * ENGLISH_VOICES.length)].id;

