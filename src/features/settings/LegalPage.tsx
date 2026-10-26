/** Renders the app's legal copy (illtip-mobile/src/content/legal, copied verbatim into ./legal) like LegalDocumentScreen. */
import React, { useMemo } from 'react';
import { PageHeader } from '../../ui/kit';
import { Link } from '../../lib/router';
import { EULA_CONTENT, EULA_DOCUMENT_TITLE } from './legal/eulaContent';
import { PRIVACY_NOTICE_CONTENT, PRIVACY_NOTICE_DOCUMENT_TITLE } from './legal/privacyNoticeContent';
import { TERMS_AND_CONDITIONS_CONTENT, TERMS_AND_CONDITIONS_DOCUMENT_TITLE } from './legal/termsAndConditionsContent';
import { splitLegalDocument } from './legal/splitLegalDocument';

export type LegalKind = 'terms' | 'privacy' | 'eula';

const DOCS: Record<LegalKind, { title: string; docTitle: string; content: string; path: string }> = {
  terms: { title: 'Terms & Conditions', docTitle: TERMS_AND_CONDITIONS_DOCUMENT_TITLE, content: TERMS_AND_CONDITIONS_CONTENT, path: '/settings/terms' },
  privacy: { title: 'Privacy Policy', docTitle: PRIVACY_NOTICE_DOCUMENT_TITLE, content: PRIVACY_NOTICE_CONTENT, path: '/settings/privacy' },
  eula: { title: 'EULA', docTitle: EULA_DOCUMENT_TITLE, content: EULA_CONTENT, path: '/settings/eula' },
};

const SPLIT = /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|https?:\/\/[^\s<>"'）)]+[^\s<>"'）. ,;:!?)）]|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;
const MD_LINK = /^\[([^\]]+)\]\(([^)]+)\)$/;
const URL_RE = /^https?:\/\//i;
const EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const LIST_PREFIX = /^((?:\d+\.)+\d*\.?|\([a-z0-9]+\)|•)\s+/i;

function rich(text: string): React.ReactNode[] {
  return text
    .split(SPLIT)
    .filter((p) => p.length > 0)
    .map((part, i) => {
      const b = /^\*\*([^*]+)\*\*$/.exec(part);
      if (b) return <strong key={i}>{b[1]}</strong>;
      const md = MD_LINK.exec(part);
      const href = md ? md[2] : URL_RE.test(part) ? part : EMAIL_RE.test(part) ? `mailto:${part}` : '';
      if (href)
        return (
          <a key={i} href={href} target={href.startsWith('mailto:') ? undefined : '_blank'} rel="noreferrer noopener">
            {md ? md[1] : part}
          </a>
        );
      return <React.Fragment key={i}>{part}</React.Fragment>;
    });
}

function nestedIndent(explicit: number, plain: string) {
  if (explicit > 0) return explicit;
  const s = plain.trimStart();
  if (/^\d+\.\d+/.test(s) || /^\([a-z0-9]+\)/i.test(s) || /^•/.test(s)) return 1;
  return 0;
}

function Paragraph({ text }: { text: string }) {
  const m = /^\[\[i:(\d+)\]\]/.exec(text);
  const body = m ? text.slice(m[0].length) : text;
  const indent = nestedIndent(m ? Number(m[1]) : 0, body.replace(/\*\*/g, ''));
  const style = indent ? { paddingLeft: 20 * indent } : undefined;
  if (/Page\s+\d+\s+of\s+\d+/i.test(body.replace(/\*\*/g, ''))) return <p className="st-legal-foot">{rich(body)}</p>;
  const pre = LIST_PREFIX.exec(body);
  if (pre) {
    const isHeading = /^\d+\.$/.test(pre[1]) && body.length < 140;
    return (
      <div className={'st-legal-li' + (isHeading ? ' st-legal-h' : '')} style={style}>
        <span className="st-legal-num">{pre[1]}</span>
        <span>{rich(body.slice(pre[0].length))}</span>
      </div>
    );
  }
  return (
    <p style={style} className="st-legal-p">
      {rich(body)}
    </p>
  );
}

export function LegalPage({ kind }: { kind: LegalKind }) {
  const doc = DOCS[kind];
  const paras = useMemo(() => splitLegalDocument(doc.content), [doc.content]);
  return (
    <div className="st">
      <PageHeader title={doc.title} back="/settings" />
      <div className="chips st-legal-tabs">
        {(Object.keys(DOCS) as LegalKind[]).map((k) => (
          <Link key={k} to={DOCS[k].path} className={'chip' + (k === kind ? ' active' : '')}>
            {DOCS[k].title}
          </Link>
        ))}
      </div>
      <article className="card st-legal">
        <div className="st-legal-logo">
          <img src="logo.png" alt="" />
        </div>
        <h2 className="st-legal-title">{doc.docTitle}</h2>
        {paras.map((p, i) => (
          <Paragraph key={i} text={p} />
        ))}
      </article>
    </div>
  );
}

export const TermsPage = () => <LegalPage kind="terms" />;
export const PrivacyPage = () => <LegalPage kind="privacy" />;
export const EulaPage = () => <LegalPage kind="eula" />;
