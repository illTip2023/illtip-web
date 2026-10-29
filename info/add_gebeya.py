import sys
F=sys.argv[1]
s=open(F).read()
if 'Dala Studio' in s: print('ALREADY'); sys.exit(0)
i=s.find('class="recognition"')
if i<0 or s.count('class="recognition"')!=1: print('NO STRIP'); sys.exit(1)
j=s.find('</section>', i)
ls=s.rfind('\n',0,j)+1
add='''          <p style="margin:18px 0 10px;font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#5b6b85;">Distribution partner</p>
          <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:12px;">
            <span style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border:1px solid #d9e1ef;border-radius:999px;background:#fff;color:#1A2B4B;font-weight:600;font-size:15px;"><span style="width:10px;height:10px;border-radius:50%;background:#1A2B4B;display:inline-block;"></span>Gebeya Dala Studio</span>
          </div>
          <p style="margin:10px auto 0;max-width:560px;font-size:14px;color:#5b6b85;">i'llTip is a distribution partner for Gebeya's Dala Studio across Nigeria and Africa.</p>
'''
s=s[:ls]+add+s[ls:]
open(F,'w').write(s); print('OK', len(s))
