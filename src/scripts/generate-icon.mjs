import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectDir = path.join(__dirname, '..', '..')
const brandDir = path.join(projectDir, 'src', 'assets', 'brand')
const brandLogoPath = path.join(brandDir, 'manying-studio-logo.png')
const logoPath = path.join(brandDir, 'logo.png')
const logoSize = 1024

// 确保品牌资源目录存在
if (!fs.existsSync(brandDir)) {
  fs.mkdirSync(brandDir, { recursive: true })
}

async function generateIcons() {
  console.log('🎨 从 src/assets/brand/manying-studio-logo.png 生成漫影工作室图标中...')

  if (!fs.existsSync(brandLogoPath)) {
    console.error('❌ 找不到 src/assets/brand/manying-studio-logo.png')
    process.exit(1)
  }

  const iconSourcePath = path.join(brandDir, 'manying-studio-icon-source.png')
  const pngPath = path.join(brandDir, 'manying-studio-icon.png')
  const icoPath = path.join(brandDir, 'manying-studio-icon.ico')
  const icnsPath = path.join(brandDir, 'manying-studio-icon.icns')

  await sharp(brandLogoPath)
    .resize(logoSize, logoSize, { fit: 'cover' })
    .png()
    .toFile(logoPath)
  console.log('✅ 生成 logo.png (1024x1024)')

  await sharp(logoPath).png().toFile(iconSourcePath)

  // 从品牌 logo 生成 512x512 PNG 图标
  await sharp(logoPath)
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(pngPath)
  console.log('✅ 生成 manying-studio-icon.png (512x512)')

  // 生成多尺寸 PNG 用于 ICO
  const sizes = [16, 32, 48, 64, 128, 256]
  const pngBuffers = await Promise.all(
    sizes.map(size =>
      sharp(logoPath)
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer()
    )
  )

  // 转换为 ICO
  const icoBuffer = await pngToIco(pngBuffers)
  fs.writeFileSync(icoPath, icoBuffer)
  console.log('✅ 生成 manying-studio-icon.ico (多尺寸: ' + sizes.join(', ') + ')')

  if (process.platform === 'darwin') {
    const iconsetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manying-studio-iconset-'))
    const iconsetPath = path.join(iconsetDir, 'icon.iconset')
    fs.mkdirSync(iconsetPath, { recursive: true })

    const iconsetSizes = [
      { size: 16, filename: 'icon_16x16.png' },
      { size: 32, filename: 'icon_16x16@2x.png' },
      { size: 32, filename: 'icon_32x32.png' },
      { size: 64, filename: 'icon_32x32@2x.png' },
      { size: 128, filename: 'icon_128x128.png' },
      { size: 256, filename: 'icon_128x128@2x.png' },
      { size: 256, filename: 'icon_256x256.png' },
      { size: 512, filename: 'icon_256x256@2x.png' },
      { size: 512, filename: 'icon_512x512.png' },
      { size: 1024, filename: 'icon_512x512@2x.png' },
    ]

    for (const { size, filename } of iconsetSizes) {
      await sharp(logoPath)
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile(path.join(iconsetPath, filename))
    }

    const result = spawnSync('iconutil', ['-c', 'icns', iconsetPath, '-o', icnsPath], {
      stdio: 'inherit',
    })

    fs.rmSync(iconsetDir, { recursive: true, force: true })

    if (result.status !== 0) {
      throw new Error('iconutil 生成 icon.icns 失败')
    }

    console.log('✅ 生成 manying-studio-icon.icns (macOS 应用图标)')
  }

  console.log(`\n📁 图标已保存到: ${brandDir}`)
}

generateIcons().catch(console.error)
