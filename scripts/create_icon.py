from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "build" / "icon.ico"
SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]


def font_for(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        Path(r"C:\Windows\Fonts\seguisb.ttf"),
        Path(r"C:\Windows\Fonts\segoeuib.ttf"),
        Path(r"C:\Windows\Fonts\arialbd.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), round(size * 0.5))
    return ImageFont.load_default()


def render(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    inset = max(1, round(size * 0.06))
    radius = max(2, round(size * 0.22))
    draw.rounded_rectangle((inset, inset, size - inset - 1, size - inset - 1), radius=radius, fill=(17, 17, 17, 255))
    font = font_for(size)
    box = draw.textbbox((0, 0), "D", font=font)
    width, height = box[2] - box[0], box[3] - box[1]
    draw.text(((size - width) / 2, (size - height) / 2 - box[1] - size * 0.02), "D", font=font, fill=(255, 255, 255, 255))
    return image


OUTPUT.parent.mkdir(parents=True, exist_ok=True)
images = [render(size) for size in SIZES]
images[-1].save(OUTPUT, format="ICO", sizes=[(size, size) for size in SIZES], append_images=images[:-1])
print(OUTPUT)
