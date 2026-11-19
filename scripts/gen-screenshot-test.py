"""Generate a phone-screenshot-style test image for gallery-upload OCR.

Mimics the user's real flow: screenshot an assignment (e.g. from a chat or
classroom app), then upload the screenshot from the gallery. The image has
phone UI chrome around the text: status bar, app header, bottom nav bar.
Ground truth = the assignment text inside the card only (UI chrome words are
extra noise Tesseract may also read; recall is measured on the truth words).
"""
from PIL import Image, ImageDraw, ImageFont
import os

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ocr-test")
W, H = 1080, 1920

ASSIGNMENT = [
    "Latihan Soal \u2014 Fotosintesis",
    "",
    "1. Jelaskan proses fotosintesis dan tuliskan",
    "persamaan reaksinya.",
    "",
    "2. Mengapa daun berwarna hijau? Jelaskan",
    "peran klorofil dalam menyerap cahaya",
    "matahari.",
    "",
    "3. Sebutkan dua tahap utama fotosintesis",
    "dan di mana masing-masing tahap",
    "berlangsung di dalam kloroplas.",
    "",
    "4. Apa yang terjadi pada tumbuhan jika",
    "tidak mendapat cahaya matahari selama",
    "seminggu? Jelaskan.",
]

TRUTH = (
    "Latihan Soal Fotosintesis\n"
    "1. Jelaskan proses fotosintesis dan tuliskan persamaan reaksinya.\n"
    "2. Mengapa daun berwarna hijau? Jelaskan peran klorofil dalam menyerap cahaya matahari.\n"
    "3. Sebutkan dua tahap utama fotosintesis dan di mana masing-masing tahap berlangsung di dalam kloroplas.\n"
    "4. Apa yang terjadi pada tumbuhan jika tidak mendapat cahaya matahari selama seminggu? Jelaskan.\n"
)


def font(size, bold=False):
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold
        else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def main():
    img = Image.new("RGB", (W, H), (245, 245, 245))
    d = ImageDraw.Draw(img)

    # Status bar (dark).
    d.rectangle([0, 0, W, 72], fill=(30, 30, 30))
    d.text((36, 18), "22:25", font=font(34, True), fill=(255, 255, 255))
    d.text((W - 220, 18), "34%", font=font(34), fill=(255, 255, 255))

    # App header (teal), like a classroom/chat app.
    d.rectangle([0, 72, W, 200], fill=(0, 121, 107))
    d.text((36, 108), "<", font=font(56, True), fill=(255, 255, 255))
    d.text((110, 100), "Kelas 10 IPA - Biologi", font=font(44, True), fill=(255, 255, 255))
    d.text((110, 152), "Tugas hari ini", font=font(32), fill=(220, 240, 235))

    # White content card with the assignment text.
    d.rounded_rectangle([48, 240, W - 48, 1560], radius=28, fill=(255, 255, 255))
    y = 300
    for line in ASSIGNMENT:
        bold = line.startswith(("Latihan", "1.", "2.", "3.", "4."))
        d.text((96, y), line, font=font(40, bold), fill=(20, 20, 20))
        y += 62

    # Small footer inside the card (app UI noise).
    d.text((96, 1480), "Dikirim 21:58  \u2713\u2713", font=font(30), fill=(140, 140, 140))

    # Bottom nav bar (Android).
    d.rectangle([0, H - 110, W, H], fill=(255, 255, 255))
    d.rectangle([380, H - 70, 700, H - 62], fill=(120, 120, 120))
    d.ellipse([120, H - 78, 170, H - 28], outline=(120, 120, 120), width=5)
    d.rectangle([900, H - 78, 960, H - 28], outline=(120, 120, 120), width=5)

    os.makedirs(OUT_DIR, exist_ok=True)
    img.save(os.path.join(OUT_DIR, "screenshot-assignment.png"))
    with open(os.path.join(OUT_DIR, "screenshot-ground-truth.txt"), "w") as f:
        f.write(TRUTH)
    print("wrote screenshot-assignment.png", img.size, "and screenshot-ground-truth.txt")


if __name__ == "__main__":
    main()
