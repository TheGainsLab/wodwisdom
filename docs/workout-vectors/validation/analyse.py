import json, math, statistics as st, sys
sys.path.insert(0,'..'); sys.path.insert(0,'.')
from runner import AXES
from results import R, name
B='../'  # run from this folder; vectors live in the parent
V=json.load(open(B+'vectors.json')); V2=json.load(open(B+'test-repeat/vectors.json')); X=json.load(open(B+'extra-sheets/vectors.json'))
VS=json.load(open(B+'vectors-sonnet.json'))
S=json.load(open(B+'fact-sheets.json')); SX=json.load(open(B+'extra-sheets/sheets.json')); rep=json.load(open(B+'fact-sheet-repeats.json')); rep['15.2']='14.2'
def canon(w): return rep.get(w,w)
def vec(w):
    w=canon(w)
    if w in V: return [ (V[w]['vector'][a]+V2['O.'+w]['vector'][a])/2 for a in AXES]
    if w in X: return [X[w]['vector'][a] for a in AXES]
def vecs(w):
    w=canon(w); return [VS[w]['vector'][a] for a in AXES] if w in VS else None
def mov(w):
    w=canon(w); s=S.get(w) or SX[w]; return {m['movement'] for m in s['movements']}
def l1(a,b): return sum(abs(x-y) for x,y in zip(a,b))/2
def euc(a,b): return math.sqrt(sum((x-y)**2 for x,y in zip(a,b)))
def cos(a,b): return 1-sum(x*y for x,y in zip(a,b))/math.sqrt(sum(x*x for x in a)*sum(y*y for y in b))
def js(a,b):
    p=[x/100+1e-9 for x in a]; q=[x/100+1e-9 for x in b]; m=[(x+y)/2 for x,y in zip(p,q)]
    kl=lambda u,v: sum(x*math.log(x/y) for x,y in zip(u,v)); return math.sqrt((kl(p,m)+kl(q,m))/2)
def rank(v):
    o=sorted(range(len(v)),key=lambda i:v[i]); r=[0.0]*len(v); i=0
    while i<len(o):
        j=i
        while j+1<len(o) and v[o[j+1]]==v[o[i]]: j+=1
        for k in range(i,j+1): r[o[k]]=(i+j)/2
        i=j+1
    return r
def pear(a,b):
    ma,mb=st.mean(a),st.mean(b); da=sum((x-ma)**2 for x in a); db=sum((y-mb)**2 for y in b)
    return sum((x-ma)*(y-mb) for x,y in zip(a,b))/math.sqrt(da*db) if da and db else float('nan')
def spear(a,b): return pear(rank(a),rank(b))
rows=[]
for y,(n,d) in sorted(R.items()):
    mr=st.mean(v[1] for v in d.values()); mraw=st.mean(v[0] for v in d.values())
    for (a,b),(raw,res) in d.items():
        wa,wb=name(y,a),name(y,b); va,vb=vec(wa),vec(wb)
        sa,sb=vecs(wa),vecs(wb); ma,mb=mov(wa),mov(wb)
        rows.append(dict(y=y,a=wa,b=wb,raw=raw-mraw,res=res-mr,res0=res,l1=l1(va,vb),euc=euc(va,vb),cos=cos(va,vb),js=js(va,vb),
                         ov=1-len(ma&mb)/len(ma|mb),son=l1(sa,sb) if sa and sb else None))
if __name__=='__main__':
    print('years',sorted(R),'pairs',len(rows))
    g=lambda k,rs=rows:[r[k] for r in rs]
    print('PRIMARY spearman(L1 distance, centred resid_corr) = %.3f'%spear(g('l1'),g('res')))
    print('BASELINE spearman(movement overlap distance, centred resid_corr) = %.3f'%spear(g('ov'),g('res')))
    for k in ('euc','cos','js'): print(' %s: %.3f'%(k,spear(g(k),g('res'))))
    print(' L1 vs centred raw_corr: %.3f ; overlap vs raw: %.3f'%(spear(g('l1'),g('raw')),spear(g('ov'),g('raw'))))
    rs=[r for r in rows if r['son'] is not None]
    print(' sonnet L1 (n=%d): %.3f ; opus on same pairs: %.3f'%(len(rs),spear(g('son',rs),g('res',rs)),spear(g('l1',rs),g('res',rs))))
    # partial: does L1 add beyond overlap? residualise ranks
    def resid(a,b):
        ra,rb=rank(a),rank(b); beta=pear(ra,rb)*st.pstdev(ra)/st.pstdev(rb); mb=st.mean(rb); ma=st.mean(ra)
        return [x-ma-beta*(y-mb) for x,y in zip(ra,rb)]
    print(' partial L1|overlap: %.3f ; partial overlap|L1: %.3f'%(pear(resid(g('l1'),g('ov')),resid(g('res'),g('ov'))),pear(resid(g('ov'),g('l1')),resid(g('res'),g('l1')))))
    print(' per year (n, L1, overlap):')
    for y in sorted(R):
        rs=[r for r in rows if r['y']==y]; print('  %d n=%2d  L1 %+.2f  overlap %+.2f'%(y,len(rs),spear(g('l1',rs),g('res',rs)),spear(g('ov',rs),g('res',rs))))
    nolift=[r for r in rows if not any(x in ('15.1a','18.2a','21.4','23.2B') for x in (r['a'],r['b']))]
    print(' without max-lift tests n=%d: L1 %.3f overlap %.3f'%(len(nolift),spear(g('l1',nolift),g('res',nolift)),spear(g('ov',nolift),g('res',nolift))))
    first=[r for r in rows if canon(r['a']) in V and canon(r['b']) in V]
    print(' first-batch vectors only n=%d: L1 %.3f overlap %.3f'%(len(first),spear(g('l1',first),g('res',first)),spear(g('ov',first),g('res',first))))
    srt=sorted(rows,key=lambda r:r['l1'])
    q=len(srt)//4
    for i,lab in enumerate(('closest quarter','2nd','3rd','farthest quarter')):
        seg=srt[i*q:(i+1)*q] if i<3 else srt[3*q:]
        print('  %-16s dist %2.0f-%2.0f  mean resid_corr %+.3f'%(lab,seg[0]['l1'],seg[-1]['l1'],st.mean(r['res0'] for r in seg)))
    import random
    rng=random.Random(1); obs=spear(g('l1'),g('res')); N=5000; cnt=0
    for _ in range(N):
        xs=[];ys=[]
        for y,(n,d) in R.items():
            k=max(max(p) for p in d); o=list(range(1,k+1)); rng.shuffle(o); mr=st.mean(v[1] for v in d.values())
            for (a,b),(raw,res) in d.items():
                xs.append(l1(vec(name(y,o[a-1])),vec(name(y,o[b-1])))); ys.append(res-mr)
        cnt+= spear(xs,ys)<=obs
    print(' shuffle test: %d of %d shuffles as negative as observed'%(cnt,N))
    big=[r for r in rows if len(R[r['y']][1])>=6]
    print(' years with 4+ workouts only n=%d: L1 %.3f'%(len(big),spear(g('l1',big),g('res',big))))
    print(' uncentred resid, same years: %.3f'%spear(g('l1',big),g('res0',big)))
    print(' mismatches (far but similar):',[(r['a'],r['b'],round(r['l1']),round(r['res0'],2)) for r in sorted(rows,key=lambda r:-r['res']) if r['l1']>55][:5])
    print(' mismatches (close but dissimilar):',[(r['a'],r['b'],round(r['l1']),round(r['res0'],2)) for r in sorted(rows,key=lambda r:r['res']) if r['l1']<40][:5])
