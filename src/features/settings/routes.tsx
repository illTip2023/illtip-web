import type { RouteDef } from '../../lib/router';
import './theme'; // applies the saved light/dark/system choice at startup
import './settings.css';
import { SettingsPage } from './SettingsPage';
import { AboutPage, FaqPage, HelpPage } from './InfoPages';
import { EulaPage, PrivacyPage, TermsPage } from './LegalPage';

/** Routes owned by the settings feature. Help/FAQ/About/legal pages are public (auth: false) so sign-up screens can link to them. */
export const routes: RouteDef[] = [
  { path: '/settings', element: SettingsPage, auth: true },
  { path: '/settings/help', element: HelpPage, auth: false },
  { path: '/settings/faq', element: FaqPage, auth: false },
  { path: '/settings/about', element: AboutPage, auth: false },
  { path: '/settings/terms', element: TermsPage, auth: false },
  { path: '/settings/privacy', element: PrivacyPage, auth: false },
  { path: '/settings/eula', element: EulaPage, auth: false },
];
