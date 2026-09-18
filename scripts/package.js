import { execSync } from 'node:child_process';
import { existsSync, unlinkSync, statSync, readFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';

const packageManifest = JSON.parse(readFileSync('package.json', 'utf8'));
const packageVersion = packageManifest.version;

console.log(`📦 正在构建并打包 Zotero 7+ 插件安装包 v${packageVersion} (.xpi)...`);

// 1. 确保先执行 build
execSync('node scripts/build.js', { stdio: 'inherit' });

// 带版本号的文件名避免用户在 Zotero 中误选旧的同 ID 安装包。
const xpiFileName = `zotero-academic-translator-${packageVersion}.xpi`;
const canonicalXpiFileName = 'zotero-academic-translator.xpi';

if (existsSync(xpiFileName)) {
  unlinkSync(xpiFileName);
}

// 2. 打包运行脚本、偏好页资源和图标
try {
  execSync(`zip -r ${xpiFileName} manifest.json bootstrap.js preferences.xhtml preferences-defaults.js preferences.js preferences.css icon.png fonts LICENSE THIRD_PARTY_NOTICES.md`, { stdio: 'inherit' });
  // 同步一个稳定文件名，避免文件选择器继续拿到旧版本安装包。
  copyFileSync(xpiFileName, canonicalXpiFileName);
  const stats = statSync(xpiFileName);
  const sizeKb = (stats.size / 1024).toFixed(1);
  console.log(`\n🎉 打包完成！`);
  console.log(`📁 插件安装包路径: ${path.resolve(xpiFileName)} (${sizeKb} KB)`);
  console.log(`📁 稳定文件名副本: ${path.resolve(canonicalXpiFileName)}`);
  console.log(`💡 安装方法：在 Zotero 7 或更高版本中点击【工具 -> 插件 -> 齿轮图标 -> 从文件安装插件】，选择该 .xpi 文件即可！`);
} catch (err) {
  console.error('❌ 打包失败:', err);
  process.exit(1);
}
