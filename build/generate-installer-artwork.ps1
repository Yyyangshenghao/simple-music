# 从当前应用图标生成安装素材，禁止手工嵌入另一套旧图标。
# powershell -NoProfile -File build/generate-installer-artwork.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assetRoot = $PSScriptRoot
$brandIcon = [Drawing.Image]::FromFile((Join-Path $assetRoot 'icon.png'))
$scale = 3

function New-Canvas([int]$width, [int]$height, [string]$background) {
  $bitmap = [Drawing.Bitmap]::new($width * $scale, $height * $scale, [Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([Drawing.ColorTranslator]::FromHtml($background))
  $graphics.ScaleTransform($scale, $scale)
  return @{ Bitmap = $bitmap; Graphics = $graphics }
}

$header = New-Canvas 150 57 '#FFFFFF'
try {
  $header.Graphics.DrawImage($brandIcon, 96, 5, 46, 46)
  $header.Bitmap.Save((Join-Path $assetRoot 'installerHeader.bmp'), [Drawing.Imaging.ImageFormat]::Bmp)
} finally {
  $header.Graphics.Dispose()
  $header.Bitmap.Dispose()
}

$sidebar = New-Canvas 164 314 '#F4F6F8'
try {
  # 轻微的冷暖过渡呼应当前图标，避免旧版黑色方块与紫色霓虹。
  $wash = [Drawing.Drawing2D.LinearGradientBrush]::new(
    [Drawing.Rectangle]::new(0, 0, 164, 314),
    [Drawing.ColorTranslator]::FromHtml('#F4F0E8'),
    [Drawing.ColorTranslator]::FromHtml('#EEF4FA'), 75)
  $sidebar.Graphics.FillRectangle($wash, 0, 0, 164, 314)
  $wash.Dispose()
  $sidebar.Graphics.DrawImage($brandIcon, 24, 42, 116, 116)
  $ink = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#273345'))
  $muted = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#64748B'))
  $nameFont = [Drawing.Font]::new('Segoe UI', 15, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
  $captionFont = [Drawing.Font]::new('Microsoft YaHei UI', 10, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
  $sidebar.Graphics.DrawString('Simple Music', $nameFont, $ink, 24, 176)
  $sidebar.Graphics.DrawString('桌面音乐播放器', $captionFont, $muted, 25, 202)
  $sidebar.Bitmap.Save((Join-Path $assetRoot 'installerSidebar.bmp'), [Drawing.Imaging.ImageFormat]::Bmp)
  $nameFont.Dispose()
  $captionFont.Dispose()
  $ink.Dispose()
  $muted.Dispose()
} finally {
  $sidebar.Graphics.Dispose()
  $sidebar.Bitmap.Dispose()
  $brandIcon.Dispose()
}
