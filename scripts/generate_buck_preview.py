"""Derive preview assets from the user's ASC, installed ASY symbols and exported RAW.
Reads the source files only; never changes the circuit or simulation.
"""
import bisect, json, math, os, sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = Path.home() / 'Downloads/Buck-converter.asc'
lines = source.read_text(encoding='cp1252').splitlines()
wires, symbols = [], []
for line in lines:
    p = line.split()
    if not p: continue
    if p[0] == 'WIRE': wires.append(list(map(int, p[1:])))
    if p[0] == 'SYMBOL':
        symbols.append(dict(kind=p[1], x=int(p[2]), y=int(p[3]), rotation=int(p[4][1:]), name='', value=''))
    if p[:2] == ['SYMATTR', 'InstName']: symbols[-1]['name'] = p[2]
    if p[:2] == ['SYMATTR', 'Value']: symbols[-1]['value'] = ' '.join(p[2:])
for symbol in symbols:
    paths = []
    for line in (Path(os.environ['LOCALAPPDATA']) / 'LTspice/lib/sym' / (symbol['kind'] + '.asy')).read_text().splitlines():
        p = line.split()
        if not p or p[0] not in ['LINE', 'CIRCLE', 'RECTANGLE', 'ARC']: continue
        n = list(map(float, p[2:]))
        if p[0] == 'LINE': paths.append(f'M{n[0]} {n[1]}L{n[2]} {n[3]}')
        elif p[0] == 'RECTANGLE': paths.append(f'M{n[0]} {n[1]}H{n[2]}V{n[3]}H{n[0]}Z')
        else:
            x1,y1,x2,y2 = n[:4]; rx,ry=abs(x2-x1)/2,abs(y2-y1)/2; cx,cy=(x1+x2)/2,(y1+y2)/2
            if p[0] == 'CIRCLE': paths.append(f'M{cx-rx} {cy}a{rx} {ry} 0 1 0 {rx*2} 0a{rx} {ry} 0 1 0 {-rx*2} 0')
            else:
                sx,sy,ex,ey=n[4:]; a=math.atan2((sy-cy)/ry,(sx-cx)/rx); b=math.atan2((ey-cy)/ry,(ex-cx)/rx)
                span=(a-b)%(2*math.pi)
                # ASY arc endpoint coordinates indicate direction on the ellipse.
                sx,sy=cx+rx*math.cos(a),cy+ry*math.sin(a); ex,ey=cx+rx*math.cos(b),cy+ry*math.sin(b)
                paths.append(f'M{sx} {sy}A{rx} {ry} 0 {int(span>math.pi)} 0 {ex} {ey}')
    symbol['paths'] = paths
db = sqlite3.connect(root / 'release/buck-switching.sqlite')
rows = db.execute('SELECT time, "V(n004)", "I(L1)", "I(D1)" FROM samples ORDER BY step, point').fetchall()
# LTspice second-order compression can mark samples with negative time.
# Same normalization as spicelib Axis.get_wave():
# https://pyltspice.readthedocs.io/en/stable/_modules/spicelib/raw/raw_classes.html
rows = [(abs(t), v, il, diode) for t,v,il,diode in rows]
assert all(rows[i][0] <= rows[i+1][0] for i in range(len(rows)-1)), 'Non-monotonic transient axis'
assert rows[0][0] == 0 and abs(rows[-1][0] - .05) < 1e-10
start, end = .01854, .01869
times = [row[0] for row in rows]
# Keep the neighboring samples on both sides so clipping interpolates the exact
# boundary, rather than truncating traces at the first/last in-window point.
first = max(0, bisect.bisect_left(times, start)-1)
last = min(len(rows), bisect.bisect_right(times, end)+1)
window = rows[first:last]
assert window[0][0] <= start and window[-1][0] >= end
assert min(r[1] for r in window) < 1 and max(r[1] for r in window) > 99
assert 4 < min(r[2] for r in window) < 4.5 and 5.5 < max(r[2] for r in window) < 6
assert min(r[3] for r in window) < .01 and max(r[3] for r in window) > 5.5
asset = dict(source='Buck-converter.asc', wires=wires, symbols=symbols,
             transient=dict(start=start,end=end,signals=['V(SW)','I(L1)','I(D1)'],samples=window),
             netlist=['* Buck converter', 'V1 N003 0 100', 'D1 0 SW D', 'L1 SW N005 1m', 'C1 N005 0 10µ', 'R1 N005 0 10', 'S1 SW N003 N001 N002 MOSFET', 'V2 N001 N002 PULSE(0 100 0 1n 1n {D/Fs} {1/Fs} 1Meg)', '.model D D', '.lib standard.dio', '.tran 50m', '.model MOSFET SW(Ron=1u Roff=100Meg Vt=90)', '* Switching frequency: 16 kHz', '.param Fs = 16k', '.param D = 0.5', '.backanno', '.end'])
target=root/'src-ui/src/assets/buck.json'; target.parent.mkdir(exist_ok=True)
target.write_text(json.dumps(asset,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print(f'{len(wires)} wires, {len(symbols)} symbols, {len(window)} unrounded RAW samples in 18.54-18.69ms -> {target}')
