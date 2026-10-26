import type { RouteDef } from '../../lib/router';
import './profile.css';
import { MyProfilePage, UserProfilePage } from './ProfilePage';
import { EditProfilePage } from './EditProfilePage';
import { NetworkPage, ViewersPage } from './NetworkPages';
import { RatingPage } from './RatingPage';

/** Routes owned by the profile feature. auth: true = requires login; chrome: false = no app shell. */
export const routes: RouteDef[] = [
  { path: '/profile', element: MyProfilePage, auth: true },
  { path: '/profile/edit', element: EditProfilePage, auth: true },
  { path: '/profile/viewers', element: ViewersPage, auth: true },
  { path: '/profile/network', element: NetworkPage, auth: true },
  { path: '/profile/rating', element: RatingPage, auth: true },
  { path: '/u/:userId', element: UserProfilePage, auth: true },
];
