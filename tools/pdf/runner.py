import json
import time
from pathlib import Path

from pypdf import PdfReader

import pdf_core


def 실행(names, limit_mb, 알림):
    """화면 목록 순서 그대로 합치고, 용량을 정했으면 거기에 맞춘다. 결과는 JSON 문자열로 돌려준다."""
    files = [Path("/in") / n for n in names]
    out = "/out.pdf"
    t = time.time()
    try:
        if limit_mb:
            size = pdf_core.전체_용량_맞추기(files, out, limit_mb, 알림=알림)
        else:
            pdf_core.섞어_합치기(files, out)
            size = Path(out).stat().st_size
    except pdf_core.PdfToolError as e:
        return json.dumps({"ok": False, "msg": str(e)}, ensure_ascii=False)
    r = PdfReader(out)
    links = sum(1 for p in r.pages for a in (p.get("/Annots") or []) if a.get_object().get("/Subtype") == "/Link")
    return json.dumps({"ok": True, "pages": len(r.pages), "size": size, "outline": len(r.outline),
                       "links": links, "sec": round(time.time() - t, 1)}, ensure_ascii=False)
