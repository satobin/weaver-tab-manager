import { useEffect, useState } from 'react';

import { APP_ROUTES, parseAppRoute, type AppRoute } from './routes';

export function useHashRoute(): AppRoute {
  const [route, setRoute] = useState<AppRoute>(() => parseAppRoute(window.location.hash));

  useEffect(() => {
    if (!window.location.hash) {
      window.location.replace(APP_ROUTES.windows);
    }

    const onHashChange = () => setRoute(parseAppRoute(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    onHashChange();

    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return route;
}
