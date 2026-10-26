import React, { useState } from 'react';
import { PageHeader } from '../../ui/kit';
import { Link } from '../../lib/router';
import { APP_LINKS } from '../../lib/env';
import { Chevron, Glyph } from './SettingsPage';

// Same contact details as HelpScreen.tsx in the app.
const SUPPORT_EMAIL = 'info@illtip.com';
const SUPPORT_NUMBER = '+1 (214) 355-6321';
const WEBSITE_URL = 'https://www.illtip.com';

export function HelpPage() {
  const cards = [
    {
      title: 'Frequently Asked Questions',
      body: (
        <>
          <Link to="/settings/faq">Click here</Link> to find more on FAQ
        </>
      ),
      icon: 'M4 5h16v11H9l-5 4zM9 9h6M9 12h4',
    },
    {
      title: 'Support Email',
      body: (
        <>
          Contact us under this email: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </>
      ),
      icon: 'M4 6h16v12H4zM4 7l8 6 8-6',
    },
    {
      title: 'Support Number',
      body: (
        <>
          Contact us under this number: <a href={`tel:${SUPPORT_NUMBER.replace(/[^\d+]/g, '')}`}>{SUPPORT_NUMBER}</a>
        </>
      ),
      icon: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
    },
    {
      title: 'Our Website',
      body: (
        <>
          Come to the website:{' '}
          <a href={WEBSITE_URL} target="_blank" rel="noreferrer">
            www.illtip.com
          </a>
        </>
      ),
      icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z',
    },
  ];
  return (
    <div className="st">
      <PageHeader title="Help" back="/settings" />
      <div className="st-hero">
        <div className="st-hero-title">How can we help?</div>
        <div className="st-hero-sub">Find answers, get support, or contact our team.</div>
      </div>
      <div className="st-help-grid">
        {cards.map((c) => (
          <div key={c.title} className="card st-help-card">
            <span className="st-ico">
              <Glyph d={c.icon} />
            </span>
            <div>
              <div className="st-help-title">{c.title}</div>
              <div className="muted small">{c.body}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const FAQ = [
  {
    q: "What Is i'llTip",
    a: "i'llTip is a social media-based freelance marketplace connecting skilled professionals with clients who need their services. It is built for visibility, trust, and growth—not just gigs.",
  },
  {
    q: "How does i'llTip differ from others?",
    a: "i'llTip is social and local-friendly. We do not rely on paid ads or follower counts to decide who gets seen. Instead, quality work, Credit Points, and our Tipping system help the best talent rise naturally.",
  },
  {
    q: "Does i'llTip charge fees?",
    a: "Yes—but we keep it transparent. i'llTip uses a clear fee structure so you always know what you pay or earn. Check the Fee section in your app settings for current rates.",
  },
];

export function FaqPage() {
  const [open, setOpen] = useState(0);
  return (
    <div className="st">
      <PageHeader title="FAQ" back="/settings/help" sub="Frequently Asked Questions" />
      <div className="card st-group">
        {FAQ.map((f, i) => (
          <div key={f.q} className={'st-faq' + (open === i ? ' open' : '')}>
            <button className="st-row st-faq-q" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}>
              <span className="grow st-row-title">{f.q}</span>
              <Chevron />
            </button>
            {open === i && <div className="st-faq-a">{f.a}</div>}
          </div>
        ))}
      </div>
      <p className="muted small center" style={{ marginTop: 16 }}>
        Still need help? <Link to="/settings/help">Contact support</Link>
      </p>
    </div>
  );
}

const ABOUT = [
  {
    title: "What Is i'llTip",
    body: "i'llTip is a premier digital marketplace and networking ecosystem designed to bridge the gap between skilled service providers and the people who need them. We are rapidly expanding across the global digital economy—most notably in Nigeria—i'llTip is more than just a gig app; it is a platform for visibility, trust, and professional growth.",
  },
  {
    title: 'Our Mission',
    body: "To empower freelancers and small businesses by providing a transparent, efficient, and direct path to opportunity. We believe that talent should be the only metric for success, which is why we've built a system that prioritizes quality over follower counts or paid ad placements.",
  },
  {
    title: 'What Sets Us Apart',
    body: "Unlike traditional freelance platforms that often act as gatekeepers, i'llTip fosters direct connection. We provide the tools you need to find, hire, and pay professionals without the friction of hidden fees or restrictive communication barriers.",
  },
];

export function AboutPage() {
  return (
    <div className="st">
      <PageHeader title="About i'llTip" back="/settings" />
      <div className="card st-about">
        <div className="st-about-logo">
          <img src="logo.png" alt="i'llTip" />
          <span>i'llTip</span>
        </div>
        {ABOUT.map((s) => (
          <section key={s.title} className="st-about-sec">
            <h2>{s.title}</h2>
            <p>{s.body}</p>
          </section>
        ))}
      </div>
      <h2 className="st-h">Legal</h2>
      <div className="card st-group">
        <Link to="/settings/terms" className="st-row">
          <span className="grow st-row-title">Terms & Conditions</span>
          <Chevron />
        </Link>
        <Link to="/settings/privacy" className="st-row">
          <span className="grow st-row-title">Privacy Policy</span>
          <Chevron />
        </Link>
        <Link to="/settings/eula" className="st-row">
          <span className="grow st-row-title">EULA</span>
          <Chevron />
        </Link>
      </div>
      <p className="st-foot">
        <a href={APP_LINKS.site} target="_blank" rel="noreferrer">
          www.illtip.com
        </a>{' '}
        ·{' '}
        <a href={APP_LINKS.ios} target="_blank" rel="noreferrer">
          App Store
        </a>{' '}
        ·{' '}
        <a href={APP_LINKS.android} target="_blank" rel="noreferrer">
          Google Play
        </a>
      </p>
    </div>
  );
}
