import type { TextHelp } from '../../shared/campaign';
import './LanguageHelp.css';

export default function LanguageHelp({ help, answer = false }: { help?: TextHelp; answer?: boolean }) {
    if (!help?.ca?.trim()) return null;
    return <details key={help.ca} className="language-help" lang="ca">
        <summary>Ajuda en català</summary>
        <p>{help.ca}</p>
        {answer && <small>Parla amb els companys i respon en anglès.</small>}
    </details>;
}
