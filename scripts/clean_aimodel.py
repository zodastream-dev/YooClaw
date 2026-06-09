#!/usr/bin/env python3
"""Clean metaso-pro aiModel values from Supabase report_sites table.
Runs on the YooClaw server which has Python3 and curl available."""
import json, os, subprocess, sys

API = os.environ.get('API', 'https://rkuhyntqzbgocwprmik.supabase.co')
KEY = os.environ.get('KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrdWh5bnRxemJnb2N3cHJtaW4iLCJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNzQ3OTg0MDAwLCJleHAiOjIwNjM1NjAwMDB9.VZ8g0kzW9bxEeM13Tr2aAafxA3hMeem30CrUDz0-CI')

HEADERS = ['-H', 'apikey: ' + KEY, '-H', 'Authorization: Bearer ' + KEY]

def curl_get(url):
    result = subprocess.run(['curl', '-s'] + HEADERS + [url],
                           capture_output=True, text=True, timeout=30)
    return json.loads(result.stdout)

def curl_patch(url, data):
    subprocess.run(['curl', '-s', '-X', 'PATCH'] + HEADERS +
                   ['-H', 'Content-Type: application/json',
                    '-H', 'Prefer: return=minimal',
                    '-d', data, url],
                   capture_output=True, timeout=30)

# Fetch all portals
SELECT = 'id,slug,widgets'
url = f'{API}/rest/v1/report_sites?type=eq.portal&select={SELECT}'
print('Fetching portals...')
rows = curl_get(url)
print(f'Found {len(rows)} portals')

fixed = 0
for row in rows:
    widgets = row['widgets']
    if isinstance(widgets, str):
        widgets = json.loads(widgets)
    if not isinstance(widgets, list):
        continue

    changed = False
    for w in widgets:
        sources_list = (w.get('sources') or []) + (w.get('config', {}).get('sources') or [])
        for s in sources_list:
            if s.get('aiModel') == 'metaso-pro':
                s['aiModel'] = 'deepseek-v4-flash'
                changed = True
                fixed += 1
        if w.get('aiModel') == 'metaso-pro':
            w['aiModel'] = 'deepseek-v4-flash'
            changed = True
            fixed += 1

    if changed:
        patch_url = f'{API}/rest/v1/report_sites?id=eq.{row["id"]}'
        data = json.dumps({'widgets': json.dumps(widgets)})
        curl_patch(patch_url, data)
        slug = row.get('slug', row['id'])
        print(f'  Fixed: {slug}')

print(f'Total fixed: {fixed}')
