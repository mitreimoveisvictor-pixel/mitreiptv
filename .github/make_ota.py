# Gera os arquivos de atualização automática (pasta ota/ do site no GitHub)
import re, json, os, sys
src = sys.argv[1] if len(sys.argv) > 1 else 'src'
out = sys.argv[2] if len(sys.argv) > 2 else '_site/ota'
os.makedirs(out, exist_ok=True)
js = open(src + '/app.js', encoding='utf-8').read()
v = re.search(r"var APP_VER = '([\d.]+)'", js).group(1)
h = open(src + '/index.html', encoding='utf-8').read()
body = re.search(r'<body[^>]*>(.*)</body>', h, re.S).group(1)
body = re.sub(r'<script\b[^>]*>.*?</script>', '', body, flags=re.S)
open(out + '/body.html', 'w', encoding='utf-8').write(body)
open(out + '/app.js', 'w', encoding='utf-8').write(js)
open(out + '/style.css', 'w', encoding='utf-8').write(open(src + '/style.css', encoding='utf-8').read())
json.dump({'v': v}, open(out + '/ota.json', 'w'))
print('ota', v, out)
