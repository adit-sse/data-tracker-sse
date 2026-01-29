# Troubleshooting Guide - Meters & Upload Issues

## Issues Fixed in This Update:
1. ✅ Added XLSX support (was only CSV before)
2. ✅ Added extensive logging to meter creation
3. ✅ Better error messages throughout

## How to Debug the Meter Creation Issue

### Step 1: Check Browser Console

1. **Open Developer Tools** in your browser:
   - Press `F12` or right-click → "Inspect"
   - Go to the **Console** tab

2. **Try to create a meter** and watch for:
   - `Submitting meter data:` - Shows what's being sent
   - `API response:` - Shows what the server returns
   - Any red error messages

### Step 2: Check VS Code Terminal (Server Logs)

Look at your VS Code terminal where `npm run dev` is running:

**You should see logs like:**
```
Received meter data: { facility_id: '...', supplier_id: '...', ... }
Creating new meter...
Meter created successfully: { id: '...', ... }
```

**If you see errors:**
```
Supabase error creating meter: { message: '...', ... }
```

This tells us exactly what's failing!

### Step 3: Verify Supabase Connection

**Test your connection:**
1. Go to Supabase dashboard
2. Click "Table Editor"
3. Open the `meters` table
4. Are there any rows?

**Check your credentials:**
```powershell
# In VS Code terminal
code .env.local
```

Make sure:
- URL starts with `https://`
- No extra spaces
- No quotes around values
- Anon key is complete (very long string)

## Common Issues & Solutions

### Issue 1: "Failed to create meter"

**Possible causes:**
- Wrong Supabase credentials
- Network/firewall blocking requests
- Database permissions issue

**Solution:**
1. Check browser console for actual error
2. Check terminal logs
3. Verify `.env.local` is correct
4. Try manually in Supabase:
   ```sql
   INSERT INTO meters (facility_id, supplier_id, utility_category_id, identifier_type, lookup1)
   VALUES ('your-facility-id', 'your-supplier-id', 'your-category-id', 'NMI', 'test123');
   ```

### Issue 2: Meters don't show in invoice form

**This could be because:**
- Meters aren't actually being created
- Different client/facility context
- API isn't returning meters correctly

**To debug:**
1. Open browser console
2. Go to invoice form page
3. Look for log: `Fetching meters for client: ...`
4. Should see: `Found meters: X` (where X > 0)

### Issue 3: XLSX upload not working

**Was a bug - now fixed!**

**To test:**
1. Make sure you stopped the dev server (Ctrl+C)
2. Extract the new files
3. Restart: `npm run dev`
4. Try uploading an XLSX file
5. Watch browser console and terminal for errors

## Quick Test Procedure

### Test 1: Check if API is Working

Open browser console and run:
```javascript
fetch('/api/utility-categories')
  .then(r => r.json())
  .then(d => console.log('Utility categories:', d))
```

You should see 4 categories: ELECTRICITY, GAS, FUEL, OIL

### Test 2: Check if Suppliers API Works

```javascript
fetch('/api/suppliers')
  .then(r => r.json())
  .then(d => console.log('Suppliers:', d))
```

You should see your suppliers list.

### Test 3: Manually Test Meter Creation

```javascript
fetch('/api/meters', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    facility_id: 'your-facility-id-here',
    supplier_id: 'your-supplier-id-here',
    utility_category_id: 'your-category-id-here',
    identifier_type: 'NMI',
    lookup1: 'TEST123456',
    lookup2: null
  })
})
.then(r => r.json())
.then(d => console.log('Result:', d))
```

Replace the IDs with real ones from your database.

## Getting the Right IDs

To find your IDs for testing:

**In Supabase:**
1. Go to Table Editor
2. Open `facilities` table
3. Copy an `id` value
4. Open `suppliers` table
5. Copy an `id` value
6. Open `utility_categories` table
7. Copy an `id` value for ELECTRICITY

## What to Send Me for Help

If it's still not working, send me:

1. **Browser console errors** (screenshot or copy text)
2. **VS Code terminal logs** (the lines around the error)
3. **What you see when you try to create a meter**
4. **Supabase project URL** (just the domain, not the key!)

Example:
```
Browser console shows:
API response: { error: "Failed to create meter", details: "..." }

Terminal shows:
Supabase error creating meter: { message: "...", code: "..." }
```

## Emergency Reset

If things are really broken:

```powershell
# Stop server
Ctrl+C

# Clear Next.js cache
Remove-Item -Recurse -Force .next

# Restart
npm run dev
```

## Verifying the Fix Worked

After updating:

1. **XLSX should work** - Try uploading an .xlsx file
2. **Better errors** - You should see detailed error messages
3. **Logs everywhere** - Check browser console and terminal for detailed logs

Let me know what you see!
