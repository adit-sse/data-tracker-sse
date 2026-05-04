/**
 * Seed or remove an isolated ingestion API sandbox (dedicated client + fixtures).
 *
 * Usage:
 *   node scripts/seed-ingestion-test-subject.mjs           # create if missing
 *   node scripts/seed-ingestion-test-subject.mjs --force  # delete sandbox client + recreate
 *   node scripts/seed-ingestion-test-subject.mjs --teardown
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from '@supabase/supabase-js';

const NAMES = {
  client: 'Test Client',
  supplier: 'BFcards',
  /** Standalone line demo: Test Client + Agas national (same site as BFcards line demo, different supplier + utility) */
  supplierAgasNational: 'Agas national',
  inputAgasNationalLine: '[INGESTION TEST] Agas National Demo Utility',
  /** categories.name — group pending/error utility_name; NGERS Category for group confirm */
  groupCategory: '[INGESTION TEST] Sandbox Transport',
  /** Member line input_types (Scope 1 non-metered) */
  inputFuelAlpha: '[INGESTION TEST] Sandbox Fuel Alpha',
  inputFuelBeta: '[INGESTION TEST] Sandbox Fuel Beta',
  facGroupAlpha: '[INGESTION TEST] Group Site Alpha',
  facGroupBeta: '[INGESTION TEST] Group Site Beta',
  /** Standalone line mode */
  facLineOnly: '[INGESTION TEST] Line Only Site',
  inputLineStandalone: '[INGESTION TEST] Sandbox Standalone Utility',
  groupDisplayName: '[INGESTION TEST] Sandbox Facility Group',
  /** Metered */
  inputMeteredElectric: '[INGESTION TEST] Sandbox Test Electricity',
  meterNmi: '999000111222333',
};

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.',
    );
    process.exit(1);
  }
  return createClient(url, key);
}

async function getOrCreateSupplier(supabase, name) {
  const { data: row } = await supabase.from('suppliers').select('id').eq('name', name).maybeSingle();
  if (row?.id) return row.id;
  const { data, error } = await supabase.from('suppliers').insert({ name }).select('id').single();
  if (error) throw error;
  return data.id;
}

async function getOrCreateCategory(supabase, name, scope) {
  const { data: row } = await supabase.from('categories').select('id').eq('name', name).maybeSingle();
  if (row?.id) return row.id;
  const { data, error } = await supabase.from('categories').insert({ name, scope }).select('id').single();
  if (error) throw error;
  return data.id;
}

async function getOrCreateInputType(supabase, { name, scope, is_metered }) {
  const { data: row } = await supabase.from('input_types').select('id').eq('name', name).maybeSingle();
  if (row?.id) return row.id;
  const { data, error } = await supabase
    .from('input_types')
    .insert({
      name,
      scope,
      is_metered,
      needs_review: false,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function deleteSandboxClient(supabase) {
  const { data: clients } = await supabase
    .from('clients')
    .select('id')
    .eq('name', NAMES.client);
  const ids = (clients ?? []).map((c) => c.id);
  if (ids.length === 0) {
    console.log('No sandbox client to delete.');
    return 0;
  }
  const { error } = await supabase.from('clients').delete().in('id', ids);
  if (error) throw error;
  console.log(`Deleted sandbox client(s): ${ids.length}`);
  return ids.length;
}

async function seed() {
  const supabase = getSupabase();

  const supplierId = await getOrCreateSupplier(supabase, NAMES.supplier);
  const agasSupplierId = await getOrCreateSupplier(supabase, NAMES.supplierAgasNational);
  const categoryId = await getOrCreateCategory(supabase, NAMES.groupCategory, 1);
  const inputAlphaId = await getOrCreateInputType(supabase, {
    name: NAMES.inputFuelAlpha,
    scope: 1,
    is_metered: false,
  });
  const inputBetaId = await getOrCreateInputType(supabase, {
    name: NAMES.inputFuelBeta,
    scope: 1,
    is_metered: false,
  });
  const inputLineId = await getOrCreateInputType(supabase, {
    name: NAMES.inputLineStandalone,
    scope: 1,
    is_metered: false,
  });
  const inputAgasLineId = await getOrCreateInputType(supabase, {
    name: NAMES.inputAgasNationalLine,
    scope: 1,
    is_metered: false,
  });
  const inputMeteredId = await getOrCreateInputType(supabase, {
    name: NAMES.inputMeteredElectric,
    scope: 2,
    is_metered: true,
  });

  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .insert({ name: NAMES.client })
    .select('id')
    .single();
  if (clientErr) throw clientErr;

  const clientId = client.id;

  const facilities = [
    { name: NAMES.facGroupAlpha, id: null },
    { name: NAMES.facGroupBeta, id: null },
    { name: NAMES.facLineOnly, id: null },
  ];
  for (const f of facilities) {
    const { data, error } = await supabase
      .from('facilities')
      .insert({ client_id: clientId, name: f.name })
      .select('id')
      .single();
    if (error) throw error;
    f.id = data.id;
  }

  const facAlpha = facilities.find((f) => f.name === NAMES.facGroupAlpha).id;
  const facBeta = facilities.find((f) => f.name === NAMES.facGroupBeta).id;
  const facLine = facilities.find((f) => f.name === NAMES.facLineOnly).id;

  const lineRows = [
    { facility_id: facAlpha, supplier_id: supplierId, input_type_id: inputAlphaId, category_id: categoryId },
    { facility_id: facBeta, supplier_id: supplierId, input_type_id: inputBetaId, category_id: categoryId },
    { facility_id: facLine, supplier_id: supplierId, input_type_id: inputLineId, category_id: null },
    {
      facility_id: facLine,
      supplier_id: agasSupplierId,
      input_type_id: inputAgasLineId,
      category_id: null,
    },
  ];
  const { error: lineErr } = await supabase
    .from('non_metered_lines')
    .upsert(lineRows, { onConflict: 'facility_id,supplier_id,input_type_id' });
  if (lineErr) throw lineErr;

  const { data: linesWithIds, error: fetchLinesErr } = await supabase
    .from('non_metered_lines')
    .select('id, facility_id, input_type_id')
    .eq('supplier_id', supplierId)
    .in('facility_id', [facAlpha, facBeta])
    .in('input_type_id', [inputAlphaId, inputBetaId]);
  if (fetchLinesErr) throw fetchLinesErr;

  const lineAlpha = linesWithIds?.find(
    (r) => String(r.facility_id) === String(facAlpha) && String(r.input_type_id) === String(inputAlphaId),
  )?.id;
  const lineBeta = linesWithIds?.find(
    (r) => String(r.facility_id) === String(facBeta) && String(r.input_type_id) === String(inputBetaId),
  )?.id;
  if (!lineAlpha || !lineBeta) {
    throw new Error('Failed to resolve non_metered_line ids for group members after upsert');
  }

  const { data: existingGroup } = await supabase
    .from('facility_groups')
    .select('id')
    .eq('client_id', clientId)
    .eq('supplier_id', supplierId)
    .eq('category_id', categoryId)
    .maybeSingle();

  let groupId = existingGroup?.id;
  if (!groupId) {
    const { data: g, error: gErr } = await supabase
      .from('facility_groups')
      .insert({
        client_id: clientId,
        supplier_id: supplierId,
        category_id: categoryId,
        name: NAMES.groupDisplayName,
      })
      .select('id')
      .single();
    if (gErr) throw gErr;
    groupId = g.id;
  }

  const { error: memErr } = await supabase.from('facility_group_members').upsert(
    [
      { group_id: groupId, non_metered_line_id: lineAlpha },
      { group_id: groupId, non_metered_line_id: lineBeta },
    ],
    { onConflict: 'group_id,non_metered_line_id', ignoreDuplicates: true },
  );
  if (memErr) throw memErr;

  const { data: existingMeter } = await supabase
    .from('meters')
    .select('id')
    .eq('facility_id', facLine)
    .eq('input_type_id', inputMeteredId)
    .eq('lookup1', NAMES.meterNmi)
    .maybeSingle();

  if (!existingMeter?.id) {
    const { error: mErr } = await supabase.from('meters').insert({
      facility_id: facLine,
      supplier_id: supplierId,
      input_type_id: inputMeteredId,
      category_id: null,
      identifier_type: 'NMI',
      lookup1: NAMES.meterNmi,
      lookup2: null,
    });
    if (mErr) throw mErr;
  }

  const manifest = {
    client_id: clientId,
    supplier_id: supplierId,
    group_category_id: categoryId,
    facility_group_id: groupId,
    facilities: { alpha: facAlpha, beta: facBeta, lineOnly: facLine },
    supplier_agas_national_id: agasSupplierId,
    input_type_ids: {
      fuelAlpha: inputAlphaId,
      fuelBeta: inputBetaId,
      lineStandalone: inputLineId,
      agasNationalLine: inputAgasLineId,
      meteredElectric: inputMeteredId,
    },
    names: NAMES,
  };

  console.log('\n--- Sandbox manifest (save for debugging) ---\n');
  console.log(JSON.stringify(manifest, null, 2));

  const B = '${BASE_URL}';
  const K = '${INGESTION_API_KEY}';
  const j = (o) => JSON.stringify(o);

  console.log('\n--- Example curl (set BASE_URL and INGESTION_API_KEY) ---\n');

  console.log('# Non-metered GROUP pending');
  console.log(
    `curl -sS -X POST "${B}/api/ingestion/pending" -H "Authorization: Bearer ${K}" -H "Content-Type: application/json" -d ${j({
      client_name: NAMES.client,
      supplier_name: NAMES.supplier,
      utility_name: NAMES.groupCategory,
    })}`,
  );

  console.log('\n# Non-metered GROUP confirm (one month — Alpha and Beta have separate Input Types)');
  console.log(
    `curl -sS -X POST "${B}/api/ingestion/confirm" -H "Authorization: Bearer ${K}" -H "Content-Type: application/json" -d ${j([
      {
        Company: NAMES.client,
        Facility: NAMES.facGroupAlpha,
        Provider: NAMES.supplier,
        Category: NAMES.groupCategory,
        'Input Type': NAMES.inputFuelAlpha,
        'Date Range': '01/03/2026 - 31/03/2026',
      },
      {
        Company: NAMES.client,
        Facility: NAMES.facGroupBeta,
        Provider: NAMES.supplier,
        Category: NAMES.groupCategory,
        'Input Type': NAMES.inputFuelBeta,
        'Date Range': '01/03/2026 - 31/03/2026',
      },
    ])}`,
  );
  console.log('\n# Non-metered GROUP inferred-empty (call after all invoices for a period are confirmed)');
  console.log(
    `curl -sS -X POST "${B}/api/ingestion/inferred-empty" -H "Authorization: Bearer ${K}" -H "Content-Type: application/json" -d ${j({
      client_name: NAMES.client,
      supplier_name: NAMES.supplier,
      category: NAMES.groupCategory,
    })}`,
  );

  console.log('\n# Non-metered LINE pending (BFcards)');
  console.log(
    `curl -sS -X POST "${B}/api/ingestion/pending" -H "Authorization: Bearer ${K}" -H "Content-Type: application/json" -d ${j({
      mode: 'line',
      client_name: NAMES.client,
      supplier_name: NAMES.supplier,
      utility_name: NAMES.inputLineStandalone,
      facility_name: NAMES.facLineOnly,
    })}`,
  );

  console.log('\n# Non-metered LINE pending (Agas national — omit facility_name when unique)');
  console.log(
    `curl -sS -X POST "${B}/api/ingestion/pending" -H "Authorization: Bearer ${K}" -H "Content-Type: application/json" -d ${j({
      mode: 'line',
      client_name: NAMES.client,
      supplier_name: NAMES.supplierAgasNational,
      utility_name: NAMES.inputAgasNationalLine,
    })}`,
  );

  console.log('\n# Metered pending');
  console.log(
    `curl -sS -X POST "${B}/api/ingestion/metered/pending" -H "Authorization: Bearer ${K}" -H "Content-Type: application/json" -d ${j({
      client_name: NAMES.client,
      supplier_name: NAMES.supplier,
      utility_name: NAMES.inputMeteredElectric,
      facility_name: NAMES.facLineOnly,
      identifier_type: 'NMI',
      lookup1: NAMES.meterNmi,
    })}`,
  );

  console.log('\nDone.\n');
}

const args = new Set(process.argv.slice(2));
const force = args.has('--force');
const teardown = args.has('--teardown');

(async () => {
  const supabase = getSupabase();
  if (teardown) {
    await deleteSandboxClient(supabase);
    process.exit(0);
  }

  const { data: existing } = await supabase.from('clients').select('id').eq('name', NAMES.client).maybeSingle();
  if (existing?.id && !force) {
    console.error(
      `Sandbox client already exists (id=${existing.id}). Run with --force to delete and recreate, or --teardown to remove.`,
    );
    process.exit(1);
  }

  if (force) {
    await deleteSandboxClient(supabase);
  }

  await seed();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
