#!/usr/bin/env python3
"""Patch docx footers: PAGE -> PAGE \\* ROMAN / \\* arabic per section, strip empty pgNumType (WPS compat)."""
import sys, zipfile, shutil, re, os

path = sys.argv[1]
tmp = path + ".tmp"
shutil.copy(path, tmp)

with zipfile.ZipFile(tmp, "r") as zin:
    names = zin.namelist()
    data = {n: zin.read(n) for n in names}

# document.xml: find section order and remove empty pgNumType
docxml = data["word/document.xml"].decode("utf-8")
docxml = docxml.replace("<w:pgNumType/>", "")

# map footer rIds in order of sectPr appearance
sectprs = re.findall(r"<w:sectPr[\s\S]*?</w:sectPr>", docxml)
footer_fmt = {}  # footer file -> 'ROMAN' | 'arabic'
for sp in sectprs:
    fmt = "arabic"
    m = re.search(r'<w:pgNumType[^>]*w:fmt="([^"]+)"', sp)
    if m and "oman" in m.group(1):
        fmt = "ROMAN"
    for rid in re.findall(r'<w:footerReference[^>]*r:id="([^"]+)"', sp):
        footer_fmt[rid] = fmt

# resolve rIds to footer files via document rels
rels = data["word/_rels/document.xml.rels"].decode("utf-8")
rid2file = dict(re.findall(r'Id="([^"]+)"[^>]*Target="(footer\d+\.xml)"', rels))

for rid, fmt in footer_fmt.items():
    fname = "word/" + rid2file.get(rid, "")
    if fname not in data:
        continue
    fx = data[fname].decode("utf-8")
    fx = re.sub(r"(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)",
                r"\1 PAGE \\* " + fmt + r" \\* MERGEFORMAT \2", fx)
    data[fname] = fx.encode("utf-8")
    print(f"patched {fname} -> {fmt}")

data["word/document.xml"] = docxml.encode("utf-8")

with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zout:
    for n, d in data.items():
        zout.writestr(n, d)
os.remove(tmp)
print("footer patch done:", path)
