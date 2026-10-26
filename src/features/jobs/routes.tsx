import React from 'react';
import type { RouteDef } from '../../lib/router';
import { Empty, PageHeader } from '../../ui/kit';

function JobsPlaceholder() {
  return (
    <>
      <PageHeader title="Jobs" />
      <Empty title="Coming soon" />
    </>
  );
}

/** Routes owned by the jobs feature. auth: true = requires login; chrome: false = no app shell. */
export const routes: RouteDef[] = [{ path: '/jobs', element: JobsPlaceholder, auth: true }];
