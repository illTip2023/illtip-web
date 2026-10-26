import React from 'react';
import type { RouteDef } from '../../lib/router';
import { Empty, PageHeader } from '../../ui/kit';

function HireprosPlaceholder() {
  return (
    <>
      <PageHeader title="Hirepros" />
      <Empty title="Coming soon" />
    </>
  );
}

/** Routes owned by the hirepros feature. auth: true = requires login; chrome: false = no app shell. */
export const routes: RouteDef[] = [{ path: '/hire', element: HireprosPlaceholder, auth: true }];
