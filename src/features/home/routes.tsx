import type { RouteDef } from '../../lib/router';
import './home.css';
import { HomeFeed } from './HomeFeed';
import { PostDetails } from './PostDetails';
import { SearchScreen } from './Search';
import { SavedScreen } from './Saved';

/** Routes owned by the home feature. auth: true = requires login; chrome: false = no app shell. */
export const routes: RouteDef[] = [
  { path: '/', element: HomeFeed, auth: true },
  { path: '/post/:id', element: PostDetails, auth: true },
  { path: '/search', element: SearchScreen, auth: true },
  { path: '/saved', element: SavedScreen, auth: true },
];
