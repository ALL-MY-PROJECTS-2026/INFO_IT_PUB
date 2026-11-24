import re
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps
from pypdf import PdfReader, PdfWriter
from pypdf.errors import PdfReadError


class PdfToolError(Exception):
    """창에 그대로 보여 줄 안내 문장을 담는 오류"""


def 번호순(path):
    # "스캔 (10).pdf" -> ["스캔 (", 10, ").pdf"] 처럼 숫자 부분은 숫자로 비교
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", Path(path).name)]


def pdf_합치기(files, out):
    writer = PdfWriter()
    for f in files:
        try:
            reader = PdfReader(f)
        except (PdfReadError, OSError):
            raise PdfToolError(f"열 수 없는 PDF입니다: {Path(f).name}")
        if reader.is_encrypted:
            raise PdfToolError(f"암호가 걸린 파일은 넣을 수 없습니다: {Path(f).name}")
        writer.append(reader)
    writer.write(out)
    return len(writer.pages)


def _사진_열기(files):
    images = []
    for f in files:
        try:
            # 휴대폰 사진의 회전 정보대로 세운 뒤 넣는다(5편)
            images.append(ImageOps.exif_transpose(Image.open(f)).convert("RGB"))
        except OSError:
            raise PdfToolError(f"열 수 없는 사진입니다: {Path(f).name}")
    return images


def 사진_pdf(files, out, quality=75, scale=1.0, images=None):
    images = images or _사진_열기(files)
    pages = [im.resize((round(im.width * scale), round(im.height * scale))) for im in images]
    pages[0].save(out, save_all=True, append_images=pages[1:], quality=quality)
    return len(pages)


def 용량_맞추기(files, out, limit_mb, 최소_크기=0.2):
    limit = limit_mb * 1024 * 1024
    images = _사진_열기(files)
    quality, scale = 85, 1.0
    while True:
        사진_pdf(files, out, quality, scale, images)
        size = Path(out).stat().st_size
        if size <= limit:
            return size
        if quality > 50:
            quality = max(quality - 10, 50)   # 50 밑으로는 내리지 않는다
        elif scale * 0.8 >= 최소_크기:
            scale *= 0.8                      # 그래도 크면 사진 크기를 줄인다
        else:
            raise PdfToolError(f"사진을 원래의 {scale:.0%}까지 줄여도 {limit_mb}MB 아래로 내려가지 않습니다")


사진_확장자 = {".jpg", ".jpeg", ".png"}


def 섞어_합치기(files, out, quality=None, scale=1.0):
    writer = PdfWriter()
    for f in files:
        if Path(f).suffix.lower() in 사진_확장자:
            # 사진은 한 쪽짜리 PDF로 만들어 메모리에 두었다가 이어 붙인다
            buf = BytesIO()
            _사진_열기([f])[0].save(buf, format="PDF", quality=85)
            writer.append(PdfReader(buf))
            continue
        try:
            reader = PdfReader(f)
        except (PdfReadError, OSError):
            raise PdfToolError(f"열 수 없는 PDF입니다: {Path(f).name}")
        if reader.is_encrypted:
            raise PdfToolError(f"암호가 걸린 파일은 넣을 수 없습니다: {Path(f).name}")
        writer.append(reader)

    if quality is not None:
        # 쪽 안에 들어 있는 그림(사진·스캔)만 다시 저장한다. 글자는 그대로 둔다
        for page in writer.pages:
            for img in page.images:
                im = img.image.convert("RGB")
                if scale < 1:
                    im = im.resize((round(im.width * scale), round(im.height * scale)))
                img.replace(im, quality=quality)
    writer.write(out)
    return len(writer.pages)


def 전체_용량_맞추기(files, out, limit_mb, 최소_크기=0.2, 알림=print):
    limit = limit_mb * 1024 * 1024
    섞어_합치기(files, out)
    size = Path(out).stat().st_size
    알림(f"그대로 합침: {size / 1024 / 1024:.1f}MB")
    if size <= limit:
        return size

    # 합친 파일을 한 번만 읽고, 쪽 안 그림도 처음 한 번만 풀어 둔다
    writer = PdfWriter(clone_from=out)
    그림들 = [(img, img.image.convert("RGB")) for page in writer.pages for img in page.images]
    quality, scale = 75, 1.0
    for _ in range(6):
        for img, 원본 in 그림들:
            im = 원본 if scale >= 1 else 원본.resize((round(원본.width * scale), round(원본.height * scale)))
            img.replace(im, quality=quality)
        writer.write(out)
        size = Path(out).stat().st_size
        알림(f"화질 {quality}, 크기 {scale:.0%}: {size / 1024 / 1024:.1f}MB")
        if size <= limit:
            return size
        # 파일 크기는 그림의 가로×세로에 거의 비례하므로, 목표의 90%가 되도록 한 번에 줄인다
        scale = scale * (limit * 0.9 / size) ** 0.5
        if scale < 최소_크기:
            raise PdfToolError(f"그림을 원래의 {최소_크기:.0%}까지 줄여도 {limit_mb}MB 아래로 내려가지 않습니다")
    raise PdfToolError(f"{limit_mb}MB에 맞추지 못했습니다")
