from pathlib import Path
import json, mimetypes, shutil
root = Path(__file__).resolve().parents[1]
out = root / 'outputs' / 'site'
if out.exists():
    shutil.rmtree(out)
(out / 'server').mkdir(parents=True)
(out / '.openai').mkdir()
assets = {}
for file in (root / 'dist').rglob('*'):
    if file.is_file() and not file.name.startswith('.'):
        kind = mimetypes.guess_type(str(file))[0] or 'application/octet-stream'
        if file.suffix == '.mjs':
            kind = 'application/javascript'
        assets['/' + file.relative_to(root / 'dist').as_posix()] = {'body': file.read_text(), 'type': kind + '; charset=utf-8'}
worker = (root / 'worker' / 'index.js').read_text().replace("import {productLookup} from './products.mjs';\n", '')
products = (root / 'worker' / 'products.mjs').read_text().replace('export ', '')
(out / 'server' / 'index.js').write_text('const SITE_ASSETS = ' + json.dumps(assets) + ';\n' + products + '\n' + worker)
shutil.copy(root / '.openai' / 'hosting.json', out / '.openai' / 'hosting.json')
shutil.copytree(root / 'drizzle', out / 'drizzle')
print('Built outputs/site/server/index.js')
