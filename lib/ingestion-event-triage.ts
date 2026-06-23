import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IngestionEventTriage,
  IngestionEventTriageEmbed,
  IngestionEventTriageStatus,
} from '@/types';

export const TRIAGE_STATUSES = ['unreviewed', 'in_progress', 'addressed'] as const;

const MAX_CUSTOM_TAG_LENGTH = 64;
const MAX_CUSTOM_TAGS = 20;

export function isTriageStatus(value: unknown): value is IngestionEventTriageStatus {
  return typeof value === 'string' && (TRIAGE_STATUSES as readonly string[]).includes(value);
}

export function normalizeCustomTag(label: unknown): string | null {
  if (typeof label !== 'string') return null;
  const trimmed = label.trim();
  if (!trimmed || trimmed.length > MAX_CUSTOM_TAG_LENGTH) return null;
  return trimmed;
}

export function normalizeCustomTags(tags: unknown): string[] | null {
  if (!Array.isArray(tags)) return null;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const normalized = normalizeCustomTag(tag);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= MAX_CUSTOM_TAGS) break;
  }
  return result;
}

type TriageRow = {
  event_id: number;
  status: string;
  note: string | null;
  updated_at: string;
  updated_by: string | null;
};

type TagRow = {
  event_id: number;
  label: string;
};

function emptyTriage(eventId: number): IngestionEventTriage {
  return {
    event_id: eventId,
    status: 'unreviewed',
    note: null,
    custom_tags: [],
    updated_at: null,
    updated_by: null,
  };
}

function mergeTriageRow(
  eventId: number,
  triage: TriageRow | undefined,
  tags: string[]
): IngestionEventTriage {
  if (!triage) {
    return { ...emptyTriage(eventId), custom_tags: tags };
  }
  return {
    event_id: eventId,
    status: isTriageStatus(triage.status) ? triage.status : 'unreviewed',
    note: triage.note,
    custom_tags: tags,
    updated_at: triage.updated_at,
    updated_by: triage.updated_by,
  };
}

export async function fetchTriageForEvents(
  supabase: SupabaseClient,
  eventIds: number[]
): Promise<IngestionEventTriage[]> {
  if (eventIds.length === 0) return [];

  const uniqueIds = [...new Set(eventIds)];

  const [{ data: triageRows, error: triageError }, { data: tagRows, error: tagError }] =
    await Promise.all([
      supabase
        .from('ingestion_event_triage')
        .select('event_id, status, note, updated_at, updated_by')
        .in('event_id', uniqueIds),
      supabase
        .from('ingestion_event_custom_tags')
        .select('event_id, label')
        .in('event_id', uniqueIds)
        .order('label'),
    ]);

  if (triageError) throw triageError;
  if (tagError) throw tagError;

  const triageByEvent = new Map<number, TriageRow>();
  for (const row of (triageRows ?? []) as TriageRow[]) {
    triageByEvent.set(row.event_id, row);
  }

  const tagsByEvent = new Map<number, string[]>();
  for (const row of (tagRows ?? []) as TagRow[]) {
    const list = tagsByEvent.get(row.event_id) ?? [];
    list.push(row.label);
    tagsByEvent.set(row.event_id, list);
  }

  return uniqueIds.map((eventId) =>
    mergeTriageRow(eventId, triageByEvent.get(eventId), tagsByEvent.get(eventId) ?? [])
  );
}

function toTriageEmbed(triage: IngestionEventTriage): IngestionEventTriageEmbed {
  return {
    status: triage.status,
    note: triage.note,
    custom_tags: triage.custom_tags,
    updated_at: triage.updated_at,
    updated_by: triage.updated_by,
  };
}

export async function attachTriageToEvents<T extends { id: number }>(
  supabase: SupabaseClient,
  events: T[]
): Promise<(T & { triage: IngestionEventTriageEmbed })[]> {
  if (events.length === 0) return [];

  const triageList = await fetchTriageForEvents(
    supabase,
    events.map((event) => event.id)
  );
  const triageByEventId = new Map(triageList.map((triage) => [triage.event_id, triage]));

  return events.map((event) => ({
    ...event,
    triage: toTriageEmbed(triageByEventId.get(event.id) ?? emptyTriage(event.id)),
  }));
}

async function fetchEventIdsByTriageStatus(
  supabase: SupabaseClient,
  status: IngestionEventTriageStatus
): Promise<number[]> {
  const { data, error } = await supabase
    .from('ingestion_event_triage')
    .select('event_id')
    .eq('status', status);
  if (error) throw error;
  return (data ?? []).map((row) => row.event_id as number);
}

async function fetchAllTriagedEventIds(supabase: SupabaseClient): Promise<number[]> {
  const { data, error } = await supabase.from('ingestion_event_triage').select('event_id');
  if (error) throw error;
  return (data ?? []).map((row) => row.event_id as number);
}

async function fetchEventIdsByTag(supabase: SupabaseClient, tag: string): Promise<number[]> {
  const { data, error } = await supabase
    .from('ingestion_event_custom_tags')
    .select('event_id')
    .ilike('label', `%${tag}%`);
  if (error) throw error;
  return [...new Set((data ?? []).map((row) => row.event_id as number))];
}

function intersectIdSets(current: Set<number> | null, ids: number[]): Set<number> {
  const next = new Set(ids);
  if (!current) return next;
  return new Set([...current].filter((id) => next.has(id)));
}

export type ActivityEventIdFilter = {
  triageStatus?: IngestionEventTriageStatus | null;
  hideAddressed?: boolean;
  tag?: string | null;
};

export type ActivityEventIdFilterResult = {
  includeIds: number[] | null;
  excludeIds: number[];
};

/** Resolves server-side event id constraints for activity list filters. */
export async function resolveActivityEventIdFilter(
  supabase: SupabaseClient,
  filter: ActivityEventIdFilter
): Promise<ActivityEventIdFilterResult | 'empty'> {
  let includeIds: Set<number> | null = null;
  const excludeIds = new Set<number>();

  const triageStatus = filter.triageStatus ?? null;
  const tag = filter.tag?.trim() ?? '';

  if (triageStatus === 'in_progress' || triageStatus === 'addressed') {
    const ids = await fetchEventIdsByTriageStatus(supabase, triageStatus);
    if (ids.length === 0) return 'empty';
    includeIds = intersectIdSets(includeIds, ids);
  } else if (triageStatus === 'unreviewed') {
    for (const id of await fetchAllTriagedEventIds(supabase)) {
      excludeIds.add(id);
    }
  }

  if (filter.hideAddressed && triageStatus !== 'addressed') {
    for (const id of await fetchEventIdsByTriageStatus(supabase, 'addressed')) {
      excludeIds.add(id);
    }
  }

  if (tag) {
    const ids = await fetchEventIdsByTag(supabase, tag);
    if (ids.length === 0) return 'empty';
    includeIds = intersectIdSets(includeIds, ids);
  }

  if (includeIds && excludeIds.size > 0) {
    for (const id of excludeIds) includeIds.delete(id);
    if (includeIds.size === 0) return 'empty';
  }

  return {
    includeIds: includeIds ? [...includeIds] : null,
    excludeIds: [...excludeIds],
  };
}

export async function verifyIngestionEventAccessible(
  supabase: SupabaseClient,
  eventId: number
): Promise<boolean> {
  const { data, error } = await supabase
    .from('ingestion_events')
    .select('id')
    .eq('id', eventId)
    .maybeSingle();

  if (error) throw error;
  return data != null;
}

export async function applyTriageUpdate(
  supabase: SupabaseClient,
  eventId: number,
  userId: string,
  body: {
    status?: IngestionEventTriageStatus;
    note?: string | null;
    custom_tags?: string[];
  }
): Promise<IngestionEventTriage> {
  const hasStatus = body.status !== undefined;
  const hasNote = body.note !== undefined;
  const hasCustomTags = body.custom_tags !== undefined;

  if (!hasStatus && !hasNote && !hasCustomTags) {
    throw new Error('NO_FIELDS');
  }

  if (hasStatus || hasNote) {
    const status = body.status;
    const note =
      body.note === undefined
        ? undefined
        : body.note === null || body.note.trim() === ''
          ? null
          : body.note.trim();

    if (status === 'unreviewed' && (note === null || note === undefined)) {
      const { error: deleteError } = await supabase
        .from('ingestion_event_triage')
        .delete()
        .eq('event_id', eventId);
      if (deleteError) throw deleteError;
    } else {
      const { data: existing, error: existingError } = await supabase
        .from('ingestion_event_triage')
        .select('status, note')
        .eq('event_id', eventId)
        .maybeSingle();

      if (existingError) throw existingError;

      const nextStatus: IngestionEventTriageStatus =
        status ??
        (isTriageStatus(existing?.status) ? existing.status : note != null ? 'in_progress' : 'unreviewed');

      const nextNote = note !== undefined ? note : (existing?.note ?? null);

      if (nextStatus === 'unreviewed' && !nextNote) {
        const { error: deleteError } = await supabase
          .from('ingestion_event_triage')
          .delete()
          .eq('event_id', eventId);
        if (deleteError) throw deleteError;
      } else {
        const { error: upsertError } = await supabase.from('ingestion_event_triage').upsert(
          {
            event_id: eventId,
            status: nextStatus,
            note: nextNote,
            updated_by: userId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'event_id' }
        );
        if (upsertError) throw upsertError;
      }
    }
  }

  if (hasCustomTags) {
    const tags = body.custom_tags ?? [];
    const { error: deleteError } = await supabase
      .from('ingestion_event_custom_tags')
      .delete()
      .eq('event_id', eventId);
    if (deleteError) throw deleteError;

    if (tags.length > 0) {
      const { error: insertError } = await supabase.from('ingestion_event_custom_tags').insert(
        tags.map((label) => ({
          event_id: eventId,
          label,
          created_by: userId,
        }))
      );
      if (insertError) throw insertError;
    }
  }

  const [result] = await fetchTriageForEvents(supabase, [eventId]);
  return result ?? emptyTriage(eventId);
}
