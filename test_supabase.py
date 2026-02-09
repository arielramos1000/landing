import os
import json
import uuid
import urllib.request
import urllib.error

base_url = os.environ.get('SUPABASE_URL', '').rstrip('/')
key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')

if not base_url or not key:
    raise SystemExit('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running.')

headers = {
    'Authorization': f'Bearer {key}',
    'apikey': key
}

sample_kml = b'<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><name>Teste</name></Placemark></kml>'
file_id = uuid.uuid4()
path = f'leads/{file_id}/teste.kml'

storage_url = f"{base_url}/storage/v1/object/kml-uploads/{path}"

req = urllib.request.Request(
    storage_url,
    data=sample_kml,
    method='POST',
    headers={**headers, 'Content-Type': 'application/vnd.google-earth.kml+xml'}
)

try:
    with urllib.request.urlopen(req) as resp:
        print('Storage upload status:', resp.status)
        print(resp.read().decode('utf-8', errors='ignore'))
except urllib.error.HTTPError as exc:
    print('Storage upload failed:', exc.code, exc.read().decode('utf-8', errors='ignore'))
    raise SystemExit(1)
except Exception as exc:
    print('Storage upload failed:', exc)
    raise SystemExit(1)

payload = {
    'nome': 'Teste Local',
    'whatsapp': '11999999999',
    'cidade': 'Sao Paulo',
    'estado': 'SP',
    'prompt_text': 'Teste de envio local',
    'kml_path': path,
    'kml_filename': 'teste.kml',
    'ip_address': '127.0.0.1',
    'user_agent': 'local-test'
}

insert_url = f"{base_url}/rest/v1/lead_submissions"
req = urllib.request.Request(
    insert_url,
    data=json.dumps(payload).encode('utf-8'),
    method='POST',
    headers={**headers, 'Content-Type': 'application/json', 'Prefer': 'return=representation'}
)

try:
    with urllib.request.urlopen(req) as resp:
        print('Insert status:', resp.status)
        print(resp.read().decode('utf-8', errors='ignore'))
except urllib.error.HTTPError as exc:
    print('Insert failed:', exc.code, exc.read().decode('utf-8', errors='ignore'))
    raise SystemExit(1)
except Exception as exc:
    print('Insert failed:', exc)
    raise SystemExit(1)
