import { useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { renderAvatarSvg } from '../utils/AvatarRenderer';
import type { AvatarConfig } from '../utils/AvatarRenderer';
import { ENGLISH_VOICES, isEnglishVoice, normalizeVoice, randomVoice } from '../../shared/voices';
import { previewCharacterVoice, stopVoicePreview, unlockSound } from '../audio';
import { readStudentSession } from '../studentAuth';
import './AvatarEditor.css';

interface AvatarEditorProps {
  initialConfig?: Partial<AvatarConfig>;
  onSave: (config: AvatarConfig) => void;
  onCancel?: () => void;
  mode?: 'student' | 'teacher';
  busy?: boolean;
  children?: ReactNode;
}

// Same combination rules as PinPlay's randomAvatar.
function randomCombination(catalog: any): Omit<AvatarConfig, 'voice'> {
  const pick = (items: unknown[]) => Math.floor(Math.random() * items.length);
  return {
    head: pick(catalog.parts.head), skin: pick(catalog.skins), hairColor: pick(catalog.hairColors),
    hair: pick(catalog.parts.hair), eyes: pick(catalog.parts.eyes), mouth: pick(catalog.parts.mouth),
    shirt: pick(catalog.parts.shirt), glasses: Math.random() < 0.5 ? 0 : pick(catalog.parts.glasses),
    hat: Math.random() < 0.4 ? 0 : pick(catalog.parts.hat)
  };
}

export default function AvatarEditor({ initialConfig, onSave, onCancel, mode = 'student', busy = false, children }: AvatarEditorProps) {
  const [config, setConfig] = useState<AvatarConfig>({
    skin: 0,
    head: 0,
    hairColor: 0,
    hair: 0,
    eyes: 0,
    mouth: 0,
    glasses: 0,
    shirt: 0,
    hat: 0,
    ...initialConfig,
    voice: isEnglishVoice(initialConfig?.voice) ? initialConfig.voice : randomVoice() // a new character does not start on everyone's voice
  });

  const [catalog, setCatalog] = useState<any>(null);
  const [previewing, setPreviewing] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const previewRequest = useRef(0);

  const stopPreview = () => {
    previewRequest.current += 1;
    stopVoicePreview();
    setPreviewing(false);
  };

  useEffect(() => () => {
    previewRequest.current += 1;
    stopVoicePreview();
  }, []);

  const previewVoice = async () => {
    if (previewing) { stopPreview(); return; }
    const session = readStudentSession();
    if (!session) { setVoiceError('Sign in to hear your character voice.'); return; }
    const request = ++previewRequest.current;
    setPreviewing(true);
    setVoiceError('');
    try {
      await previewCharacterVoice(normalizeVoice(config.voice), session.studentToken, session.student.studentKey);
    } catch (cause) {
      if (previewRequest.current === request) {
        setVoiceError(cause instanceof Error ? cause.message : 'Could not play this voice. Try again.');
      }
    } finally {
      if (previewRequest.current === request) setPreviewing(false);
    }
  };

  useEffect(() => {
    // Check if CUP_AVATAR is loaded
    const checkCatalog = setInterval(() => {
      if (window.CUP_AVATAR) {
        const data = window.CUP_AVATAR;
        setCatalog(data);
        if (!initialConfig) setConfig(previous => ({ ...previous, ...randomCombination(data) }));
        clearInterval(checkCatalog);
      }
    }, 100);
    return () => clearInterval(checkCatalog);
  }, [initialConfig]);

  if (!catalog) return <div className="avatar-loading">Loading Wardrobe...</div>;

  const svgStr = renderAvatarSvg(config);

  const handleChange = (part: Exclude<keyof AvatarConfig, 'voice'> | 'character', direction: number) => {
    setConfig(prev => {
      if (part === 'character') {
        const keys = ['head', 'skin', 'hairColor', 'hair', 'eyes', 'mouth', 'shirt', 'glasses', 'hat'] as const;
        const at = catalog.presets.findIndex((preset: { avatar: AvatarConfig }) =>
          keys.every(key => (preset.avatar[key] || 0) === (prev[key] || 0)));
        return { ...prev, ...catalog.presets[(Math.max(0, at) + direction + catalog.presets.length) % catalog.presets.length].avatar, voice: prev.voice };
      }
      let itemsLength = 1;
      
      if (part === 'skin') itemsLength = catalog.skins.length;
      else if (part === 'hairColor') itemsLength = catalog.hairColors.length;
      else if (catalog.parts[part]) itemsLength = catalog.parts[part].length;

      let newValue = (prev[part] || 0) + direction;
      if (newValue < 0) newValue = itemsLength - 1;
      if (newValue >= itemsLength) newValue = 0;

      return { ...prev, [part]: newValue };
    });
  };

  const categories = [
    { key: 'character', label: 'Character' },
    { key: 'head', label: 'Head' },
    { key: 'skin', label: 'Skin Tone' },
    { key: 'hair', label: 'Hair Style' },
    { key: 'hairColor', label: 'Hair Color' },
    { key: 'eyes', label: 'Eyes' },
    { key: 'mouth', label: 'Mouth' },
    { key: 'shirt', label: 'Outfit' },
    { key: 'glasses', label: 'Glasses' },
    { key: 'hat', label: 'Hats' }
  ] as const;

  return (
    <div className="avatar-editor">
      <h2 className="heading-pixel">{mode === 'teacher' ? 'Edit student character' : 'Your Character'}</h2>
      <fieldset className="avatar-editor-fields" disabled={busy}>
      {children}

      {/* As in PinPlay: the character beside a short list of parts, each stepped with ‹ and ›. */}
      <div className="avatar-builder">
        <div className="avatar-side">
          <div className="avatar-preview" dangerouslySetInnerHTML={{ __html: svgStr }} />
          <button type="button" className="btn btn-sm" onClick={() =>
            setConfig(previous => ({ ...previous, ...randomCombination(catalog) }))}>Surprise me</button>
        </div>

        <div className="avatar-controls">
          {categories.map(({ key, label }) => {
            // Skip if part doesn't exist in catalog (like glasses/hats if they are empty)
            if (key !== 'character' && key !== 'skin' && key !== 'hairColor' && !catalog.parts[key]) return null;
            const count = key === 'skin' ? catalog.skins.length : key === 'hairColor' ? catalog.hairColors.length : key === 'character' ? 0 : catalog.parts[key].length;

            return (
              <div key={key} className="control-row">
                <button type="button" className="avatar-step" aria-label={`Previous ${label}`} onClick={() => handleChange(key, -1)}>‹</button>
                <span className="control-label">{label}{key !== 'character' && count > 0 && <small> {(config[key] || 0) + 1}/{count}</small>}</span>
                <button type="button" className="avatar-step" aria-label={`Next ${label}`} onClick={() => handleChange(key, 1)}>›</button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="character-voice">
        <label className="control-label" htmlFor="character-voice">Character voice</label>
        <select id="character-voice" className="input-field" value={config.voice}
          onChange={event => {
            stopPreview();
            setVoiceError('');
            setConfig(previous => ({ ...previous, voice: event.target.value }));
          }}>
          {ENGLISH_VOICES.map(voice => <option key={voice.id} value={voice.id}>
            {voice.label} · {voice.accent}
          </option>)}
        </select>
        <p>{mode === 'teacher' ? 'Their messages will be read aloud in this voice.' : 'Your messages will be read aloud in this voice.'}</p>
        {mode === 'student' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => void previewVoice()}>
          {previewing ? 'Stop preview' : 'Hear this voice'}
        </button>}
        {previewing && <p role="status">Voice preview…</p>}
        {voiceError && <p role="alert" className="character-voice-error">{voiceError}</p>}
      </div>

      <div className="editor-actions">
        {onCancel && <button type="button" className="btn btn-secondary" onClick={() => { stopPreview(); onCancel(); }}>Cancel</button>}
        <button type="button" className="btn btn-primary" onClick={() => { if (mode === 'student') unlockSound(); stopPreview(); onSave(config); }}>{busy ? 'Saving…' : mode === 'teacher' ? 'Save changes' : 'Save Character'}</button>
      </div>
      </fieldset>
    </div>
  );
}
