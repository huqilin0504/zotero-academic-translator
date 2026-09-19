import { execSync } from 'node:child_process';
import { existsSync, unlinkSync, statSync, readFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';

const packageManifest = JSON.parse(readFileSync('package.json', 'utf8'));
const packageVersion = packageManifest.version;

console.log(`📦 正在构建并打包 Zotero 7+ 插件安装包 v${packageVersion} (.xpi)...`);

execSync('node scripts/build.js', { stdio: 'inherit' });

const xpiFileName = `zotero-academic-translator-${packageVersion}.xpi`;
const canonicalXpiFileName = 'zotero-academic-translator.xpi';

if (existsSync(xpiFileName)) {
  unlinkSync(xpiFileName);
}

try {
  execSync(`zip -r ${xpiFileName} manifest.json bootstrap.js preferences.xhtml preferences-defaults.js preferences.js preferences.css icon.png fonts LICENSE THIRD_PARTY_NOTICES.md`, { stdio: 'inherit' });
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
