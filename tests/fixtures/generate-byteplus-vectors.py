"""Offline fixture regeneration from official SDK source files, no HTTP requests.
Download SignerV4.py, MetaData.py and Util.py from byteplus-sdk/byteplus-sdk-python
commit eddcf2bf0bfb5dd6d8bb52dc9c09b9efc21b0715 into a local directory; pass that
path as argv[1]. Only class ASTs are executed to avoid unrelated SDK dependencies.
Signing methods are unchanged; only the clock is fixed. Keys are fictional.
"""
import ast
import hashlib
import hmac
import json
import sys
from functools import reduce
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import quote

root = Path(sys.argv[1])
namespace = dict(hashlib=hashlib, hmac=hmac, sys=sys, json=json, quote=quote, reduce=reduce)
hashes = {}
for name in ['Util', 'MetaData', 'SignerV4']:
    source = (root / (name + '.py')).read_bytes()
    hashes[name] = hashlib.sha256(source).hexdigest()
    tree = ast.parse(source)
    classes = ast.Module(body=[node for node in tree.body if isinstance(node, ast.ClassDef)], type_ignores=[])
    exec(compile(classes, name + '.py', 'exec'), namespace)
signer = namespace['SignerV4']
timestamp = '20261015T052958Z'
signer.get_current_format_date = staticmethod(lambda: timestamp)
credentials = SimpleNamespace(ak='example-access-key', sk='example-secret-key', region='ap-singapore-1', service='cv')
vectors = []
for action in ['CVSync2AsyncSubmitTask', 'CVSync2AsyncGetResult', 'CVCancelTask']:
    payload = dict(req_key='realman_avatar_picture_omni20_cv')
    if action == 'CVSync2AsyncSubmitTask':
        payload.update(image_urls=['https://input.example.test/i?token=fictional'], audio_url='https://input.example.test/a?token=fictional', prompt='Sing softly — 静かに')
    else:
        payload['task_id'] = '7392616336519610409'
    body = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
    request = SimpleNamespace(path='/', method='POST', query=dict(Action=action, Version='2024-06-06'), headers={'Content-Type':'application/json', 'Host':'cv.byteplusapi.com'}, body=body)
    signer.sign(request, credentials)
    vectors.append(dict(action=action, body=body, headers={k.lower(): v for k,v in request.headers.items()}))
print(json.dumps(dict(sourceCommit='eddcf2bf0bfb5dd6d8bb52dc9c09b9efc21b0715', sourceSha256=hashes, timestamp=timestamp, accessKeyId=credentials.ak, secretAccessKey=credentials.sk, vectors=vectors), indent=2, ensure_ascii=False))
