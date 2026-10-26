import type { RouteDef } from '../../lib/router';
import '../jobs/jobs.css';
import './hirepros.css';
import { HireProsPage } from './HirePros';
import { RequestServicePage } from './RequestService';

/** Routes owned by the hirepros feature. */
export const routes: RouteDef[] = [
  { path: '/hire', element: HireProsPage, auth: true },
  { path: '/hire/request', element: RequestServicePage, auth: true },
];
