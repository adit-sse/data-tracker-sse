# Facility aliases

## What this solves

Ingestion resolves a facility from the NGERS `Facility` column. Most clients put the
facility's name there. Some don't.

**Fredon** puts the site's **street address** in `Facility`, while the facility itself is named
after the business unit:

```
Company:  "Fredon Industries Pty Ltd"                    → the client
Facility: "Tenancy 1/119-121 Gladstone St, Fyshwick"     → an address, not a facility name
                                                            ↓ must resolve to
                                                           "Fredon ACT"
```

`facility_aliases` records those alternative names. One facility can have many aliases —
`Fredon ACT` covers both Fyshwick tenancies *and* Wagga Wagga — which is why this is a separate
table rather than the single `facilities.address` column.

## ⚠️ Standing obligation: new Fredon sites need an alias

**Every time Fredon adds a site, someone must add its address to `facility_aliases`.**
Nothing does this automatically.

**If you forget**, ingestion fails with a clear error:

```
404 — Facility "12 New Road, Somewhere" not found for client "Fredon Industries Pty Ltd"
```

That is the intended behaviour. The row is rejected; nothing is guessed at, and nothing is
silently attached to the wrong facility. Fix it by adding the alias and re-running.

> **Do not add a "closest match" fallback to make this error go away.** The mapping is not
> inferable from the address — `61 Spring St, Wagga Wagga` is in NSW but belongs to
> `Fredon ACT`. A fallback would file consumption against the wrong facility with no symptom.

## Adding an alias

```sql
insert into facility_aliases (facility_id, alias, note)
select f.id,
       '12 New Road, Somewhere',
       'Fredon NGERS export sends the site address in the Facility column'
  from facilities f
  join clients c on c.id = f.client_id
 where c.name ilike 'Fredon%'
   and f.name = 'Fredon ACT'      -- the business unit this site belongs to
on conflict do nothing;
```

If the facility itself doesn't exist yet, create it first — via the app, or:

```sql
insert into facilities (client_id, name)
select c.id, 'Fredon New Unit' from clients c where c.name ilike 'Fredon%';
```

## How resolution works

```
Facility column value
   │
   ├─▶ 1. facility_aliases        exact, case-insensitive, scoped to the client
   │                              ── curated, so it wins over fuzzy matching
   ├─▶ 2. get_facility_by_name    RPC: ILIKE, then pg_trgm similarity
   │
   └─▶ 3. 404 "Facility ... not found"
```

Aliases are checked **first** on purpose. Step 2 falls back to trigram similarity, and an address
is exactly the kind of string that can fuzzily match the wrong facility name. An explicit mapping
should beat an inferred one.

Implemented in `lib/name-lookup.ts` (`lookupFacilityByAlias`). Because it lives in
`lookupFacilityByName`, it applies to **both** API ingestion and CSV/XLSX upload — without it,
uploading a Fredon spreadsheet would create new facilities named after addresses.

If two of a client's facilities somehow share an alias, resolution **fails loudly** rather than
picking one:

```
Alias "..." maps to more than one facility for this client ("A", "B").
Remove the duplicate in facility_aliases.
```

## Verifying the seed

Migration `024` seeds Fredon's 23 known addresses across 12 facilities. It skips any whose
facility doesn't exist. To see what mapped:

```sql
select f.name as facility, count(*) as aliases,
       string_agg(a.alias, ' | ' order by a.alias) as addresses
  from facility_aliases a
  join facilities f on f.id = a.facility_id
  join clients c on c.id = f.client_id
 where c.name ilike 'Fredon%'
 group by f.name
 order by f.name;
```

Expect **12 facilities / 23 aliases**. Fewer means a facility named in the seed doesn't exist
under the Fredon client — check the name matches exactly (`Fredon Aserve VIC`, not `Aserve VIC`).

To find addresses arriving from n8n that have no alias, check the ingestion event log for 404s
mentioning `Facility "..." not found`.

## Known Fredon facilities

| Facility | Addresses |
|---|---|
| Fredon Industries | 123-133 Wetherill St Silverwater · FL14 SE 67/88 Pitt Street |
| Fredon ACT | Tenancy 1 & 2/119-121 Gladstone St Fyshwick · 61 Spring St Wagga Wagga |
| Fredon Queensland | 7 Welch St Underwood |
| Fredon Electrical | 260a Darebin Rd Thornbury · 24 Drummond St Ballarat · 61-65 Main St Pakenham |
| Fredon Sturdie Trade Services | U13 1378 Lytton Rd Hemmant · U2 22-32 Kinkaid Ave North Plympton · 59 Main St Port Augusta · 95 West St Torrensville |
| Fredon Aserve VIC | U6 76 Maribyrnong St Footscray · 7 Arco Lane Heatherton |
| Fredon WA | 16 Munt St Bayswater · 21 Broadbank Lane Beachlands · U3 272 Hay St Subiaco |
| Fredon Air Services | 4/10 Exeter Way Caloundra West · 10 Louis Court Coomera |
| Fredon Infrastructure | U62 37 Borec Rd Penrith |
| Fredon Air NSW | U106 2 Albert Street St Randwick |
| Fredon Air WA | U1 27 Stroud St Beachlands |

Note `U6, 76 Maribyrnong St, Footscray` appears in some source exports as `Aserve VIC`; the
correct facility is **`Fredon Aserve VIC`**.

## Using this for another client

Nothing here is Fredon-specific — the table and lookup are generic. For a new client whose export
uses non-standard facility identifiers, insert their aliases the same way. No code change.
