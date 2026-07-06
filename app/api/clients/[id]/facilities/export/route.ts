export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { createSupabaseServerClient } from '@/lib/supabase/server';
import Papa from 'papaparse';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createSupabaseServerClient();

    const { data: facilities, error } = await supabase
      .from('facilities')
      .select('id, name, address')
      .eq('client_id', params.id)
      .order('name');

    if (error) throw error;

    const csv = Papa.unparse(facilities ?? []);

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="facilities-${params.id}.csv"`,
      },
    });
  } catch (error) {
    console.error('Error exporting facilities:', error);
    return new Response('Failed to export facilities', { status: 500 });
  }
}
