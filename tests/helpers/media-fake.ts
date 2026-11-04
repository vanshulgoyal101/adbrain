import type { SupabaseClient } from "@supabase/supabase-js";

// #1209: an in-memory stand-in for the media tables and the private bucket, enough for the store's queries.
type Row = Record<string, unknown>;
type VideoSlot = {
  assetId: string;
  slot: "upload" | "final";
  path: string | null;
  reservedBytes: number;
  state: "reserved" | "writing" | "verified" | "removed";
  signingIntent: string | null;
  tokenExpiresAt: string | null;
};
export function fakeSupabase() {
  const tables: Record<string, Row[]> = { businesses: [], media_assets: [], media_consents: [], creatives: [], campaigns: [] };
  const objects = new Map<string, Uint8Array>();
  const videoSlots: VideoSlot[] = [];
  const rpcErrors = new Map<string, { message: string }>();
  const uploadOptions: { path: string; upsert?: boolean }[] = [];
  const storageCalls: { op: "sign" | "upload" | "read"; bucket: string; path: string }[] = [];
  const removed: string[] = [];
  const insertErrors: { code: string; message: string }[] = [];
  const updateErrors: { message: string }[] = [];
  const hooks: {
    beforeSign?: (bucket: string, path: string) => Promise<void>;
    beforeUpload?: (bucket: string, path: string) => Promise<void>;
    uploadError?: (bucket: string, path: string) => { message: string } | null;
    removeError?: (bucket: string, paths: string[]) => { message: string } | null;
  } = {};
  const query = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let order: { column: string; ascending: boolean } | null = null;
    let limit = Infinity;
    let head = false;
    let action: { kind: "select" } | { kind: "insert"; row: Row } | { kind: "update"; change: Row } | { kind: "delete" } = { kind: "select" };
    const run = () => {
      const rows = tables[table];
      if (action.kind === "insert") {
        if (insertErrors.length) return { data: null, error: insertErrors.shift()! };
        const row: Row = { id: crypto.randomUUID(), tags: [], checks: {}, status: "pending", deleted_at: null, source: "upload", created_at: new Date().toISOString(), confirmed_at: new Date().toISOString(), ...action.row };
        if (table === "media_assets" && rows.some((other) => other.business_id === row.business_id && other.sha256 === row.sha256 && !other.deleted_at)) {
          return { data: null, error: { code: "23505", message: "duplicate" } };
        }
        if (table === "media_assets" && row.kind === "video") {
          row.upload_path = row.path;
          const base = { assetId: String(row.id), reservedBytes: 50 * 1024 * 1024, state: "reserved" as const, signingIntent: null, tokenExpiresAt: null };
          videoSlots.push({ ...base, slot: "upload", path: String(row.path) }, { ...base, slot: "final", path: null });
        }
        rows.push(row);
        return { data: [row], error: null };
      }
      let matched = rows.filter((row) => filters.every((filter) => filter(row)));
      if (action.kind === "update") {
        if (updateErrors.length) return { data: null, error: updateErrors.shift()! };
        const change = action.change;
        matched.forEach((row) => {
          const final = videoSlots.find((slot) => slot.assetId === row.id && slot.slot === "final");
          if (change.status === "ready" && final?.state === "writing" && final.path === change.path) {
            final.state = "verified";
            final.reservedBytes = Number(change.bytes);
          }
          Object.assign(row, change);
        });
        return { data: matched, error: null };
      }
      if (action.kind === "delete") { tables[table] = rows.filter((row) => !matched.includes(row)); return { data: matched, error: null }; }
      if (order) { const { column, ascending } = order; matched = [...matched].sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1)); }
      return { data: matched.slice(0, limit), error: null, count: head ? matched.length : undefined };
    };
    const builder = {
      select: (_columns?: string, options?: { head?: boolean }) => { head = Boolean(options?.head); return builder; },
      insert: (row: Row) => { action = { kind: "insert", row }; return builder; },
      update: (change: Row) => { action = { kind: "update", change }; return builder; },
      delete: () => { action = { kind: "delete" }; return builder; },
      eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return builder; },
      in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return builder; },
      is: (column: string, value: unknown) => { filters.push((row) => (row[column] ?? null) === value); return builder; },
      gte: (column: string, value: string) => { filters.push((row) => String(row[column]) >= value); return builder; },
      lt: (column: string, value: string) => { filters.push((row) => String(row[column]) < value); return builder; },
      overlaps: (column: string, values: string[]) => { filters.push((row) => ((row[column] as string[]) ?? []).some((value) => values.includes(value))); return builder; },
      order: (column: string, options: { ascending: boolean }) => { order = { column, ascending: options.ascending }; return builder; },
      limit: (count: number) => { limit = count; return builder; },
      maybeSingle: async () => { const result = run(); return { data: result.data?.[0] ?? null, error: result.error }; },
      single: async () => { const result = run(); return { data: result.data?.[0] ?? null, error: result.error ?? (result.data?.length ? null : { message: "none" }) }; },
      then: (resolve: (value: unknown) => unknown) => resolve(run()),
    };
    return builder;
  };
  const client = {
    from: query,
    rpc: async (name: string, args: Record<string, string>) => {
      const injected = rpcErrors.get(name);
      if (injected) return { data: null, error: injected };
      const row = tables.media_assets.find((item) => item.id === args.p_asset_id);
      const upload = videoSlots.find((slot) => slot.assetId === args.p_asset_id && slot.slot === "upload");
      const final = videoSlots.find((slot) => slot.assetId === args.p_asset_id && slot.slot === "final");
      if (name === "media_video_sign_begin") {
        if (!row || row.status !== "pending" || row.deleted_at || row.upload_path !== args.p_upload_path || !upload || upload.signingIntent || final?.state !== "reserved") {
          return { data: null, error: { message: "MEDIA_VIDEO_BUSY" } };
        }
        upload.signingIntent = crypto.randomUUID();
        return { data: upload.signingIntent, error: null };
      }
      if (name === "media_video_sign_finish") {
        if (!upload || upload.signingIntent !== args.p_intent_id) return { data: null, error: { message: "MEDIA_VIDEO_STATE" } };
        upload.signingIntent = null;
        upload.tokenExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
        return { data: Boolean(row && row.status === "pending" && !row.deleted_at && final?.state === "reserved"), error: null };
      }
      if (name === "media_video_finalize_claim") {
        if (!row || row.status !== "pending" || row.deleted_at || row.upload_path !== args.p_upload_path || upload?.signingIntent || final?.state !== "reserved") {
          return { data: false, error: null };
        }
        final.path = args.p_final_path;
        final.state = "writing";
        return { data: true, error: null };
      }
      if (name === "media_video_final_removed") {
        if (final?.state !== "verified" || final.path !== args.p_final_path || objects.has(args.p_final_path)) return { data: false, error: null };
        final.state = "removed";
        return { data: true, error: null };
      }
      return { data: null, error: { message: `Unexpected RPC: ${name}` } };
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUploadUrl: async (path: string, options?: { upsert?: boolean }) => {
          uploadOptions.push({ path, upsert: options?.upsert });
          storageCalls.push({ op: "sign", bucket, path });
          await hooks.beforeSign?.(bucket, path);
          return { data: { path, token: `token-${path}`, signedUrl: `https://storage.test/upload/${path}` }, error: null };
        },
        upload: async (path: string, body: Uint8Array) => {
          storageCalls.push({ op: "upload", bucket, path });
          await hooks.beforeUpload?.(bucket, path);
          objects.set(path, new Uint8Array(body));
          const error = hooks.uploadError?.(bucket, path) ?? null;
          if (error) return { data: null, error };
          return { data: { path }, error: null };
        },
        download: async (path: string) => objects.has(path)
          ? { data: new Blob([objects.get(path)! as BlobPart]), error: null }
          : { data: null, error: { message: "Object not found" } },
        remove: async (paths: string[]) => {
          const error = hooks.removeError?.(bucket, paths) ?? null;
          if (error) return { data: null, error };
          for (const path of paths) { objects.delete(path); removed.push(path); }
          return { data: [], error: null };
        },
        createSignedUrls: async (paths: string[]) => {
          for (const path of paths) storageCalls.push({ op: "read", bucket, path });
          return { data: paths.map((path) => ({ path, signedUrl: `https://storage.test/sign/${path}` })), error: null };
        },
      }),
    },
  };
  return { client: client as unknown as SupabaseClient, tables, objects, videoSlots, rpcErrors, removed, uploadOptions, insertErrors, updateErrors, storageCalls, hooks };
}
