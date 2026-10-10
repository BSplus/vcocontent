"""Render supplied reference covers and inspect workbook headings without installs."""
from pathlib import Path
import zipfile
import xml.etree.ElementTree as ET
import pymupdf

out = Path("generated-artifacts/video-review")
out.mkdir(parents=True, exist_ok=True)
for source in sorted(Path("attached_assets").glob("*1791615944469.pdf")):
    with pymupdf.open(source) as doc:
        doc[0].get_pixmap(matrix=pymupdf.Matrix(1, 1)).save(out / (source.stem + ".png"))
        print(source.name, "pages:", len(doc), "heading:", doc[0].get_text()[:240])
ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
for source in sorted(Path("attached_assets").glob("*1791615944469.xlsx")):
    with zipfile.ZipFile(source) as z:
        print("\n", source.name)
        workbook = ET.fromstring(z.read("xl/workbook.xml"))
        print("Sheets:", [s.attrib["name"] for s in workbook.findall("s:sheets/s:sheet", ns)])
        strings = []
        if "xl/sharedStrings.xml" in z.namelist():
            strings = ["".join(si.itertext()) for si in ET.fromstring(z.read("xl/sharedStrings.xml"))]
        for name in sorted(n for n in z.namelist() if n.startswith("xl/worksheets/sheet") and n.endswith(".xml")):
            root = ET.fromstring(z.read(name))
            print(name)
            for row in root.findall("s:sheetData/s:row", ns)[:8]:
                values = []
                for c in row:
                    v = c.find("s:v", ns)
                    value = v.text if v is not None else "".join(c.itertext())
                    if c.attrib.get("t") == "s":
                        value = strings[int(value)]
                    values.append(value)
                print(values)
