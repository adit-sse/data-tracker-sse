-- Seed Fredon's address → facility aliases.
--
-- Fredon's NGERS export puts the site's street address in the Facility column,
-- while the facility itself is named after the business unit (Fredon ACT,
-- Fredon Queensland, …). These 23 addresses map onto 12 facilities.
--
-- Note the mapping is NOT inferable from the address: "61 Spring St, Wagga Wagga"
-- is in NSW but belongs to Fredon ACT. It has to be recorded explicitly.
--
-- Idempotent: ON CONFLICT DO NOTHING, so re-running adds only what is missing.
--
-- Rows whose facility does not exist are silently skipped by the join. Run the
-- verification query at the bottom of docs/facility-aliases.md afterwards to see
-- which addresses did not map.

WITH client_row AS (
  SELECT id
    FROM public.clients
   WHERE name ILIKE 'Fredon%'
   ORDER BY length(name)
   LIMIT 1
),
mapping (alias, facility_name) AS (
  VALUES
    ('123-133 Wetherill St, Silverwater',           'Fredon Industries'),
    ('FL14 SE 67/88 Pitt Street',                   'Fredon Industries'),
    ('Tenancy 1/119-121 Gladstone St, Fyshwick',    'Fredon ACT'),
    ('Tenancy 2/119-121 Gladstone St, Fyshwick',    'Fredon ACT'),
    ('61 Spring St, Wagga Wagga',                   'Fredon ACT'),
    ('7 Welch St, Underwood',                       'Fredon Queensland'),
    ('260a Darebin Rd, Thornbury',                  'Fredon Electrical'),
    ('24 Drummond St, Ballarat',                    'Fredon Electrical'),
    ('61-65 Main St, Pakenham',                     'Fredon Electrical'),
    ('U13, 1378 Lytton Rd, Hemmant',                'Fredon Sturdie Trade Services'),
    ('U2, 22-32 Kinkaid Avenue, North Plympton',    'Fredon Sturdie Trade Services'),
    ('59 Main St, Port Augusta',                    'Fredon Sturdie Trade Services'),
    ('95 West St, Torrensville',                    'Fredon Sturdie Trade Services'),
    ('U6, 76 Maribyrnong St, Footscray',            'Fredon Aserve VIC'),
    ('7 Arco Lane, Heatherton',                     'Fredon Aserve VIC'),
    ('16 Munt St, Bayswater',                       'Fredon WA'),
    ('21 Broadbank Lane, Beachlands',               'Fredon WA'),
    ('U3, 272 Hay St, Subiaco',                     'Fredon WA'),
    ('4/10 Exeter Way, Caloundra West',             'Fredon Air Services'),
    ('10 Louis Court, Coomera',                     'Fredon Air Services'),
    ('U62, 37 Borec Rd, Penrith',                   'Fredon Infrastructure'),
    ('U106, 2 Albert Street St, Randwick',          'Fredon Air NSW'),
    ('U1 27 Stroud St, Beachlands',                 'Fredon Air WA')
)
INSERT INTO public.facility_aliases (facility_id, alias, note)
SELECT f.id, m.alias, 'Fredon NGERS export sends the site address in the Facility column'
  FROM mapping m
  JOIN client_row c ON true
  JOIN public.facilities f
    ON f.client_id = c.id
   AND lower(btrim(f.name)) = lower(btrim(m.facility_name))
ON CONFLICT DO NOTHING;
