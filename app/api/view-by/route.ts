export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

interface Usage {
  clientId: string;
  clientName: string;
  facilityId: string;
  facilityName: string;
}

// GET /api/view-by?type=supplier|utility - Get clients/facilities grouped by supplier or utility
export async function GET(request: Request) {
  try {
    const supabase = createSupabaseServerClient();
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type'); // 'supplier' | 'utility'

    if (type !== 'supplier' && type !== 'utility') {
      return NextResponse.json(
        { error: 'Invalid type. Use ?type=supplier or ?type=utility' },
        { status: 400 }
      );
    }

    const { data: metersData, error: metersErr } = await supabase
      .from('meters')
      .select('facility_id, supplier_id, utility_category_id');

    if (metersErr) throw metersErr;

    const facilityIds = Array.from(
      new Set((metersData || []).map((m: any) => m.facility_id).filter(Boolean)),
    );
    const { data: facilities } = await supabase
      .from('facilities')
      .select('id, name, client_id')
      .in('id', facilityIds);

    const clientIds = Array.from(
      new Set((facilities || []).map((f: any) => f.client_id).filter(Boolean)),
    );
    const { data: clients } = await supabase
      .from('clients')
      .select('id, name')
      .in('id', clientIds);

    const clientNameMap = (clients || []).reduce((acc: Record<string, string>, c: any) => {
      acc[c.id] = c.name;
      return acc;
    }, {});

    const facilityInfoMap: Record<string, { name: string; clientId: string; clientName: string }> = {};
    (facilities || []).forEach((f: any) => {
      facilityInfoMap[f.id] = {
        name: f.name,
        clientId: f.client_id,
        clientName: clientNameMap[f.client_id] || 'Unknown'
      };
    });

    const { data: suppliers } = await supabase.from('suppliers').select('id, name');
    const { data: categories } = await supabase.from('utility_categories').select('id, name');

    const supplierMap = (suppliers || []).reduce((acc: Record<string, string>, s: any) => {
      acc[s.id] = s.name;
      return acc;
    }, {});

    const categoryMap = (categories || []).reduce((acc: Record<string, string>, c: any) => {
      acc[c.id] = c.name;
      return acc;
    }, {});

    if (type === 'supplier') {
      const bySupplier: Record<string, { name: string; usages: Usage[] }> = {};

      for (const m of metersData || []) {
        const fid = m.facility_id;
        if (!fid) continue;

        const facInfo = facilityInfoMap[fid];
        if (!facInfo) continue;

        const usage: Usage = {
          clientId: facInfo.clientId,
          clientName: facInfo.clientName,
          facilityId: fid,
          facilityName: facInfo.name
        };

        const key = m.supplier_id || '__no_supplier__';
        const supplierName = m.supplier_id ? supplierMap[m.supplier_id] || 'Unknown' : 'No Supplier';

        if (!bySupplier[key]) {
          bySupplier[key] = { name: supplierName, usages: [] };
        }
        if (!bySupplier[key].usages.some(u => u.facilityId === fid)) {
          bySupplier[key].usages.push(usage);
        }
      }

      const result = Object.entries(bySupplier)
        .filter(([k]) => k !== '__no_supplier__' || Object.keys(bySupplier).length === 1)
        .map(([id, { name, usages }]) => ({
          id,
          name,
          usages: usages.sort((a, b) => 
            a.clientName.localeCompare(b.clientName) || a.facilityName.localeCompare(b.facilityName)
          )
        }))
        .filter(s => s.usages.length > 0)
        .sort((a, b) => a.name.localeCompare(b.name));

      return NextResponse.json({ items: result });
    }

    // type === 'utility'
    const byUtility: Record<string, { name: string; usages: Usage[] }> = {};

    for (const m of metersData || []) {
      const fid = m.facility_id;
      if (!fid || !m.utility_category_id) continue;

      const facInfo = facilityInfoMap[fid];
      if (!facInfo) continue;

      const usage: Usage = {
        clientId: facInfo.clientId,
        clientName: facInfo.clientName,
        facilityId: fid,
        facilityName: facInfo.name
      };

      const key = m.utility_category_id;
      const categoryName = categoryMap[key] || 'Unknown';

      if (!byUtility[key]) {
        byUtility[key] = { name: categoryName, usages: [] };
      }
      if (!byUtility[key].usages.some(u => u.facilityId === fid)) {
        byUtility[key].usages.push(usage);
      }
    }

    const result = Object.entries(byUtility)
      .map(([id, { name, usages }]) => ({
        id,
        name,
        usages: usages.sort((a, b) =>
          a.clientName.localeCompare(b.clientName) || a.facilityName.localeCompare(b.facilityName)
        )
      }))
      .filter(c => c.usages.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ items: result });
  } catch (error) {
    console.error('Error in view-by API:', error);
    return NextResponse.json(
      { error: 'Failed to fetch view-by data' },
      { status: 500 }
    );
  }
}
