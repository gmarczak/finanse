"use client";

import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { del, get, set } from "idb-keyval";
import { useEffect, useState, type ReactNode } from "react";
import { draftMutationKey } from "@/lib/data/hooks";
import { saveDraft, type TxDraft } from "@/lib/data/mutations";
import { supabaseBrowser } from "@/lib/db/client";

const CACHE_VERSION = "finanse-1";

function makeClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { gcTime: 1000 * 60 * 60 * 24 * 7, retry: 1, networkMode: "offlineFirst" },
      mutations: { networkMode: "online", retry: 3 },
    },
  });
  client.setMutationDefaults(draftMutationKey, {
    mutationFn: (draft: TxDraft) => saveDraft(supabaseBrowser(), draft),
  });
  return client;
}

const persister =
  typeof window === "undefined"
    ? undefined
    : createAsyncStoragePersister({
        storage: {
          getItem: async (key) => (await get<string>(key)) ?? null,
          setItem: (key, value) => set(key, value),
          removeItem: (key) => del(key),
        },
        key: "finanse-cache",
        throttleTime: 500,
      });

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(makeClient);

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" });
    }
  }, []);

  if (!persister) return null;
  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{ persister, buster: CACHE_VERSION, maxAge: 1000 * 60 * 60 * 24 * 7 }}
      onSuccess={() => client.resumePausedMutations()}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
