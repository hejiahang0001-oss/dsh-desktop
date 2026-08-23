# DSH Desktop V0.4.6

V0.4.6 completes the first dedicated image and PDF Quick Look slice while keeping DeepSeek Harness `0.1.1-rc.2` pinned.

## What is new

- Open PNG, JPEG, WebP, GIF, and PDF files from the existing workspace file browser.
- Fit images to the window or zoom from 25% to 400%.
- Navigate PDFs by page and use fit or zoom controls.
- Keep media local: files are read through the bounded preload surface and rendered from an in-memory object URL.
- Enforce separate 24 MiB image and 40 MiB PDF limits, workspace containment, link/junction blocking, and credential-name protection.
- Validate actual file signatures. A supported image with a wrong image extension is opened using its detected MIME type and clearly labelled; cross-type disguises are blocked.

## Validation

- 87 automated tests pass.
- A packaged PNG-named/JPEG-content file rendered with the real-format notice.
- A valid one-page PDF rendered in the packaged application and exposed the expected accessible page text.
- Image-only mode hides PDF page controls; PDF mode exposes previous/next/page/fit/zoom controls.

## Known limits

- No SVG media Quick Look, Office preview, device presets, or remote URL preview.
- PDF page count is provided by Chromium's local PDF renderer; DSH controls the requested page but does not parse the document itself.
- The Windows installer remains unsigned.
