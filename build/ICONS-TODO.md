# App Icons - TODO

This directory needs app icons for Mac and Windows builds.

## Required Files

1. **icon.icns** - Mac app icon
2. **icon.ico** - Windows app icon

## How to Create Icons

### Starting Image
Create a 1024x1024 PNG image for your app icon.

### Mac Icon (.icns)

Using Mac's built-in `iconutil`:

```bash
# 1. Create iconset directory
mkdir MyIcon.iconset

# 2. Create required sizes (use Image tool or sips)
sips -z 16 16     icon-1024.png --out MyIcon.iconset/icon_16x16.png
sips -z 32 32     icon-1024.png --out MyIcon.iconset/icon_16x16@2x.png
sips -z 32 32     icon-1024.png --out MyIcon.iconset/icon_32x32.png
sips -z 64 64     icon-1024.png --out MyIcon.iconset/icon_32x32@2x.png
sips -z 128 128   icon-1024.png --out MyIcon.iconset/icon_128x128.png
sips -z 256 256   icon-1024.png --out MyIcon.iconset/icon_128x128@2x.png
sips -z 256 256   icon-1024.png --out MyIcon.iconset/icon_256x256.png
sips -z 512 512   icon-1024.png --out MyIcon.iconset/icon_256x256@2x.png
sips -z 512 512   icon-1024.png --out MyIcon.iconset/icon_512x512.png
sips -z 1024 1024 icon-1024.png --out MyIcon.iconset/icon_512x512@2x.png

# 3. Convert to .icns
iconutil -c icns MyIcon.iconset

# 4. Copy to build directory
cp MyIcon.icns icon.icns
```

### Windows Icon (.ico)

Use an online converter or ImageMagick:

**Online converters:**
- https://convertio.co/png-ico/
- https://cloudconvert.com/png-to-ico

**Using ImageMagick:**
```bash
brew install imagemagick
convert icon-1024.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
```

## Design Guidelines

- Use simple, recognizable imagery
- Avoid fine details (icons are displayed at small sizes)
- Use high contrast colors
- Test at multiple sizes (16x16 up to 1024x1024)
- Follow platform design guidelines:
  - Mac: Rounded square with subtle shadow
  - Windows: Flat design with perspective

## Temporary Workaround

electron-builder will use a default icon if these files are missing, but it's not recommended for production releases.

## Current Status

⚠️ **Icons not yet created** - using default Electron icon for now
