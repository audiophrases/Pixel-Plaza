import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AvatarEditor from '../components/AvatarEditor';
import type { AvatarConfig } from '../utils/AvatarRenderer';
import { renderGoogleButton } from '../googleIdentity';
import {
  clearStudentSession, exchangeGoogleCredential, fetchStudentConfig,
  fetchStudentProfile, handOffTo, readStudentSession, saveStudentSession
} from '../studentAuth';
import type { StudentConfig, StudentSession } from '../studentAuth';
import { firstName } from '../../shared/names';
import { testerAvatar, testerPin } from '../tester';
import './Login.css';

export default function Login() {
  const [step, setStep] = useState<'details' | 'avatar'>('details');
  const [pin, setPin] = useState('');
  const [session, setSession] = useState<StudentSession | null>(() => {
    // "Not you?" on the teacher's laptop signs out here too.
    if (new URLSearchParams(window.location.search).has('signout')) {
      clearStudentSession();
      history.replaceState(null, '', window.location.pathname);
    }
    return readStudentSession();
  });
  const [config, setConfig] = useState<StudentConfig | null>(null);
  // Saved in the plaza: a returning student walks straight in looking the same.
  const [savedAvatar, setSavedAvatar] = useState<AvatarConfig | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const googleButton = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    void fetchStudentConfig().then(value => { if (active) setConfig(value); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load sign-in settings.'); });
    const saved = readStudentSession();
    if (saved) {
      void fetchStudentProfile(saved.studentToken).then(({ student, avatar }) => {
        if (active) {
          const updated = { ...saved, student };
          saveStudentSession(updated);
          setSession(updated);
          setSavedAvatar(avatar);
        }
      }).catch(() => {
        if (active) { clearStudentSession(); setSession(null); }
      });
    }
    return () => { active = false; };
  }, []);

  // tester.bat: a tester tab goes straight into the class.
  useEffect(() => {
    const pin = testerPin();
    if (pin && session?.studentToken.startsWith('tester:')) {
      navigate('/game', { state: { roomCode: pin, avatarConfig: testerAvatar(session.student.displayName) } });
    }
  }, [session, navigate]);

  useEffect(() => {
    if (step !== 'details' || session || !config?.loginEnabled || !googleButton.current) return;
    let active = true;
    void renderGoogleButton(googleButton.current, config.googleClientId, credential => {
      if (!active) return;
      setBusy(true);
      setError('');
      void exchangeGoogleCredential(credential).then(({ avatar, ...value }) => {
        if (!active) return;
        saveStudentSession(value);
        // The class plays on the teacher's laptop: go straight there.
        if (config.laptopUrl) handOffTo(config.laptopUrl, value);
        else { setSession(value); setSavedAvatar(avatar); }
      }).catch(cause => {
        if (active) setError(cause instanceof Error ? cause.message : 'Google sign-in failed.');
      }).finally(() => { if (active) setBusy(false); });
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Google sign-in could not load.');
    });
    return () => { active = false; };
  }, [config, session, step]);

  // A null avatar keeps the saved one.
  const enter = (avatarConfig: AvatarConfig | null) => {
    if (session) navigate('/game', { state: { roomCode: pin, avatarConfig } });
  };
  const ready = !!session && /^\d{4,8}$/.test(pin);
  const laptopUrl = config?.laptopUrl;
  const signInUrl = config?.signInUrl;
  const signOut = () => {
    clearStudentSession(); setSession(null); setSavedAvatar(null); setStep('details');
    if (signInUrl) window.location.assign(new URL('/?signout', signInUrl));
  };

  return (
    <div className="login-wrapper" style={{ backgroundImage: 'url(/background.jpg)' }}>
      <div className="login-overlay" />
      <main className="login-content">
        <div className="login-brand animate-float">
          <h1 className="heading-pixel login-title">Pixel Plaza</h1>
          <p className="login-subtitle">A social space for English class</p>
        </div>
        <div className="glass-panel login-card">
          {step === 'details' ? (
            <form className="login-form" onSubmit={event => {
              event.preventDefault();
              if (laptopUrl) { if (session) handOffTo(laptopUrl, session); return; }
              if (!ready) return;
              if (savedAvatar) enter(null);
              else setStep('avatar');
            }}>
              <h2 className="card-title">Join your class</h2>
              {!laptopUrl && <div className="input-group">
                <label className="input-label" htmlFor="pin">Class PIN</label>
                <input className="input-field pin-input" id="pin" inputMode="numeric" pattern="[0-9]{4,8}"
                  minLength={4} maxLength={8} autoComplete="off" required value={pin}
                  onChange={event => setPin(event.target.value)} />
              </div>}
              <div className="student-signin">
                {session ? <>
                  <p>Signed in as <strong>{firstName(session.student.displayName)}</strong>
                    {session.student.className ? ` (${session.student.className})` : ''}</p>
                  <button className="link-btn" type="button" onClick={signOut}>Not you? Sign out</button>
                </> : signInUrl ? <>
                  <p>Sign in with your PinPlay Google account on the class website. It brings you back here.</p>
                  <a className="btn btn-primary" href={signInUrl}>Sign in with Google</a>
                </> : <>
                  <p>Sign in with your PinPlay Google account.</p>
                  {!config ? <p>Checking student sign-in…</p> : config.loginEnabled
                    ? <div ref={googleButton} /> : <p>Student sign-in is unavailable. Ask your teacher.</p>}
                </>}
              </div>
              {error && <p role="alert" className="login-error">{error}</p>}
              <button className="btn btn-primary login-btn" type="submit" disabled={!session || busy}>
                {laptopUrl ? 'Go to class' : savedAvatar ? 'Enter the Plaza' : 'Choose your avatar'}
              </button>
              {savedAvatar && !laptopUrl && <button className="link-btn" type="button" disabled={!ready || busy}
                onClick={() => setStep('avatar')}>Change my looks</button>}
            </form>
          ) : <AvatarEditor initialConfig={savedAvatar ?? undefined} onSave={enter} onCancel={() => setStep('details')} />}
          <p className="login-notice">Your teacher can review every message. Messages appear after teacher approval.</p>
          <Link className="teacher-link" to="/teacher">Teacher controls</Link>
        </div>
      </main>
    </div>
  );
}
