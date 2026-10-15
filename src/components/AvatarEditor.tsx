import { useState, useEffect, useRef } from 'react';
import { renderAvatarSvg } from '../utils/AvatarRenderer';
import type { AvatarConfig } from '../utils/AvatarRenderer';
import { ENGLISH_VOICES, normalizeVoice } from '../../shared/voices';
import { previewCharacterVoice, stopVoicePreview, unlockSound } from '../audio';
import { readStudentSession } from '../studentAuth';
import './AvatarEditor.css';

interface AvatarEditorProps {
  initialConfig?: Partial<AvatarConfig>;
  onSave: (config: AvatarConfig) => void;
  onCancel?: () => void;
}

export default function AvatarEditor({ initialConfig, onSave, onCancel }: AvatarEditorProps) {
  const [config, setConfig] = useState<AvatarConfig>({
    skin: 0,
    hairColor: 0,
    hair: 0,
    eyes: 0,
    mouth: 0,
    glasses: 0,
    shirt: 0,
    hat: 0,
    ...initialConfig,
    voice: normalizeVoice(initialConfig?.voice)
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
        setCatalog(window.CUP_AVATAR);
        clearInterval(checkCatalog);
      }
    }, 100);
    return () => clearInterval(checkCatalog);
  }, []);

  if (!catalog) return <div className="avatar-loading">Loading Wardrobe...</div>;

  const svgStr = renderAvatarSvg(config);

  const handleChange = (part: Exclude<keyof AvatarConfig, 'voice'>, direction: number) => {
    setConfig(prev => {
      let itemsLength = 1;
      
      if (part === 'skin') itemsLength = catalog.skins.length;
      else if (part === 'hairColor') itemsLength = catalog.hairColors.length;
      else if (catalog.parts[part]) itemsLength = catalog.parts[part].length;

      let newValue = prev[part] + direction;
      if (newValue < 0) newValue = itemsLength - 1;
      if (newValue >= itemsLength) newValue = 0;

      return { ...prev, [part]: newValue };
    });
  };

  const categories = [
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
    <div className="avatar-editor glass-panel">
      <h2 className="heading-pixel">Your Character</h2>
      
      <div className="avatar-preview" dangerouslySetInnerHTML={{ __html: svgStr }} />

      <div className="avatar-controls">
        {categories.map(({ key, label }) => {
          // Skip if part doesn't exist in catalog (like glasses/hats if they are empty)
          if (key !== 'skin' && key !== 'hairColor' && !catalog.parts[key]) return null;
          
          return (
            <div key={key} className="control-row">
              <span className="control-label">{label}</span>
              <div className="control-buttons">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleChange(key, -1)}>◀</button>
                <span className="control-value">{config[key] + 1}</span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleChange(key, 1)}>▶</button>
              </div>
            </div>
          );
        })}
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
        <p>Your messages will be read aloud in this voice.</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void previewVoice()}>
          {previewing ? 'Stop preview' : 'Hear this voice'}
        </button>
        {previewing && <p role="status">Voice preview…</p>}
        {voiceError && <p role="alert" className="character-voice-error">{voiceError}</p>}
      </div>

      <div className="editor-actions">
        {onCancel && <button type="button" className="btn btn-secondary" onClick={() => { stopPreview(); onCancel(); }}>Cancel</button>}
        <button type="button" className="btn btn-primary" onClick={() => { unlockSound(); stopPreview(); onSave(config); }}>Save Character</button>
      </div>
    </div>
  );
}
