# Réduit les photos d'un dossier à 512 px de côté, en JPEG qualité 80 —
# comme le fait l'application (reduirePhoto) avant de les envoyer à Opus.
# Sert à essai-opus.mjs, faute de canevas dans Node.
param([string]$Source, [string]$Cible, [int]$Cote = 512)
Add-Type -AssemblyName System.Drawing
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
$params = New-Object System.Drawing.Imaging.EncoderParameters 1
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, [long]80)
New-Item -ItemType Directory -Force $Cible | Out-Null
Get-ChildItem $Source -Filter *.jpg | ForEach-Object {
  $img = [System.Drawing.Image]::FromFile($_.FullName)
  $r = [Math]::Min(1, $Cote / [Math]::Max($img.Width, $img.Height))
  $w = [int][Math]::Round($img.Width * $r); $h = [int][Math]::Round($img.Height * $r)
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($img, 0, 0, $w, $h)
  $bmp.Save((Join-Path $Cible $_.Name), $codec, $params)
  $g.Dispose(); $bmp.Dispose(); $img.Dispose()
}
