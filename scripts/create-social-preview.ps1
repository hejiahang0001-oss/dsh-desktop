param(
  [string]$OutputPath = "docs/assets/social-preview.png"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$width = 1280
$height = 640
$bitmap = [System.Drawing.Bitmap]::new($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

try {
  $rect = [System.Drawing.Rectangle]::new(0, 0, $width, $height)
  $background = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 9, 14, 24),
    [System.Drawing.Color]::FromArgb(255, 19, 36, 59),
    12
  )
  $graphics.FillRectangle($background, $rect)
  $background.Dispose()

  $gridPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(18, 255, 255, 255), 1)
  for ($x = 0; $x -le $width; $x += 64) { $graphics.DrawLine($gridPen, $x, 0, $x, $height) }
  for ($y = 0; $y -le $height; $y += 64) { $graphics.DrawLine($gridPen, 0, $y, $width, $y) }
  $gridPen.Dispose()

  $accentBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 56, 189, 248))
  $softAccentBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(45, 56, 189, 248))
  $graphics.FillEllipse($softAccentBrush, 930, -160, 470, 470)
  $graphics.FillRectangle($accentBrush, 78, 82, 92, 8)

  $titleFont = [System.Drawing.Font]::new("Segoe UI Semibold", 72, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $subtitleFont = [System.Drawing.Font]::new("Segoe UI", 35, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $bodyFont = [System.Drawing.Font]::new("Segoe UI", 23, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $monoFont = [System.Drawing.Font]::new("Consolas", 18, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $whiteBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 244, 247, 252))
  $mutedBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 178, 190, 209))

  $graphics.DrawString("DSH Desktop", $titleFont, $whiteBrush, 74, 114)
  $graphics.DrawString("DeepSeek Harness, now on Windows", $subtitleFont, $mutedBrush, 80, 218)

  $windowRect = [System.Drawing.Rectangle]::new(80, 330, 1120, 210)
  $windowPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = 44
  $windowPath.AddArc($windowRect.X, $windowRect.Y, $diameter, $diameter, 180, 90)
  $windowPath.AddArc($windowRect.Right - $diameter, $windowRect.Y, $diameter, $diameter, 270, 90)
  $windowPath.AddArc($windowRect.Right - $diameter, $windowRect.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $windowPath.AddArc($windowRect.X, $windowRect.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $windowPath.CloseFigure()
  $windowBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(222, 17, 24, 39))
  $windowPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(90, 148, 163, 184), 1)
  $graphics.FillPath($windowBrush, $windowPath)
  $graphics.DrawPath($windowPen, $windowPath)

  $graphics.FillEllipse([System.Drawing.Brushes]::IndianRed, 108, 357, 13, 13)
  $graphics.FillEllipse([System.Drawing.Brushes]::Goldenrod, 134, 357, 13, 13)
  $graphics.FillEllipse([System.Drawing.Brushes]::MediumSeaGreen, 160, 357, 13, 13)
  $graphics.DrawString("UNOFFICIAL COMMUNITY DESKTOP HOST", $monoFont, $mutedBrush, 205, 350)

  $pillTexts = @("WORKSPACES", "SESSIONS", "AGENT CONTROLS", "SAFE DIFF REVIEW")
  $pillWidths = @(190, 160, 230, 245)
  $pillX = 112
  for ($i = 0; $i -lt $pillTexts.Count; $i++) {
    $pillRect = [System.Drawing.Rectangle]::new($pillX, 423, $pillWidths[$i], 58)
    $pillBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(42, 56, 189, 248))
    $pillPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(120, 56, 189, 248), 1)
    $graphics.FillRectangle($pillBrush, $pillRect)
    $graphics.DrawRectangle($pillPen, $pillRect)
    $graphics.DrawString($pillTexts[$i], $monoFont, $whiteBrush, $pillX + 18, 440)
    $pillBrush.Dispose()
    $pillPen.Dispose()
    $pillX += $pillWidths[$i] + 20
  }

  $graphics.DrawString("Windows x64  •  MIT  •  v0.3.7", $bodyFont, $mutedBrush, 82, 572)

  $outputFullPath = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputPath))
  [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($outputFullPath)) | Out-Null
  $bitmap.Save($outputFullPath, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output $outputFullPath
}
finally {
  foreach ($item in @($windowPen, $windowBrush, $windowPath, $whiteBrush, $mutedBrush, $accentBrush, $softAccentBrush, $titleFont, $subtitleFont, $bodyFont, $monoFont, $graphics, $bitmap)) {
    if ($null -ne $item) { $item.Dispose() }
  }
}
