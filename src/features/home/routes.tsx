import React from 'react';
import type { RouteDef } from '../../lib/router';
import { Empty, PageHeader } from '../../ui/kit';

function HomePlaceholder() {
  return (
    <>
      <PageHeader title="Home" />
      <Empty title="Coming soon" />
    </>
  );
}

/** Routes owned by the home feature. auth: true = requires login; chrome: false = no app shell. */
export const routes: RouteDef[] = [{ path: '/', element: HomePlaceholder, auth: true }];
