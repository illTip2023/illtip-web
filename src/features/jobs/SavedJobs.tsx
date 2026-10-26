import React from 'react';
import { useAuth } from '../../lib/auth';
import { useQuery } from '../../lib/query';
import { Link } from '../../lib/router';
import { ErrorBox } from '../../ui/kit';
import { CardSkeleton, JIcon, JobCard, JobsNav } from './components';
import { fetchSavedJobs, useMasterServices, useSavedJobIds } from './lib';

export function SavedJobsPage() {
  const { user } = useAuth();
  const services = useMasterServices();
  const saved = useSavedJobIds();
  const q = useQuery(services.loading ? null : 'jobs:saved:' + user?.id, () => fetchSavedJobs(user?.id, services.data), { staleMs: 0 });
  // Unsaving keeps the card until the next visit would be odd; hide it right away like the app.
  const items = (q.data || []).filter((j) => saved.has(j.id));

  return (
    <div className="jb-wide jb-page">
      <header className="jb-hero">
        <div>
          <h1>Saved jobs</h1>
          <p className="muted">Jobs you bookmarked to come back to.</p>
        </div>
      </header>
      <JobsNav active="saved" savedCount={saved.ids.size} />
      <div className="jb-narrow">
        {q.error && !q.data ? (
          <ErrorBox error={{ message: 'Could not load saved jobs.' }} onRetry={q.refetch} />
        ) : !q.data ? (
          <CardSkeleton count={4} />
        ) : items.length === 0 ? (
          <div className="jb-empty">
            <div className="jb-empty-icon">
              <JIcon name="bookmark" size={26} />
            </div>
            <div className="empty-title">No saved jobs yet</div>
            <div className="muted small">Tap the bookmark on any job to save it here.</div>
            <Link to="/jobs" className="btn btn-sm" style={{ marginTop: 14 }}>
              Browse jobs
            </Link>
          </div>
        ) : (
          <div className="jb-list">
            {items.map((j) => (
              <JobCard key={j.id} job={j} saved onToggleSave={() => saved.toggle(j)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
