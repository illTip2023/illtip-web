import sys
F=sys.argv[1]; strip=open(sys.argv[2]).read()
s=open(F).read()
if 'class="recognition"' in s: print('ALREADY'); sys.exit(0)
anchors=['<section class="stats" aria-labelledby="stats-h">','<section _ngcontent-ng-c2056610676="" class="stats">']
anchor=next((a for a in anchors if s.count(a)==1), anchors[0])
n=s.count(anchor)
if n!=1: print('ANCHOR', n); sys.exit(1)
i=s.index(anchor); ls=s.rfind('\n',0,i)+1
s=s[:ls]+strip+s[ls:]
open(F,'w').write(s); print('OK', len(s))
