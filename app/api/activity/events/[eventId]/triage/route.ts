export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  applyTriageUpdate,
  isTriageStatus,
  normalizeCustomTags,
  verifyIngestionEventAccessible,
} from '@/lib/ingestion-event-triage';

function parseEventId(raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

async function requireUser() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { supabase, user: null as null };
  }

  return { supabase, user };
}

// PATCH /api/activity/events/[eventId]/triage
// Body: { status?, note?, custom_tags? }
export async function PATCH(
  request: Request,
  { params }: { params: { eventId: string } }
) {
  try {
    const eventId = parseEventId(params.eventId);
    if (eventId == null) {
      return NextResponse.json({ error: 'Invalid event id' }, { status: 400 });
    }

    const { supabase, user } = await requireUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accessible = await verifyIngestionEventAccessible(supabase, eventId);
    if (!accessible) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const payload = body as Record<string, unknown>;
    const update: {
      status?: 'unreviewed' | 'in_progress' | 'addressed';
      note?: string | null;
      custom_tags?: string[];
    } = {};

    if ('status' in payload) {
      if (!isTriageStatus(payload.status)) {
        return NextResponse.json(
          { error: 'status must be unreviewed, in_progress, or addressed' },
          { status: 400 }
        );
      }
      update.status = payload.status;
    }

    if ('note' in payload) {
      if (payload.note !== null && typeof payload.note !== 'string') {
        return NextResponse.json({ error: 'note must be a string or null' }, { status: 400 });
      }
      update.note = payload.note as string | null;
    }

    if ('custom_tags' in payload) {
      const tags = normalizeCustomTags(payload.custom_tags);
      if (tags === null) {
        return NextResponse.json({ error: 'custom_tags must be an array of strings' }, { status: 400 });
      }
      update.custom_tags = tags;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 });
    }

    const data = await applyTriageUpdate(supabase, eventId, user.id, update);
    return NextResponse.json({ data });
  } catch (error) {
    if (error instanceof Error && error.message === 'NO_FIELDS') {
      return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 });
    }
    console.error('Error updating event triage:', error);
    return NextResponse.json({ error: 'Failed to update event triage' }, { status: 500 });
  }
}
