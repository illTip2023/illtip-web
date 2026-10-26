import type { RouteDef } from '../../lib/router';
import './jobs.css';
import { JobDetailsPage } from './JobDetails';
import { JobListPage } from './JobList';
import { MyJobDetailPage, MyJobsPage } from './MyJobs';
import { SavedJobsPage } from './SavedJobs';

/** Routes owned by the jobs feature (order matters: specific paths before /jobs/:id). */
export const routes: RouteDef[] = [
  { path: '/jobs', element: JobListPage, auth: true },
  { path: '/jobs/saved', element: SavedJobsPage, auth: true },
  { path: '/jobs/mine', element: MyJobsPage, auth: true },
  { path: '/jobs/mine/:id', element: MyJobDetailPage, auth: true },
  { path: '/jobs/:id', element: JobDetailsPage, auth: true },
];
