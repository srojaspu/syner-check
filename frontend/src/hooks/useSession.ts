import { useCallback, useEffect, useState } from "react";
import { AuthError, getSession } from "../api/client";
import type { SessionUser } from "../api/types";

export function useSession() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    getSession()
      .then((data) => setUser(data.user))
      .catch((error: unknown) => {
        if (!(error instanceof AuthError)) setUser(null);
      })
      .finally(() => setReady(true));
  }, []);

  const onAuthFailure = useCallback(() => setUser(null), []);

  return { user, ready, onAuthFailure };
}
