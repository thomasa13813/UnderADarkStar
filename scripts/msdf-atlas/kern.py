import json, sys
from fontTools.ttLib import TTFont
font_path, charset_path, out_path = sys.argv[1:4]
f = TTFont(font_path)
cmap = f.getBestCmap()
upm = f['head'].unitsPerEm
scale = 48 / upm
g = f['GPOS'].table
# Lookups of the 'kern' feature for the Latin script's default language.
feat_idx = None
for sr in g.ScriptList.ScriptRecord:
    if sr.ScriptTag == 'latn':
        feat_idx = sr.Script.DefaultLangSys.FeatureIndex
lookups = []
for i in feat_idx:
    fr = g.FeatureList.FeatureRecord[i]
    if fr.FeatureTag == 'kern':
        lookups += fr.Feature.LookupListIndex
print('latn kern lookups', lookups, file=sys.stderr)

def pair_value(st, a, b):
    cov = st.Coverage.glyphs
    if a not in cov:
        return None
    if st.Format == 1:
        ps = st.PairSet[cov.index(a)]
        for rec in ps.PairValueRecord:
            if rec.SecondGlyph == b:
                v = rec.Value1
                return getattr(v, 'XAdvance', 0) or 0 if v else 0
        return None
    c1 = st.ClassDef1.classDefs.get(a, 0)
    c2 = st.ClassDef2.classDefs.get(b, 0)
    v = st.Class1Record[c1].Class2Record[c2].Value1
    return (getattr(v, 'XAdvance', 0) or 0) if v else 0

chars = [c for c in open(charset_path, encoding='utf-8').read() if ord(c) in cmap]
out = []
for a in chars:
    ga = cmap[ord(a)]
    for b in chars:
        gb = cmap[ord(b)]
        total = 0
        for li in lookups:
            for st in g.LookupList.Lookup[li].SubTable:
                v = pair_value(st, ga, gb)
                if v is not None:
                    total += v
                    break
        amt = round(total * scale)
        if amt:
            out.append({'first': ord(a), 'second': ord(b), 'amount': amt})
json.dump(out, open(out_path, 'w'))
print(len(out), 'pairs, range', min(k['amount'] for k in out), max(k['amount'] for k in out), file=sys.stderr)
