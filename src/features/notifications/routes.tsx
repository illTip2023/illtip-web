import type { RouteDef } from '../../lib/router';
import { NotificationsPage } from './NotificationsPage';
import { NotificationSettingsPage } from './SettingsPage';
import './notifications.css';

/** Routes owned by the notifications feature. auth: true = requires login. */
export const routes: RouteDef[] = [
  { path: '/notifications', element: NotificationsPage, auth: true },
  { path: '/notifications/settings', element: NotificationSettingsPage, auth: true },
];
